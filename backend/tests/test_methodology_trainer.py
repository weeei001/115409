"""methodology_trainer.py 的單元測試：洩漏防護、錨點邊界、template/methodology 驗證、best 選擇。

全部用 mock，不打 Qdrant / LLM / yfinance。
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.jobs.research import methodology_trainer as mt


# ---- training_anchors：h20 實現日不得超過 train_end ----

def _synthetic_rows(start="2023-12-01", end="2025-01-31"):
    """每個工作日一筆，收盤價線性遞增，供 actual_from_rows 計算。"""
    from datetime import date, timedelta
    d = date.fromisoformat(start)
    end_d = date.fromisoformat(end)
    rows, price = [], 100.0
    while d <= end_d:
        if d.weekday() < 5:
            rows.append((d.isoformat(), round(price, 2)))
            price += 0.5
        d += timedelta(days=1)
    return rows


def test_training_anchors_respect_h20_horizon():
    rows = _synthetic_rows()
    anchors = mt.training_anchors("2330", "2024-01-01", "2024-12-31", price_rows=rows, horizon_max=20)
    assert anchors, "應至少有一個合格錨點"
    # 每個保留的錨點，其 h20 實現日必須 <= train_end
    capped = [(d, c) for d, c in rows if d <= "2024-12-31"]
    for a in anchors:
        assert mt.actual_from_rows(capped, a, 20) is not None
        assert a <= "2024-12-31"
    # 最後一個合格錨點之後不應再有錨點（h20 會越界）→ 大約落在 11 月底
    assert anchors[-1] <= "2024-12-05"
    assert anchors[-1] >= "2024-11-20"


def test_training_anchors_all_pre_train_end():
    rows = _synthetic_rows()
    anchors = mt.training_anchors("2330", "2024-06-01", "2024-06-30", price_rows=rows, horizon_max=20)
    # 6/30 為界，h20 只到 ~7 月底 → 6 月的週五幾乎都不合格
    for a in anchors:
        assert a <= "2024-06-30"


# ---- 洩漏掃描 ----

@pytest.mark.parametrize("text,train_end,expected_flag", [
    ("2024年3月營收成長", "2024-12-31", False),
    ("展望 2025年1月 訂單", "2024-12-31", True),
    ("2024/12 財報", "2024-12-31", False),
    ("2025/02 法說會", "2024-12-31", True),
    ("2024Q4 表現", "2024-12-31", False),
    ("2025Q1 預估", "2024-12-31", True),
    ("價格從 100 漲到 2025 元", "2024-12-31", False),  # 2025 後面不是 -/月，不算日期
])
def test_scan_for_leakage(text, train_end, expected_flag):
    hits = mt.scan_for_leakage(text, train_end)
    assert bool(hits) == expected_flag


def test_scan_for_leakage_lists_all_offenders():
    text = "2025年1月 和 2025/03 以及 2026Q2"
    assert set(mt.scan_for_leakage(text, "2024-12-31")) == {"2025年1", "2025/03", "2026Q2"}


# ---- prompt template / methodology 驗證 ----

_GOOD_TEMPLATE = ("截至 {as_of}，{name}（{stock_id}）未來 {horizon} 交易日。\n{context_block}\n"
                  '只輸出 JSON：{"market_regime": "...", "technical_reasoning": "...", '
                  '"news_reasoning": "...", "change_pct": 數字}')


def test_validate_prompt_template_accepts_good():
    mt.validate_prompt_template(_GOOD_TEMPLATE)  # 不拋


@pytest.mark.parametrize("bad", [
    "",
    "缺佔位符 {as_of} {name} {stock_id} {horizon}",           # 少 context_block
    "只有 {context_block} 沒有其他",                            # 少多個
])
def test_validate_prompt_template_rejects_bad(bad):
    with pytest.raises(ValueError):
        mt.validate_prompt_template(bad)


def test_sanitize_template_converts_latex_and_strips_backslashes():
    dirty = ("截至 {as_of}，{name}（{stock_id}）未來 {horizon}。\n"
             "強趨勢：斜率 > 0 $\\rightarrow$ 動能延續；乖離率 $\\le$ 10% $\\to$ 溫和漲。\n"
             "{context_block}\n殘留 \\x 反斜線\n"
             '只輸出 JSON：{"market_regime": "...", "technical_reasoning": "...", '
             '"news_reasoning": "...", "change_pct": 數字}')
    clean = mt.sanitize_template(dirty)
    assert "\\" not in clean
    assert "→" in clean and "≤" in clean
    mt.validate_prompt_template(clean)  # 清理後應通過


def test_validate_prompt_template_rejects_raw_backslash():
    # \q 不是合法 JSON 跳脫、也不是 sanitize 認得的 LaTeX → validate 應擋下
    with pytest.raises(ValueError, match="裸反斜線"):
        mt.validate_prompt_template(_GOOD_TEMPLATE + "\n路徑 C:\\qux 未清")


def test_validate_methodology():
    good = {"summary": "s", "regime_rules": ["r"], "rules": [{"id": "R1"}], "anti_patterns": ["a"]}
    mt.validate_methodology(good)
    with pytest.raises(ValueError):
        mt.validate_methodology({"summary": "s"})
    with pytest.raises(ValueError):
        mt.validate_methodology({**good, "rules": []})


# ---- call_induction_llm：驗證失敗會重試並附錯誤 ----

class _FakeInductionClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs):
        self.calls.append(kwargs["messages"][-1]["content"])
        content = self._responses.pop(0)
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _valid_induction_json():
    return json.dumps({
        "methodology": {"summary": "s", "regime_rules": ["r1"],
                        "rules": [{"id": "R1", "signal": "x", "condition": "y",
                                   "expected_effect": "h20 偏多", "confidence": 0.6,
                                   "evidence_case_ids": ["2330_2024-03-08"]}],
                        "anti_patterns": ["a1"]},
        "prompt_template": _GOOD_TEMPLATE,
    }, ensure_ascii=False)


def test_call_induction_llm_retries_on_invalid_then_succeeds(monkeypatch):
    monkeypatch.setattr(mt.time, "sleep", lambda *_: None)
    client = _FakeInductionClient(["這不是 JSON", _valid_induction_json()])
    out = mt.call_induction_llm(client, "m", "h200", "PROMPT")
    assert out["prompt_template"] == _GOOD_TEMPLATE
    assert len(client.calls) == 2
    assert "上一次輸出有誤" in client.calls[1]


def test_call_induction_llm_raises_after_two_failures(monkeypatch):
    monkeypatch.setattr(mt.time, "sleep", lambda *_: None)
    client = _FakeInductionClient(["爛", "還是爛"])
    with pytest.raises(RuntimeError):
        mt.call_induction_llm(client, "m", "h200", "PROMPT")


# ---- evaluate_prompt_on_cases + hit_rate + best 選擇 ----

def _case(cid, as_of, a5, a20):
    return mt.TrainingCase(
        case_id=cid, as_of=as_of, analyst=[], news=[],
        technical={"available": True, "n_days": 20, "first_close": 100, "last_close": 110,
                   "change_pct": 10.0, "slope_per_day": 0.5, "ma20": 105, "vs_ma20_pct": 4.8},
        context_block="CTX",
        actual_h5=a5, actual_h20=a20,
        dir_h5=mt.classify(a5, mt.H5_BAND), dir_h20=mt.classify(a20, mt.H20_BAND), n_news=0)


def test_evaluate_prompt_on_cases_uses_cache(monkeypatch):
    calls = {"n": 0}

    def fake_predict(*a, **k):
        calls["n"] += 1
        return 5.0

    monkeypatch.setattr(mt, "predict_change_pct", fake_predict)
    monkeypatch.setattr(mt.time, "sleep", lambda *_: None)
    cases = [_case("2330_2024-03-08", "2024-03-08", 4.0, 6.0)]
    cache = {}
    ev1 = mt.evaluate_prompt_on_cases(None, "m", "h200", "2330", cases, "TPL", "v0", cache)
    assert calls["n"] == 2  # h5 + h20
    assert ev1["2330_2024-03-08"]["hit_h20"] is True  # pred 5.0 → up；actual 6.0 → up
    # 第二次同 tag → 全部命中 cache，不再呼叫
    mt.evaluate_prompt_on_cases(None, "m", "h200", "2330", cases, "TPL", "v0", cache)
    assert calls["n"] == 2


def test_hit_rate_and_always_up():
    cases = [_case("c1", "2024-01-05", 4.0, 6.0), _case("c2", "2024-01-12", -4.0, -6.0),
             _case("c3", "2024-01-19", 0.2, 1.0)]
    evals = {
        "c1": {"hit_h20": True, "hit_h5": True},
        "c2": {"hit_h20": False, "hit_h5": True},
        "c3": {"hit_h20": None, "hit_h5": False},
    }
    assert mt.hit_rate(evals, 20) == (0.5, 2)   # c3 的 None 被排除
    assert mt.hit_rate(evals, 5) == (round(2 / 3, 4), 3)
    assert mt.always_up_rate(cases, 20) == round(1 / 3, 4)  # c1 up, c2 down, c3 flat


def test_split_batches_alternates():
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 1.0) for i in range(7)]
    b1, b2 = mt.split_batches(cases)
    assert [c.case_id for c in b1] == ["c0", "c2", "c4", "c6"]
    assert [c.case_id for c in b2] == ["c1", "c3", "c5"]


def test_assert_cases_no_leak_raises_on_future_news():
    c = _case("2330_2024-12-27", "2024-12-27", 1.0, 1.0)
    c.news = [{"title": "未來新聞", "pub_time": "2025-01-03T09:00:00+08:00", "content": "x"}]
    with pytest.raises(AssertionError):
        mt._assert_cases_no_leak([c], "2024-12-31")


def test_case_summary_contains_realised_outcome():
    c = _case("2330_2024-03-08", "2024-03-08", 3.1, 7.2)
    s = mt.case_summary(c)
    assert "2330_2024-03-08" in s and "+7.20%" in s and "+3.10%" in s
    assert "MA20=105" in s


# ══════════════════════════════════════════════════════════════════
# 日頻錨點 / 時間連續切分 / 分層抽樣 / 學習曲線（樣本量診斷實驗）
# ══════════════════════════════════════════════════════════════════

def test_anchor_dates_day_and_week_unchanged():
    """period="day" 逐日；week/month 行為不得改變（回歸）。"""
    from datetime import date
    from app.jobs.research.build_analysis_digests import anchor_dates
    s, e = date(2024, 1, 1), date(2024, 1, 31)
    days = anchor_dates(s, e, "day")
    assert len(days) == 31 and days[0] == s and days[-1] == e
    # 週頻仍只取週五
    weeks = anchor_dates(s, e, "week")
    assert all(d.weekday() == 4 for d in weeks)
    # 月頻仍取月底
    months = anchor_dates(date(2024, 1, 1), date(2024, 3, 31), "month")
    assert [d.isoformat() for d in months] == ["2024-01-31", "2024-02-29", "2024-03-31"]


def test_training_anchors_day_only_trading_days():
    """日頻錨點只保留真正的交易日，且 h20 實現日 <= train_end。"""
    rows = _synthetic_rows()
    anchors = mt.training_anchors("2330", "2024-01-01", "2024-12-31",
                                  price_rows=rows, horizon_max=20, period="day")
    trading = {d for d, _ in rows if d <= "2024-12-31"}
    assert len(anchors) > 100, "日頻應遠多於週頻"
    for a in anchors:
        assert a in trading, f"{a} 不是交易日"
    capped = [(d, c) for d, c in rows if d <= "2024-12-31"]
    for a in anchors:
        assert mt.actual_from_rows(capped, a, 20) is not None


def test_split_batches_temporal_embargo_prevents_overlap():
    """時間連續切分：held-out 起點與歸納池終點之間至少隔 embargo 個錨點。"""
    cases = [_case(f"c{i}", f"2024-{(i//20)+1:02d}-{(i%20)+1:02d}", 1.0, 5.0) for i in range(100)]
    b1, b2 = mt.split_batches_temporal(cases, heldout_frac=0.4, embargo=20)
    assert b1 and b2
    # 時間上完全不重疊，且中間有 embargo 缺口
    assert max(c.as_of for c in b1) < min(c.as_of for c in b2)
    ids1, ids2 = {c.case_id for c in b1}, {c.case_id for c in b2}
    assert not (ids1 & ids2)
    assert len(b2) == 40
    assert len(b1) == 100 - 40 - 20  # 扣掉 embargo


def test_stratified_sample_preserves_distribution():
    """分層抽樣後 up/flat/down 比例應貼近母體（差距 < 10 個百分點）。"""
    cases = ([_case(f"u{i}", f"2024-01-{i+1:02d}", 1.0, 8.0) for i in range(60)]
             + [_case(f"f{i}", f"2024-02-{i+1:02d}", 0.1, 0.5) for i in range(30)]
             + [_case(f"d{i}", f"2024-03-{i+1:02d}", -1.0, -8.0) for i in range(10)])
    picked = mt.stratified_sample(cases, 40, horizon=20, seed=42)
    assert len(picked) == 40
    from collections import Counter
    got = Counter(c.dir_h20 for c in picked)
    for lab, want in (("up", 0.6), ("flat", 0.3), ("down", 0.1)):
        assert abs(got[lab] / 40 - want) < 0.10, f"{lab} 比例偏離母體：{got[lab]/40} vs {want}"
    # 結果依 as_of 排序
    assert [c.as_of for c in picked] == sorted(c.as_of for c in picked)


def test_stratified_sample_returns_all_when_k_exceeds():
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(5)]
    assert len(mt.stratified_sample(cases, 40)) == 5


def test_parse_curve_spec():
    assert mt.parse_curve_spec("50,150,300,all", 481) == [50, 150, 300, 481]
    # 超過池大小者被夾到池大小、去重、升冪
    assert mt.parse_curve_spec("300,50,all", 100) == [50, 100]


def test_cases_jsonl_roundtrip(tmp_path):
    """JSONL 寫入/讀回一致。"""
    cases = [_case(f"2330_2024-01-{i+1:02d}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(3)]
    p = tmp_path / "cases.jsonl"
    from dataclasses import asdict
    with p.open("w", encoding="utf-8") as f:
        for c in cases:
            f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")
    back = mt._read_cases_jsonl(p)
    assert [c.case_id for c in back] == [c.case_id for c in cases]
    assert back[0].actual_h20 == 5.0 and back[0].dir_h20 == "up"


def test_load_or_build_cases_prefers_jsonl_and_falls_back_to_json(tmp_path):
    """新格式 cases.jsonl 優先；沒有時仍能讀舊格式 cases.json（回溯相容）。"""
    from dataclasses import asdict
    cases = [_case(f"2330_2024-01-{i+1:02d}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(3)]
    cache_path = tmp_path / "cases.json"

    # 只有舊格式
    cache_path.write_text(json.dumps(
        {"config": {}, "cases": [asdict(c) for c in cases]}, ensure_ascii=False))
    got = mt.load_or_build_cases(cache_path, "2330", "2024-01-01", "2024-12-31", None, None)
    assert len(got) == 3

    # 有新格式時優先用新格式
    with cache_path.with_suffix(".jsonl").open("w", encoding="utf-8") as f:
        for c in cases[:2]:
            f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")
    (tmp_path / "cases_meta.json").write_text(json.dumps(dict(
        stock="2330", train_start="2024-01-01", train_end="2024-12-31",
        period="week", window_days=14, complete=True, n_cases=2, limit=None)), encoding="utf-8")
    got2 = mt.load_or_build_cases(cache_path, "2330", "2024-01-01", "2024-12-31", None, None)
    assert len(got2) == 2


def test_learning_curve_shares_identical_heldout(monkeypatch, tmp_path):
    """學習曲線的核心不變式：各檔位必須用同一個 held-out，否則曲線不可比。"""
    cases = [_case(f"2330_d{i:03d}", f"2024-{(i//25)+1:02d}-{(i%25)+1:02d}", 1.0, 5.0)
             for i in range(100)]
    seen_heldout = []

    def fake_setup(args, need_llm=True):
        return "2330", tmp_path, object(), "FakeModel", cases

    def fake_run_iterations(client, model_name, args, stock_id, pool, heldout,
                            cache, cache_path, out_dir, tag_prefix="train",
                            n_induction_cases=40, write_versions=True):
        seen_heldout.append(tuple(c.case_id for c in heldout))
        versions = {0: {"methodology": {}, "prompt_template": "T"}}
        log = [{"k": 0, "heldout_h20": 0.5, "heldout_h5": 0.5,
                "always_up_h20_heldout": 0.6}]
        return versions, log

    monkeypatch.setattr(mt, "_setup", fake_setup)
    monkeypatch.setattr(mt, "run_iterations", fake_run_iterations)
    args = SimpleNamespace(stock="2330", train_start="2024-01-01", train_end="2024-12-31",
                           provider="h200", period="day", window_days=14, rounds=1,
                           limit=None, rebuild_cases=False, induction_cases=40,
                           curve="10,20,all", out_dir=str(tmp_path))
    mt.run_learning_curve(args)

    assert len(seen_heldout) == 3, "應跑三個檔位"
    assert len(set(seen_heldout)) == 1, "各檔位的 held-out 必須完全相同"

    curve = json.loads((tmp_path / "learning_curve.json").read_text())
    assert [p["n_train"] for p in curve["points"]] == [10, 20, curve["pool_n"]]
    assert curve["held_out_n"] == len(seen_heldout[0])
    assert curve["embargo"] == mt.HORIZON_MAX
    # delta_vs_always_up 應被算出來（0.5 - 0.6）
    assert curve["points"][0]["delta_vs_always_up"] == pytest.approx(-0.1)


@pytest.mark.parametrize("spec", ["0", "-1,all", " , "])
def test_curve_rejects_invalid_sizes(spec):
    with pytest.raises(ValueError):
        mt.parse_curve_spec(spec, 40)


def test_temporal_split_rejects_empty_induction_pool():
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(30)]
    with pytest.raises(ValueError, match="Not enough cases"):
        mt.split_batches_temporal(cases)


def test_prediction_cache_tracks_prompt_model_and_context(monkeypatch):
    calls = []
    monkeypatch.setattr(mt, "predict_change_pct", lambda *a, **kw: calls.append(a) or 2.0)
    monkeypatch.setattr(mt.time, "sleep", lambda *_: None)
    case = _case("2330_2024-01-05", "2024-01-05", 2.0, 4.0)
    cache = {}
    for template, model in [("A", "m"), ("A", "m"), ("B", "m"), ("B", "other")]:
        mt.evaluate_prompt_on_cases(None, model, "h200", "2330", [case], template, "v0", cache)
    assert len(calls) == 6
    case.context_block = "changed news"
    mt.evaluate_prompt_on_cases(None, "other", "h200", "2330", [case], "B", "v0", cache)
    assert len(calls) == 8


def test_jsonl_resume_lazy_client_and_period_identity(monkeypatch, tmp_path):
    from dataclasses import asdict
    cases = [_case(f"2330_2024-01-{i:02d}", f"2024-01-{i:02d}", 1.0, 5.0) for i in (5, 12)]
    cache = tmp_path / "cases.json"
    jsonl = cache.with_suffix(".jsonl")
    jsonl.write_text(json.dumps(asdict(cases[0])) + "\n", encoding="utf-8")
    meta = dict(stock="2330", train_start="2024-01-01", train_end="2024-12-31",
                window_days=14, period="week", complete=False, limit=None)
    (tmp_path / "cases_meta.json").write_text(json.dumps(meta), encoding="utf-8")
    clients = []
    builds = []
    monkeypatch.setattr(mt, "build_qdrant_embeddings", lambda: (clients.append(1) or object(), None))
    def build(*args, **kwargs):
        builds.append(1)
        assert kwargs["out_path"] == jsonl
        jsonl.write_text("".join(json.dumps(asdict(c)) + "\n" for c in cases), encoding="utf-8")
        return cases
    monkeypatch.setattr(mt, "build_cases", build)
    for _ in range(2):
        result = mt.load_or_build_cases(cache, "2330", "2024-01-01", "2024-12-31", None, None)
        assert len(result) == 2
    assert len(clients) == len(builds) == 1
    with pytest.raises(ValueError, match="configuration changed"):
        mt.load_or_build_cases(cache, "2330", "2024-01-01", "2024-12-31", None, None, period="day")


@pytest.mark.parametrize("tail", [b'{"case_id":', b'{"title":"\xe5\x8f'])
def test_build_cases_repairs_truncated_final_record(monkeypatch, tmp_path, tail):
    from dataclasses import asdict
    first = _case("2330_2024-01-05", "2024-01-05", 1.0, 5.0)
    out = tmp_path / "cases.jsonl"
    out.write_bytes((json.dumps(asdict(first)) + "\n").encode("utf-8") + tail)
    monkeypatch.setattr(mt, "load_price_frame", lambda *a: [])
    monkeypatch.setattr(mt, "training_anchors", lambda *a, **k: ["2024-01-05", "2024-01-12"])
    fetched = []
    monkeypatch.setattr(mt, "fetch_pit_articles", lambda *a, **k: (fetched.append(a[3]) or [], []))
    monkeypatch.setattr(mt, "fetch_prices", lambda *a, **k: [])
    monkeypatch.setattr(mt, "actual_from_rows", lambda *a: 5.0)
    monkeypatch.setattr(mt.time, "sleep", lambda *a: None)
    built = mt.build_cases("2330", "2024-01-01", "2024-12-31", object(), None, out_path=out)
    assert fetched == ["2024-01-12"]
    assert len(built) == len(mt._read_cases_jsonl(out)) == 2


def test_train_prefers_zero_hit_rate_over_missing(monkeypatch, tmp_path):
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(4)]
    monkeypatch.setattr(mt, "_setup", lambda args: ("2330", tmp_path, object(), "m", cases))
    logs = [dict(k=0, heldout_h20=None, heldout_h5=1.0), dict(k=1, heldout_h20=0.0, heldout_h5=0.0)]
    monkeypatch.setattr(mt, "run_iterations", lambda *a, **k: ({}, logs))
    args = SimpleNamespace(period="week", induction_cases=40, train_start="2024-01-01",
                           train_end="2024-12-31", provider="h200", rounds=1, window_days=14)
    mt.train(args)
    assert json.loads((tmp_path / "best.json").read_text(encoding="utf-8"))["version"] == 1


def test_iterations_write_versions_and_report_real_sample_count(monkeypatch, tmp_path):
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(6)]
    monkeypatch.setattr(mt, "call_induction_llm", lambda *a: json.loads(_valid_induction_json()))
    monkeypatch.setattr(mt, "predict_change_pct", lambda *a, **k: 5.0)
    monkeypatch.setattr(mt.time, "sleep", lambda *a: None)
    args = SimpleNamespace(train_start="2024-01-01", train_end="2024-12-31", provider="h200", rounds=1)
    versions, logs = mt.run_iterations(None, "m", args, "2330", cases[:4], cases[4:], {},
                                      tmp_path / "eval_cache.json", tmp_path, n_induction_cases=2)
    assert set(versions) == {0, 1}
    assert [log["n_induction_cases"] for log in logs] == [2, 2]
    assert all(log["heldout_h20"] == 1.0 for log in logs)
    assert (tmp_path / "prompt_v1.txt").read_text(encoding="utf-8") == _GOOD_TEMPLATE


def test_main_build_cases_only_skips_llm(monkeypatch, tmp_path):
    calls = []
    def setup(args, need_llm=True):
        calls.append((args.period, need_llm))
        return "2330", tmp_path, None, None, []
    monkeypatch.setattr(mt, "_setup", setup)
    assert mt.main(["--build-cases-only", "--period", "day"]) == 0
    assert calls == [("day", False)]



def test_failed_predictions_are_retried(monkeypatch):
    predictions = iter([None, 5.0])
    monkeypatch.setattr(mt, "predict_change_pct", lambda *a, **k: next(predictions))
    monkeypatch.setattr(mt.time, "sleep", lambda *a: None)
    cases = [_case("c1", "2024-01-05", 1.0, 5.0)]
    cache = {}
    first = mt.evaluate_prompt_on_cases(None, "m", "h200", "2330", cases, "T", "v0", cache, horizons=(20,))
    second = mt.evaluate_prompt_on_cases(None, "m", "h200", "2330", cases, "T", "v0", cache, horizons=(20,))
    assert first["c1"]["h20"] is None
    assert second["c1"]["h20"] == 5.0


def test_induction_error_does_not_echo_credentials(monkeypatch, capsys):
    prompts = []
    def create(**kwargs):
        prompts.append(kwargs["messages"][-1]["content"])
        raise RuntimeError("secret-token-in-http-error")
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    monkeypatch.setattr(mt.time, "sleep", lambda *a: None)
    with pytest.raises(RuntimeError) as error:
        mt.call_induction_llm(client, "m", "h200", "PROMPT")
    assert "secret-token" not in str(error.value) + capsys.readouterr().out + "".join(prompts)
    assert "RuntimeError" in prompts[-1]


def test_learning_curve_handles_all_failed_predictions(monkeypatch, tmp_path):
    cases = [_case(f"c{i}", f"2024-01-{i+1:02d}", 1.0, 5.0) for i in range(8)]
    monkeypatch.setattr(mt, "_setup", lambda args: ("2330", tmp_path, object(), "m", cases))
    monkeypatch.setattr(mt, "call_induction_llm", lambda *a: json.loads(_valid_induction_json()))
    monkeypatch.setattr(mt, "predict_change_pct", lambda *a, **k: None)
    monkeypatch.setattr(mt.time, "sleep", lambda *a: None)
    args = SimpleNamespace(period="week", induction_cases=40, train_start="2024-01-01",
                           train_end="2024-12-31", provider="h200", rounds=0, curve="all")
    assert mt.run_learning_curve(args) == tmp_path
    point = json.loads((tmp_path / "learning_curve.json").read_text(encoding="utf-8"))["points"][0]
    assert point["heldout_h20"] is point["delta_vs_always_up"] is None
