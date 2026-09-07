"""methodology_trainer.py 的單元測試：洩漏防護、錨點邊界、template/methodology 驗證、best 選擇。

全部用 mock，不打 Qdrant / LLM / yfinance。
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import methodology_trainer as mt  # noqa: E402


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
