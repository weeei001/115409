"""Validate comparison prose using the same six-stock source shape as the browser flow."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {
    "2412": {"name": "中華電"}, "2409": {"name": "友達"}, "2501": {"name": "國建"},
    "2542": {"name": "興富發"}, "2707": {"name": "晶華"}, "2609": {"name": "陽明"},
}
STOCKS = [
    {"symbol": "2412", "first_common_close": 110, "last_common_close": 114,
     "interval_return_pct": 3.636364, "annualized_volatility_pct": 11.123456, "max_drawdown_pct": -1.654321},
    {"symbol": "2409", "first_common_close": 17, "last_common_close": 16.65,
     "interval_return_pct": -2.058824, "annualized_volatility_pct": 42.543210, "max_drawdown_pct": -5.432198},
    {"symbol": "2501", "first_common_close": 45, "last_common_close": 46.5,
     "interval_return_pct": 3.333333, "annualized_volatility_pct": 20.987654, "max_drawdown_pct": -2.123456},
    {"symbol": "2542", "first_common_close": 49, "last_common_close": 47.5,
     "interval_return_pct": -3.061224, "annualized_volatility_pct": 30.876543, "max_drawdown_pct": -6.234567},
    {"symbol": "2707", "first_common_close": 190, "last_common_close": 198,
     "interval_return_pct": 4.210526, "annualized_volatility_pct": 25.654321, "max_drawdown_pct": -3.765432},
    {"symbol": "2609", "first_common_close": 65, "last_common_close": 63,
     "interval_return_pct": -3.076923, "annualized_volatility_pct": 35.456789, "max_drawdown_pct": -7.654321},
]


def comparison_source():
    payload = {
        "requested_start_date": "2026-09-05", "requested_end_date": "2026-10-05",
        "common_start_date": "2026-09-07", "common_end_date": "2026-10-02",
        "common_price_samples": 17, "common_daily_return_samples": 16,
        "daily_return_start_date": "2026-09-07", "daily_return_end_date": "2026-10-02",
        "observed_union_date_count": 17,
        "stocks": [dict(stock, available_start_date="2026-09-07", available_end_date="2026-10-02",
                        available_price_samples=17, missing_observed_dates=0) for stock in STOCKS],
        "correlations": [],
        "limitations": ["Prices are unadjusted closes in TWD per share; returns exclude dividends, fees and taxes."],
    }
    return SourceChunk(citation_id="S20", title="Six-stock comparison", source="system_comparison",
                       source_name="Comparison", pub_time="2026-10-02", url="", stock_id="",
                       stock_ids=list(CATALOG), score=1, category="comparison", content=json.dumps(payload))


def personal_source():
    payload = {
        "favorites": [{"symbol": symbol, "name": company["name"]} for symbol, company in CATALOG.items()],
        "portfolio": {"initialized": True, "as_of": "2026-10-05T09:00:00+08:00",
                      "available_cash": 50000, "cash": 50000, "equity": 50000,
                      "holdings_value": 0, "cash_allocation_pct": 100,
                      "available_cash_allocation_pct": 100, "reserved_cash_allocation_pct": 0,
                      "holdings_allocation_pct": 0, "positions": []},
    }
    return SourceChunk(citation_id="S1", title="Personal snapshot", source="test", source_name="Test",
                       pub_time="", url="", stock_id="", score=1, category="personal", content=json.dumps(payload))


@pytest.mark.parametrize("stock", STOCKS, ids=lambda stock: stock["symbol"])
@pytest.mark.parametrize("day,field", [
    ("2026-09-07", "first_common_close"), ("2026-10-02", "last_common_close"),
])
def test_comparison_alone_supports_its_dated_start_and_end_closing_prices(stock, day, field):
    answer = f"{day}股票{stock['symbol']}收盤價{stock[field]}元。[S20]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [comparison_source()],
                           company_catalog=CATALOG).startswith(answer)


@pytest.mark.parametrize("answer", [
    "中華電共同起始收盤價110元，期末收盤價114元。",
    "2026-09-07中華電期初收盤價110元。",
    "2026-10-02中華電期末收盤價114元。",
    "2026年9月7日至10月2日中華電期初收盤價110元、期末收盤價114元。",
])
def test_endpoint_labels_identify_comparison_prices_without_an_ambiguous_current_price(answer):
    assert numeric_claims_supported(answer, [comparison_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "中華電區間漲幅3.64%。", "友達區間下跌2.06%。",
    "中華電區間漲跌幅+3.64%。", "友達區間漲跌幅-2.06%。",
    "2026-09-07至2026-10-02中華電上漲3.64%。",
    "2026-09-07至2026-10-02友達下跌2.06%。",
    "中華電區間報酬率3.64%，年化波動度11.12%，最大回撤-1.65%。",
])
def test_interval_direction_wording_can_refer_to_computed_comparison_returns(answer):
    assert numeric_claims_supported(answer, [comparison_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "中華電單日漲幅3.64%。", "中華電當日報酬率3.64%。",
    "友達單日下跌2.06%。", "友達當日報酬率-2.06%。",
    "2026-09-07至2026-10-02中華電單日漲幅3.64%。",
    "2026-09-07至2026-10-02友達當日報酬率-2.06%。",
    "2026-09-07至2026-10-02中華電每日上漲3.64%。",
    "2026-09-07至2026-10-02中華電每天股價上漲3.64%。",
])
def test_interval_metrics_cannot_establish_single_day_changes(answer):
    assert not numeric_claims_supported(answer, [comparison_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "2026年9月7日至10月2日中華電區間報酬率3.64%。",
    "2026年9月7日到10月2日友達區間報酬率-2.06%。",
    "2026年9月7日至2026年10月2日中華電區間漲幅3.64%。",
])
def test_chinese_date_ranges_can_omit_the_repeated_end_year(answer):
    assert numeric_claims_supported(answer, [comparison_source()], CATALOG)


@pytest.mark.parametrize("answer", [
    "2026-10-02中華電收盤價198元。",
    "2026-09-07中華電收盤價114元。", "2026-10-02中華電收盤價110元。",
    "2026-10-01中華電收盤價114元。", "2026-10-02中華電收盤價115元。",
    "中華電目前收盤價110元。", "中華電收盤價114元。",
    "2026-09-05至2026-10-05中華電收盤價114元。",
    "2026-10-02中華電期初收盤價110元。",
    "2026-09-07中華電期末收盤價114元。",
    "友達區間漲幅2.06%。", "中華電區間下跌3.64%。",
    "中華電區間漲幅4.21%。", "友達區間下跌2.05%。",
    "2026年9月8日至10月2日中華電區間報酬率3.64%。",
    "2026年9月7日至10月1日友達區間報酬率-2.06%。",
    "中華電區間報酬率3.6%。", "中華電年化波動度11.1%。",
])
def test_comparison_claims_keep_company_date_direction_value_and_precision_checks(answer):
    assert not numeric_claims_supported(answer, [comparison_source()], CATALOG)


def test_complete_favorites_research_answer_with_personal_and_comparison_citations():
    answer = (
        "可用資金50000元，本次先比較收藏中的六檔股票。[S1][S20]\n\n"
        "優先研究中華電與晶華。2026年9月7日至10月2日，中華電區間漲幅3.64%、"
        "年化波動度11.12%，晶華區間漲幅4.21%。這些是歷史價格資料，仍需核對基本面與風險。[S20]\n\n"
        "建議先保留80%的現金，其餘待完成研究後再決定是否投入。[S1]"
    )
    result = _checked_answer(answer, {"finish_reason": "stop"}, [personal_source(), comparison_source()],
                             company_catalog=CATALOG)
    assert result.startswith(answer)


def test_comparison_observation_date_does_not_override_the_account_snapshot_date():
    answer = "2026-09-07中華電期初收盤價110元，可用資金50000元。[S1][S20]"
    assert _checked_answer(answer, {"finish_reason": "stop"}, [personal_source(), comparison_source()],
                           company_catalog=CATALOG).startswith(answer)


def test_complete_answer_does_not_borrow_comparison_returns_from_a_different_company():
    answer = "可用資金50000元。[S1]\n\n優先研究中華電，因為中華電區間漲幅4.21%。[S20]"
    with pytest.raises(NumericValidationError):
        _checked_answer(answer, {"finish_reason": "stop"}, [personal_source(), comparison_source()],
                        company_catalog=CATALOG)
