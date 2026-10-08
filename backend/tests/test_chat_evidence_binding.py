"""Numeric statements must keep their evidence meaning, not just reuse a number."""
import json

import pytest

from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}


def source(content, category="news", symbol="2330"):
    return SourceChunk(citation_id="S1", title="Evidence", source="test", source_name="Test",
                       pub_time="2026-10-06", url="", stock_id=symbol, score=1, category=category,
                       content=content if isinstance(content, str) else json.dumps(content))


@pytest.mark.parametrize("claim", [
    "2330上漲2%。",
    "2330EPS100元。",
    "2026-10-09 2330收盤價100元。",
    "2330收盤價100元（2026-10-09）。",
    "2330收盤價100美元。",
    "2330收盤價100億元。",
    "2330收盤價-100元。",
    "2317收盤價100元。",
])
def test_news_cannot_override_a_typed_contradiction_with_a_matching_literal(claim):
    news = source("2026-10-02 2330收盤價100元，漲跌幅-2%。")
    assert not numeric_claims_supported(claim, [news], CATALOG)


@pytest.mark.parametrize("claim", [
    "2026-10-02 台積電收盤價100元。",
    "台積電下跌2%。",
    "台積電漲跌幅-2%。",
])
def test_news_observations_still_accept_the_correct_metric_direction_and_unit(claim):
    news = source("2026-10-02 台積電收盤價100元，漲跌幅-2%。")
    assert numeric_claims_supported(claim, [news], CATALOG)


def test_news_binds_each_number_to_its_local_stock_and_period():
    news = source("台積電2026Q2 EPS3元，鴻海2026Q2 EPS5元。")
    assert numeric_claims_supported("台積電2026Q2 EPS3元。", [news], CATALOG)
    assert not numeric_claims_supported("台積電2026Q2 EPS5元。", [news], CATALOG)
    assert not numeric_claims_supported("台積電2026Q1 EPS3元。", [news], CATALOG)


@pytest.mark.parametrize("claim", ["2330市占率2%。", "2330變動2%。", "2330本益比100倍。"])
def test_equal_market_numbers_do_not_establish_a_different_metric(claim):
    market = source({"columns": ["date", "close", "chg_pct"],
                     "rows": [["2026-10-02", 100, 2]]}, "market_technical")
    assert not numeric_claims_supported(claim, [market], CATALOG)


@pytest.mark.parametrize("claim", [
    "公司表示AI相關營收占比約60%。",
    "台積電外資持股比例72.3%。",
    "台積電股東權益報酬率（ROE）30%。",
    "法說會預期第四季營收將季增10%。",
])
def test_news_has_explicit_metrics_for_supported_company_percentages(claim):
    news = source("台積電法說會預期第四季營收將季增10%，AI相關營收占比約60%。"
                  "台積電外資持股比例72.3%，股東權益報酬率（ROE）30%。")
    assert numeric_claims_supported(claim, [news], CATALOG)


@pytest.mark.parametrize("claim", [
    "台積電外資持股比例60%。",
    "台積電股東權益報酬率72.3%。",
    "鴻海外資持股比例72.3%。",
    "法說會預期第三季營收將季增10%。",
    "未來營收可望季增10%。",
    "報導指出預期報酬率10%。",
])
def test_news_percentage_labels_periods_and_forecast_attribution_are_not_interchangeable(claim):
    news = source("台積電法說會預期第四季營收將季增10%，AI相關營收占比約60%。"
                  "台積電外資持股比例72.3%，股東權益報酬率（ROE）30%。")
    assert not numeric_claims_supported(claim, [news], CATALOG)


def test_forecast_speaker_is_bound_to_the_sentence_containing_that_number():
    news = source("公司預期第四季營收將季增10%。外資認為產業仍需觀察。")
    assert numeric_claims_supported("公司預期第四季營收將季增10%。", [news])
    assert numeric_claims_supported("報導提到，預期第四季營收將季增10%。", [news])
    assert not numeric_claims_supported("外資預期第四季營收將季增10%。", [news])
    assert not numeric_claims_supported("預期第四季營收將季增10%。", [news])


def test_educational_percentages_require_the_whole_local_definition():
    definition = source("範例配置為股票70%、債券30%。", "knowledge", "")
    assert numeric_claims_supported("範例配置為股票70%、債券30%。", [definition])
    assert not numeric_claims_supported("範例配置為股票30%、債券70%。", [definition])
    assert not numeric_claims_supported("台積電市占率70%。", [definition], CATALOG)
    assert not numeric_claims_supported("範例配置為股票70%、債券30%。",
                                        [source({"values": [70, 30]}, "knowledge", "")])


@pytest.mark.parametrize("claim,supported", [
    ("可用資金123456元。", True),
    ("可用資金約12.35萬元。", True),
    ("可用資金大約12.35萬元。", True),
    ("可用資金約12.3456萬元。", True),
    ("可用資金12.35萬元。", False),
    ("可用資金約12.34萬元。", False),
    ("可用資金約123457元。", False),
    ("可用資金約12.35萬美元。", False),
])
def test_account_summary_rounds_only_marked_large_units(claim, supported):
    personal = source({"portfolio": {"initialized": True, "available_cash": 123456}}, "personal", "")
    assert numeric_claims_supported(claim, [personal]) is supported


def test_account_rounding_does_not_apply_to_shares_counts_ratios_or_costs():
    personal = source({"portfolio": {"initialized": True, "available_cash": 123450,
        "cash_allocation_pct": 66.67, "positions": [
            {"symbol": "2330", "quantity": 1234, "average_cost": 123456}]}}, "personal", "")
    assert numeric_claims_supported("可用資金約12.35萬元。", [personal])
    for claim in ("台積電持股約1張。", "持股檔數約2檔。", "現金占比約67%。",
                  "台積電平均成本約12.35萬元。"):
        assert not numeric_claims_supported(claim, [personal], CATALOG)


def test_valuation_fields_use_the_actual_fundamental_contract():
    fundamental = source({"items": [{"field": "per", "date": "2026-10-02", "value": 18.25},
                                     {"field": "pbr", "date": "2026-10-02", "value": 2.4}]}, "fundamental")
    assert numeric_claims_supported("台積電本益比18.25倍、股價淨值比2.4倍。", [fundamental], CATALOG)
    assert not numeric_claims_supported("台積電本益比2.4倍。", [fundamental], CATALOG)
