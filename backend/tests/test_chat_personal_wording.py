"""Replay audited comparison wording with small, synthetic evidence only."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.schemas import SourceChunk


CATALOG = {"2412": {"name": "中華電"}, "2409": {"name": "友達"}}


def source(citation_id, category, payload, symbol=""):
    return SourceChunk(citation_id=citation_id, category=category, stock_id=symbol,
                       title="Synthetic evidence", source="test", source_name="Test",
                       pub_time="", url="", score=1,
                       content=json.dumps(payload, ensure_ascii=False))


SOURCES = [
    source("S1", "comparison", {
        "common_start_date": "2026-09-09", "common_end_date": "2026-10-07",
        "requested_start_date": "2026-09-09", "requested_end_date": "2026-10-07",
        "stocks": [
            {"symbol": "2412", "interval_return_pct": 4.30,
             "annualized_volatility_pct": 10.69, "max_drawdown_pct": -1.37},
            {"symbol": "2409", "annualized_volatility_pct": 88.53},
        ],
    }),
    source("S2", "fundamental", {"items": [
        {"field": "eps", "period": "2026Q2", "value": 1.38},
        {"field": "operating_margin_pct", "period": "2026Q2", "value": 21.6},
    ]}, "2412"),
]


def check(answer):
    return _checked_answer(answer, {"finish_reason": "stop"}, SOURCES,
                           company_catalog=CATALOG)


@pytest.mark.parametrize("answer", [
    "中華電年化波動度僅10.69%，低於年化波動度高達88.53%的友達（2409）。[S1]",
    "中華電年化波動度10.69%，低於年化波動度88.53%的2409。[S1]",
    "在2026-09-09至2026-10-07共同期間，中華電區間價格報酬率4.30%，"
    "年化波動度10.69%、最大回撤-1.37%，低於年化波動度高達88.53%的友達（2409）。[S1]",
    "中華電年化波動度僅為10.69%；且2026Q2每股盈餘1.38元。[S1][S2]",
    "中華電年化波動度10.69%，低於年化波動度88.53%的友達；"
    "且中華電2026Q2每股盈餘1.38元、營業利益率21.6%。[S1][S2]",
])
def test_supported_qualifiers_and_adjacent_postposed_subjects_pass(answer):
    assert check(answer).startswith(answer)


@pytest.mark.parametrize("answer", [
    "中華電年化波動度高達88.53%。[S1]",
    "年化波動度高達10.69%的友達。[S1]",
    "年化波動度高達88.53%的中華電。[S1]",
    "友達年化波動度高達88.53%。[S2]",
    "中華電年化波動度10.69%，低於年化波動度88.53%的友達；"
    "且2026Q2每股盈餘1.38元、營業利益率21.6%。[S1][S2]",
    "中華電年化波動度10.69%，低於年化波動度88.53%的友達；"
    "且2026Q2每股盈餘1.38元。[S1] [S2]",
    "中華電年化波動度10.69%；且2026Q1每股盈餘1.38元。[S1][S2]",
])
def test_postposed_subject_does_not_lend_another_company_financials(answer):
    with pytest.raises(NumericValidationError):
        check(answer)


@pytest.mark.parametrize("value,accepted", [(40, True), (100, False)])
def test_exact_account_field_alias_does_not_hide_the_metric(value, accepted):
    from test_chat_personal_validation import personal_source
    answer = f"可用資金占比 available_cash_allocation_pct 為{value}%。[S1]"
    if accepted:
        assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()]).startswith(answer)
    else:
        with pytest.raises(NumericValidationError):
            _checked_answer(answer, {"finish_reason": "stop"}, [personal_source()])


def test_different_account_field_alias_is_not_silently_removed():
    from test_chat_personal_validation import personal_source
    with pytest.raises(NumericValidationError):
        _checked_answer("可用資金占比 holdings_allocation_pct 為40%。[S1]",
                        {"finish_reason": "stop"}, [personal_source()])
