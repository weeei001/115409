"""Synthetic evidence tests; these values are not audited market observations."""
import json

import pytest

from app.features.chat.claims import numeric_claim_issue
from app.features.chat.comparison_validation import checked_comparison_observations, unsupported_comparison
from app.features.chat.schemas import SourceChunk


CATALOG = {symbol: {"name": name} for symbol, name in (
    ("2412", "中華電"), ("2501", "國建"), ("2542", "興富發"), ("2707", "晶華"))}


def evidence():
    return SourceChunk(citation_id="S1", title="Synthetic comparison", source="test",
                       source_name="Test", pub_time="", url="", stock_id="", score=1,
                       category="comparison", content=json.dumps({
                           "common_start_date": "2026-09-09", "common_end_date": "2026-10-07",
                           "stocks": [
                               {"symbol": "2412", "interval_return_pct": 4.30,
                                "annualized_volatility_pct": 10.69, "max_drawdown_pct": -1.37},
                               {"symbol": "2501", "interval_return_pct": -8.04},
                               {"symbol": "2542", "interval_return_pct": -19.50},
                               {"symbol": "2707", "interval_return_pct": -1.68},
                           ],
                       }))


LONG = ("評選依據與多股比較：在 2026-09-09 至 2026-10-07 的共同比較期間內，"
        "中華電（2412）區間報酬率為 4.30%，年化波動度（衡量股價起伏劇烈程度的指標）僅 10.69%，"
        "最大回撤（期間內從最高點跌下來的最大幅度）僅 -1.37%，表現比同期間區間報酬率為負的"
        "國建（2501，區間報酬率 -8.04%）、興富發（2542，區間報酬率 -19.50%）與"
        "晶華（2707，區間報酬率 -1.68%）更為抗跌穩健。")


@pytest.mark.parametrize("text", [
    LONG,
    LONG.replace("僅", "為"),
    LONG.replace("（衡量股價起伏劇烈程度的指標）", "").replace("（期間內從最高點跌下來的最大幅度）", ""),
    LONG.replace("%，年化", "%[S1]，年化").replace("穩健。", "穩健。[S1]"),
    "中華電（2412）區間報酬率為 4.30%。中華電年化波動度為 10.69%。中華電最大回撤為 -1.37%。"
    "國建區間報酬率 -8.04%。興富發區間報酬率 -19.50%。晶華區間報酬率 -1.68%。",
])
def test_wording_does_not_change_numeric_verdict(text):
    assert numeric_claim_issue(text, [evidence()], CATALOG) is None


@pytest.mark.parametrize("text", [
    LONG.replace("4.30%", "40.30%"),
    LONG.replace("2026-10-07", "2026-10-08"),
    LONG.replace("中華電（2412）", "國建（2501）"),
])
def test_company_date_and_value_changes_still_fail(text):
    assert numeric_claim_issue(text, [evidence()], CATALOG) is not None


@pytest.mark.parametrize("annotation", ["不是此指標", "若未來成立", "殖利率", "可能達到"])
def test_parentheses_do_not_erase_negation_conditions_or_other_metrics(annotation):
    issue = numeric_claim_issue(f"中華電年化波動度（{annotation}）10.69%", [evidence()], CATALOG)
    assert issue is not None
    assert issue.reason == "unparsed"


def test_return_comparison_does_not_imply_stability():
    assert unsupported_comparison(LONG, [evidence()], CATALOG)
    assert unsupported_comparison("中華電同期報酬率較高。", [evidence()], CATALOG) is None
    assert unsupported_comparison("不能據此認為中華電更穩健。", [evidence()], CATALOG) is None


def test_projection_retains_verified_numbers_without_conclusions():
    recovered = checked_comparison_observations(LONG, [evidence()], CATALOG)
    assert recovered and "穩健" not in recovered
    assert all(number in recovered for number in ("4.30", "10.69", "-1.37", "-8.04", "-19.50", "-1.68"))
    assert numeric_claim_issue(recovered, [evidence()], CATALOG) is None
    assert unsupported_comparison(recovered, [evidence()], CATALOG) is None


@pytest.mark.parametrize("prefix", ["如果", "不是", "未來可能"])
def test_projection_does_not_turn_scoped_claims_into_facts(prefix):
    assert checked_comparison_observations(prefix + LONG, [evidence()], CATALOG) is None


@pytest.mark.parametrize("annotation", ["實際為開盤價", "亦即開盤價", "公司稱為最高價", "指的是營收", "開盤價"])
def test_parenthetical_redefinitions_do_not_borrow_another_metrics_value(annotation):
    from app.features.chat.answer_validation import NumericValidationError, _checked_answer

    source = SourceChunk(citation_id="S1", title="Synthetic close", source="test", source_name="Test",
                         pub_time="", url="", stock_id="2330", score=1, category="market_technical",
                         content=json.dumps({"columns": ["date", "close"], "rows": [["2026-10-01", 100]]}))
    text = f"2330收盤價（{annotation}）100元。[S1]"
    issue = numeric_claim_issue(text, [source])
    assert issue is not None and issue.reason == "unparsed"
    with pytest.raises(NumericValidationError):
        _checked_answer(text, {"finish_reason": "stop"}, [source])
