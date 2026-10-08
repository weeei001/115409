"""A correct single value cannot support an incorrect full-universe ranking."""
import json

import pytest

from app.features.chat.comparison_validation import unsupported_comparison
from app.features.chat.schemas import SourceChunk


CATALOG = {"2412": {"name": "中華電"}, "2707": {"name": "晶華"}, "2409": {"name": "友達"}}
PAYLOAD = {
    "common_start_date": "2026-09-09", "common_end_date": "2026-10-07",
    "stocks": [
        {"symbol": "2412", "annualized_volatility_pct": 10.69,
         "interval_return_pct": 4.30, "max_drawdown_pct": -1.37},
        {"symbol": "2707", "annualized_volatility_pct": 4.75,
         "interval_return_pct": -1.69, "max_drawdown_pct": -2.0},
        {"symbol": "2409", "annualized_volatility_pct": 88.53,
         "interval_return_pct": 24.43, "max_drawdown_pct": -10.58},
    ],
}


def source(payload=None, category="comparison"):
    return SourceChunk(citation_id="S1", title="Synthetic comparison", source="test", source_name="Test",
                       pub_time="", url="", stock_id="", score=1, category=category,
                       content=json.dumps(PAYLOAD if payload is None else payload))


@pytest.mark.parametrize("text", [
    "中華電年化波動度10.69%，表現最為平穩。",
    "中華電年化波動度10.69%，在本輪股票中最低。",
    "中華電區間價格報酬率4.30%，為最高。",
    "中華電最大回撤-1.37%，幅度最大。",
    "中華電最為穩健。",
    "晶華年化波動度4.75%，最穩健。",
])
def test_correct_numbers_do_not_support_false_or_undefined_rankings(text):
    assert unsupported_comparison(text, [source()], CATALOG)


@pytest.mark.parametrize("text", [
    "晶華年化波動度4.75%，為最低。",
    "晶華年化波動度最低，表現最平穩。",
    "友達區間價格報酬率24.43%，居冠。",
    "中華電最大回撤-1.37%，幅度最小。",
    "友達最大回撤-10.58%，幅度最大。",
    "若希望較低波動，可優先討論中華電，並評估估值與投資期限。",
    "中華電年化波動度10.69%，並非最低。",
    "中華電年化波動度10.69%，最大風險是估值修正。",
])
def test_defined_correct_extrema_and_conditional_preferences_pass(text):
    assert unsupported_comparison(text, [source()], CATALOG) is None


@pytest.mark.parametrize("sources", [[], [source(category="market_technical")],
    [source(dict(PAYLOAD, common_end_date=None))],
    [source(dict(PAYLOAD, stocks=[PAYLOAD["stocks"][0]]))],
    [source(dict(PAYLOAD, stocks=[PAYLOAD["stocks"][0], {"symbol": "2707"}]))],
])
def test_rankings_require_complete_locally_cited_common_comparison(sources):
    assert unsupported_comparison("中華電年化波動度最低。", sources, CATALOG)


def test_ranking_date_must_match_and_ties_are_valid():
    assert unsupported_comparison("2026-10-08晶華年化波動度最低。", [source()], CATALOG)
    assert unsupported_comparison("晶華年化波動度在兩檔中最低。", [source()], CATALOG)
    assert unsupported_comparison("晶華年化波動度在3檔中最低。", [source()], CATALOG) is None
    tied = dict(PAYLOAD, stocks=[dict(stock, annualized_volatility_pct=4.75) for stock in PAYLOAD["stocks"]])
    assert unsupported_comparison("中華電年化波動度最低。", [source(tied)], CATALOG) is None


@pytest.mark.parametrize("text,supported", [
    ("友達年化波動度高於其餘2檔。", True),
    ("晶華年化波動度低於其餘 2 檔。", True),
    ("中華電年化波動度高於其餘2檔。", False),
    ("友達年化波動度低於其餘2檔。", False),
    ("友達年化波動度高於其餘5檔。", False),
    ("晶華年化波動度低於其餘1檔。", False),
])
def test_explicit_other_stock_counts_bind_to_the_complete_universe(text, supported):
    assert (unsupported_comparison(text, [source()], CATALOG) is None) is supported


def test_strict_comparison_to_other_stocks_excludes_ties():
    tied = dict(PAYLOAD, stocks=[dict(stock, annualized_volatility_pct=4.75) for stock in PAYLOAD["stocks"]])
    assert unsupported_comparison("晶華年化波動度低於其餘2檔。", [source(tied)], CATALOG)


@pytest.mark.parametrize("text,supported", [
    ("若未來中華電年化波動度最低，再討論加碼。", True),
    ("如果後續中華電年化波動度最低時，才考慮進場。", True),
    ("若未來中華電年化波動度最低，再討論加碼，目前中華電年化波動度最低。", False),
    ("若未來中華電年化波動度最低，再討論加碼；目前中華電年化波動度最低。", False),
    ("假設中華電已是年化波動度最低，再討論加碼。", False),
    ("若未來中華電目前年化波動度最低，再討論加碼。", False),
    ("若中華電年化波動度最低，再討論加碼。", False),
])
def test_only_explicit_future_ranking_prerequisites_are_not_current_observations(text, supported):
    assert (unsupported_comparison(text, [source()], CATALOG) is None) is supported


def test_full_answer_rejects_the_audited_stability_overstatement():
    from app.features.chat.answer_validation import NumericValidationError, _checked_answer
    with pytest.raises(NumericValidationError, match="比較排名"):
        _checked_answer("中華電年化波動度10.69%，表現最為平穩。[S1]", {"finish_reason": "stop"},
                        [source()], company_catalog=CATALOG)


@pytest.mark.parametrize("values,accepted", [("4.30%與-1.69%", True), ("-1.69%與4.30%", False)])
def test_respective_values_keep_their_company_after_optional_transition(values, accepted):
    from app.features.chat.answer_validation import NumericValidationError, _checked_answer
    answer = f"中華電與晶華在同期間區間價格報酬率則分別為{values}。[S1]"
    if accepted:
        assert _checked_answer(answer, {"finish_reason": "stop"}, [source()], company_catalog=CATALOG).startswith(answer)
    else:
        with pytest.raises(NumericValidationError):
            _checked_answer(answer, {"finish_reason": "stop"}, [source()], company_catalog=CATALOG)
