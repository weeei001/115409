"""backtest_learned_prompt.py 的單元測試：洩漏防護、methodology 載入、metrics 產出 schema。

以 monkeypatch 換掉 LLM / Qdrant / yfinance，只測管線邏輯。
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import backtest_learned_prompt as blp  # noqa: E402


_TEMPLATE = ("截至 {as_of}，{name}（{stock_id}）未來 {horizon} 交易日。\n{context_block}\n"
             '只輸出 JSON：{"market_regime": "...", "technical_reasoning": "...", '
             '"news_reasoning": "...", "change_pct": 數字}')


@pytest.fixture
def methodology_dir(tmp_path):
    d = tmp_path / "2330_2024-01-01_2024-12-31"
    d.mkdir()
    (d / "best.json").write_text(json.dumps({
        "version": 2, "prompt": "prompt_v2.txt", "methodology": "methodology_v2.json",
        "heldout_h20": 0.65, "heldout_h5": 0.6, "train_end": "2024-12-31", "stock": "2330",
    }))
    (d / "prompt_v2.txt").write_text(_TEMPLATE)
    (d / "prompt_v1.txt").write_text("舊版 " + _TEMPLATE)
    (d / "methodology_v2.json").write_text(json.dumps({"summary": "s", "rules": [{"id": "R1"}]}))
    return d


def test_load_methodology_reads_best(methodology_dir):
    tpl, ver, train_end = blp.load_methodology(methodology_dir, None)
    assert ver == 2 and train_end == "2024-12-31" and tpl == _TEMPLATE


def test_load_methodology_explicit_version(methodology_dir):
    tpl, ver, _ = blp.load_methodology(methodology_dir, 1)
    assert ver == 1 and tpl.startswith("舊版")


def _base_args(methodology_dir, **over):
    ns = dict(stock="2330", start="2025-01-01", end="2025-12-31", horizon=20,
              neutral_band=None, provider="h200", window_days=14,
              methodology_dir=str(methodology_dir), prompt_version=None,
              limit=None, out_dir=None, seed=42)
    ns.update(over)
    return type("A", (), ns)


def test_run_rejects_test_start_before_train_end(methodology_dir):
    args = _base_args(methodology_dir, start="2024-06-01")  # 早於 train_end 2024-12-31
    with pytest.raises(AssertionError):
        blp.run(args)


def test_run_end_to_end_with_mocks(methodology_dir, tmp_path, monkeypatch):
    # yfinance 價格：2024-12 起每工作日一筆，線性上漲
    from datetime import date, timedelta
    rows, price = [], 100.0
    d = date(2024, 12, 1)
    while d <= date(2026, 3, 1):
        if d.weekday() < 5:
            rows.append((d.isoformat(), round(price, 2)))
            price += 0.4
        d += timedelta(days=1)

    monkeypatch.setattr(blp, "load_price_frame", lambda *a, **k: rows)
    monkeypatch.setattr(blp, "fetch_prices", lambda *a, **k: [100.0] * 20)
    monkeypatch.setattr(blp, "compute_technical", lambda closes: {
        "available": True, "n_days": 20, "first_close": 100, "last_close": 108,
        "change_pct": 8.0, "slope_per_day": 0.4, "ma20": 104, "vs_ma20_pct": 3.8})
    monkeypatch.setattr(blp, "fetch_pit_articles", lambda *a, **k: (
        [], [{"title": "新聞X", "pub_time": "2025-03-01", "content": "內文"}]))
    monkeypatch.setattr(blp, "build_qdrant_embeddings", lambda: (None, None))
    monkeypatch.setattr(blp, "make_h200_client", lambda: (object(), "Gemma4-31B"))

    # arm A 一律預測 +5（up）；arm L 一律預測 +1（flat, band=3）
    def fake_predict(client, model_name, stock_id, as_of, horizon, ctx, provider, prompt_template=None):
        return 1.0 if prompt_template is not None else 5.0

    monkeypatch.setattr(blp, "predict_change_pct", fake_predict)
    monkeypatch.setattr(blp.time, "sleep", lambda *_: None)

    out = tmp_path / "out"
    args = _base_args(methodology_dir, limit=6, out_dir=str(out))
    result_dir = blp.run(args)

    metrics = json.loads((result_dir / "metrics.json").read_text())
    decisions = list(__import__("csv").DictReader((result_dir / "decisions.csv").open()))

    assert set(metrics["arms"]) == {"A", "L"}
    assert "verdict" in metrics and "relative_to_always_up" in metrics
    assert metrics["config"]["methodology_dir"].endswith("2330_2024-01-01_2024-12-31")
    assert metrics["config"]["prompt_version"] == 2
    # 每個有效錨點兩列（A/L），且帶 prompt_version 欄
    assert all("prompt_version" in row for row in decisions)
    a_rows = [r for r in decisions if r["arm"] == "A"]
    l_rows = [r for r in decisions if r["arm"] == "L"]
    assert a_rows and len(a_rows) == len(l_rows)
    assert a_rows[0]["prompt_version"] == blp.DEFAULT_PROMPT_VERSION
    assert l_rows[0]["prompt_version"] == "L_v2"
    # 價格線性上漲 → actual 為 up；A 預測 up 全中、L 預測 flat 全錯 → L 勝 0
    assert metrics["arms"]["A"]["hit_rate"] == 1.0
    assert metrics["arms"]["L"]["hit_rate"] == 0.0
    assert metrics["mcnemar_sign_test"]["a_wins"] > 0
    assert metrics["mcnemar_sign_test"]["b_wins"] == 0
    assert metrics["verdict"]["passed"] is False


def test_run_cache_hit_skips_llm(methodology_dir, tmp_path, monkeypatch):
    from datetime import date, timedelta
    rows, price = [], 100.0
    d = date(2024, 12, 1)
    while d <= date(2026, 3, 1):
        if d.weekday() < 5:
            rows.append((d.isoformat(), round(price, 2)))
            price += 0.4
        d += timedelta(days=1)
    monkeypatch.setattr(blp, "load_price_frame", lambda *a, **k: rows)
    monkeypatch.setattr(blp, "fetch_prices", lambda *a, **k: [100.0] * 20)
    monkeypatch.setattr(blp, "compute_technical", lambda closes: {"available": False})
    monkeypatch.setattr(blp, "fetch_pit_articles", lambda *a, **k: ([], []))
    monkeypatch.setattr(blp, "build_qdrant_embeddings", lambda: (None, None))
    monkeypatch.setattr(blp, "make_h200_client", lambda: (object(), "Gemma4-31B"))
    monkeypatch.setattr(blp.time, "sleep", lambda *_: None)

    calls = {"n": 0}

    def fake_predict(*a, **k):
        calls["n"] += 1
        return 2.0

    monkeypatch.setattr(blp, "predict_change_pct", fake_predict)
    out = tmp_path / "out2"
    args = _base_args(methodology_dir, limit=3, out_dir=str(out))
    blp.run(args)
    first = calls["n"]
    assert first > 0
    blp.run(args)  # 第二次跑，cache 應全命中
    assert calls["n"] == first
