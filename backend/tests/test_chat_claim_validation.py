"""Regression checks for field-aware numeric evidence validation."""
import json

import pytest

from app.features.chat.claims import numeric_claims_supported
from app.features.chat.schemas import SourceChunk

CATALOG = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}


def source(payload, category="market_technical", symbol="2330", citation="S1"):
    return SourceChunk(title="Evidence", source="test", source_name="Test", pub_time="",
                       url="", stock_id=symbol, category=category, score=1, citation_id=citation,
                       content=payload if isinstance(payload, str) else json.dumps(payload))


def market():
    return source({"columns": ["date", "close", "chg_pct"],
                   "rows": [["2026-10-02", 100, 2]]})


def portfolio():
    return source({"portfolio": {"initialized": True, "available_cash": 20000,
                                 "cash_allocation_pct": 66.67,
                                 "holdings_allocation_pct": 33.33,
                                 "positions": [{"symbol": "2330", "allocation_pct": 20}]}}, "personal")


@pytest.mark.parametrize("claim", [
    "鴻海收盤價100元。", "2317 收盤價100元。", "Foxconn收盤價100元。",
    "2026/09/01 收盤價100元。", "股價上漲100%。", "收盤價100張。",
    "收盤價為 **999元**。", "收盤價為 `999元`。", "漲跌幅2元。",
    "可用資金999元。", "占比為100%。", "占比為2%。",
    "收盤價100美元。", "收盤價100USD。", "收盤價100港元。", "收盤價100倍。", "收盤價100億元。",
])
def test_wrong_observations_do_not_pass_by_syntax_or_equal_unrelated_numbers(claim):
    assert not numeric_claims_supported(claim, [market()], CATALOG)


@pytest.mark.parametrize("claim", [
    "台積電收盤價100元。", "2330 收盤價100元。", "TSMC收盤價100元。",
    "2026/10/2 收盤價 **100元**。", "漲跌幅２％。", "股價上漲2%。",
])
def test_normalized_observations_preserve_subject_date_and_units(claim):
    assert numeric_claims_supported(claim, [market()], CATALOG)


def test_direction_is_part_of_observation():
    evidence = source({"columns": ["date", "chg_pct"], "rows": [["2026-10-02", -2]]})
    assert numeric_claims_supported("下跌2%。", [evidence])
    assert not numeric_claims_supported("上漲2%。", [evidence])
    assert not numeric_claims_supported("上漲-2%。", [evidence])


def test_knowledge_example_cannot_establish_a_stock_observation():
    evidence = source("舉例：收盤價100元。", "knowledge")
    assert not numeric_claims_supported("收盤價100元。", [evidence])


def test_longest_company_alias_wins_when_names_overlap():
    catalog = {"1303": {"name": "南亞"}, "2408": {"name": "南亞科"}}
    evidence = market().model_copy(update={"stock_id": "2408"})
    assert numeric_claims_supported("南亞科技收盤價100元。", [evidence], catalog)
    assert not numeric_claims_supported("南亞收盤價100元。", [evidence], catalog)


def test_unrelated_structured_source_does_not_hide_valid_news_evidence():
    news = source("2026-10-02 鴻海收盤價200元。", "news", "2317", "S2")
    claim = "2026/10/02 股票2317收盤價200元。"
    assert numeric_claims_supported(claim, [news], CATALOG)
    assert numeric_claims_supported(claim, [market(), news], CATALOG)
    assert not numeric_claims_supported("台積電收盤價200元。", [market(), news], CATALOG)


@pytest.mark.parametrize("claim", [
    "建議先投入可用資金的20%，其餘保留。",
    "建議將現金占比調整至50%。",
    "可考慮保留現金的20%。",
])
def test_explicit_allocation_proposals_need_not_be_existing_observations(claim):
    assert numeric_claims_supported(claim, [portfolio()])


@pytest.mark.parametrize("claim", [
    "現金占比50%。", "建議先投入可用資金的120%。",
    "建議先投入可用資金的20%，現金占比50%。",
    "建議先投入可用資金的20%。現金占比50%。",
    "建議先投入可用資金的20%，收盤價999元。",
    "持股占比20%。",
])
def test_proposal_exemption_never_covers_another_observation(claim):
    assert not numeric_claims_supported(claim, [portfolio()])


def test_position_and_account_allocations_remain_distinct():
    assert numeric_claims_supported("持股占比33.33%。", [portfolio()])
    assert numeric_claims_supported("股票2330持股占比20%。", [portfolio()])
    assert not numeric_claims_supported("股票2317持股占比20%。", [portfolio()])


def test_previous_amount_is_not_mistaken_for_a_bare_stock_identifier():
    assert numeric_claims_supported("可用資金20000元，台積電收盤價100元。", [portfolio(), market()], CATALOG)
    assert numeric_claims_supported("可用資金20000元，收盤價100元。", [portfolio(), market()])


@pytest.mark.parametrize("value", ["Infinity", "NaN", "not a number", True])
def test_invalid_numeric_source_fails_closed_without_crashing(value):
    evidence = source({"stocks": [{"symbol": "2330", "interval_return_pct": value}]}, "comparison")
    assert not numeric_claims_supported("股票2330區間報酬率5.02%。", [evidence])


@pytest.mark.parametrize("payload", [{"rows": [None]}, {"items": [None]}, "not JSON"])
def test_malformed_source_fails_closed(payload):
    assert not numeric_claims_supported("收盤價100元。", [source(payload)])


def test_comparison_company_alias_and_precision_policy():
    evidence = source({"stocks": [{"symbol": "2330", "interval_return_pct": 5.020921}]}, "comparison")
    assert numeric_claims_supported("台積電區間報酬率5.02%。", [evidence], CATALOG)
    assert not numeric_claims_supported("鴻海區間報酬率5.02%。", [evidence], CATALOG)
    assert not numeric_claims_supported("台積電區間報酬率5.0%。", [evidence], CATALOG)


@pytest.mark.parametrize("metric,label,value", [
    ("gross_margin_pct", "毛利率", 50),
    ("operating_margin_pct", "營業利益率", 40),
    ("dividend_yield", "現金殖利率", 3.25),
])
def test_fundamental_percentage_is_matched_to_its_field(metric, label, value):
    evidence = source({"items": [{"field": metric, "value": value, "date": "2026-06-30"},
                                 {"field": "eps", "value": 99, "date": "2026-06-30"}]}, "fundamental")
    assert numeric_claims_supported(f"{label}{value}%。", [evidence])
    assert not numeric_claims_supported(f"{label}99%。", [evidence])


def test_volume_change_percentage_uses_its_observation_field():
    evidence = source({"columns": ["date", "vol_vs_ma5_pct", "volume_shares"],
                       "rows": [["2026-10-02", -20, 100]]})
    assert numeric_claims_supported("成交量較5日均量減少20%。", [evidence])
    assert not numeric_claims_supported("成交量較5日均量增加100%。", [evidence])


@pytest.mark.parametrize("period", ["2026Q2", "2026年第二季", "2026年", "2026年6月"])
def test_period_labels_are_not_ticker_symbols(period):
    evidence = source({"items": [{"field": "eps", "value": 27.25, "date": "2026-06-30"}]}, "fundamental")
    assert numeric_claims_supported(f"{period} EPS27.25元。", [evidence])


def test_chinese_observation_dates_are_checked():
    assert numeric_claims_supported("2026年10月2日收盤價100元。", [market()])
    assert not numeric_claims_supported("2026年10月1日收盤價100元。", [market()])


def test_missing_account_initialization_does_not_validate_account_balances():
    evidence = source({"portfolio": {"available_cash": 20000,
        "positions": [{"symbol": "2330", "market_price": 100, "market_date": "2026-10-02"}]}}, "personal")
    assert not numeric_claims_supported("可用資金20000元。", [evidence])
    assert numeric_claims_supported("股票2330收盤價100元。", [evidence])


def test_citation_context_supplies_subject_without_rechecking_previous_claims():
    evidence = source({"stocks": [{"symbol": "2330", "interval_return_pct": 5.020921}]}, "comparison")
    assert not numeric_claims_supported("區間報酬率5.02%。", [evidence], context="2317收盤價100元[S1],")
    # The current citation supports the return, not the preceding price.
    assert numeric_claims_supported("區間報酬率5.02%。", [evidence], context="2330收盤價999元[S1],")
    assert numeric_claims_supported("2330區間報酬率5.02%。", [evidence], context="2317收盤價100元[S1],")


def test_citation_context_preserves_date_and_formatting():
    assert numeric_claims_supported("收盤價100元。", [market()], context="**2330** 2026年10月2日，")
    assert not numeric_claims_supported("收盤價100元。", [market()], context="2330 2026年10月1日，")


def test_claim_spanning_citation_boundary_still_checks_new_value():
    assert numeric_claims_supported("100元。", [market()], context="股價")
    assert not numeric_claims_supported("999元。", [market()], context="股價")


@pytest.mark.parametrize("period", ["2026Q2", "2026年第二季"])
def test_explicit_quarter_is_matched_to_source_period(period):
    evidence = source({"items": [{"field": "eps", "value": 27.25,
                                  "period": "2026Q2", "date": "2026-06-30"}]}, "fundamental")
    assert numeric_claims_supported(f"{period} EPS27.25元。", [evidence])
    assert not numeric_claims_supported("2026Q1 EPS27.25元。", [evidence])
    assert not numeric_claims_supported("EPS27.25元。", [evidence], context="2025Q2 ")


def test_elliptical_account_percentages_bind_to_preceding_amount_field():
    evidence = portfolio()
    assert numeric_claims_supported("可用資金20000元，占總資產66.67%。", [
        source({"portfolio": {"initialized": True, "available_cash": 20000,
                               "available_cash_allocation_pct": 66.67}}, "personal")])
    # Equal cash percentage cannot substitute for missing available-cash allocation.
    assert not numeric_claims_supported("可用資金20000元，占總資產66.67%。", [evidence])


def test_account_observations_use_snapshot_date_and_prices_keep_market_date():
    evidence = source({"portfolio": {"initialized": True, "as_of": "2026-10-03T12:00:00+08:00",
        "available_cash": 20000, "positions": [{"symbol": "2330", "allocation_pct": 20,
                                                "market_price": 100, "market_date": "2026-10-02"}]}}, "personal")
    assert numeric_claims_supported("2026-10-03可用資金20000元。", [evidence])
    assert not numeric_claims_supported("2026-10-02可用資金20000元。", [evidence])
    assert numeric_claims_supported("2026-10-03股票2330持股占比20%。", [evidence])
    assert numeric_claims_supported("2026-10-02股票2330收盤價100元。", [evidence])
    assert not numeric_claims_supported("2026-10-03股票2330收盤價100元。", [evidence])


@pytest.mark.parametrize("claim", [
    "基本面顯示 2026 年 8 月營收年增率為 46.7%。",
    "2330 2026年8月營收年增46.7%。",
    "2026-08 單月營收月增率3.2%。",
])
def test_monthly_revenue_growth_uses_precomputed_period_and_change(claim):
    evidence = source({"items": [{"field": "revenue_monthly", "value": 500000,
        "period": "2026-08", "date": "2026-08-01", "yoy_pct": 46.7, "mom_pct": 3.2}]}, "fundamental")
    assert numeric_claims_supported(claim, [evidence])


@pytest.mark.parametrize("claim", [
    "2026年7月營收年增率46.7%。", "2026年8月營收月增率46.7%。",
    "2026年8月EPS年增率46.7%。", "2026年8月營收年增率46.8%。",
    "2317 2026年8月營收年增率46.7%。",
])
def test_growth_does_not_mix_periods_fields_or_companies(claim):
    evidence = source({"items": [{"field": "revenue_monthly", "value": 500000,
        "period": "2026-08", "date": "2026-08-01", "yoy_pct": 46.7, "mom_pct": 3.2}]}, "fundamental")
    assert not numeric_claims_supported(claim, [evidence])


def test_eps_growth_keeps_annual_and_quarterly_changes_distinct():
    evidence = source({"items": [{"field": "eps", "value": 27.25,
        "period": "2026Q2", "date": "2026-06-30", "yoy_pct": 20.1, "qoq_pct": -3.2}]}, "fundamental")
    assert numeric_claims_supported("2026Q2 EPS年增率20.1%、每股盈餘季增率-3.2%。", [evidence])
    assert not numeric_claims_supported("2026Q1 EPS年增率20.1%。", [evidence])
    assert not numeric_claims_supported("2026Q2 EPS季增率20.1%。", [evidence])


def test_unqualified_return_resolves_to_cited_metric_but_daily_label_does_not():
    evidence = source({"stocks": [{"symbol": "2330", "interval_return_pct": 5.020921,
                                   "annualized_volatility_pct": 17.2}]}, "comparison")
    assert numeric_claims_supported("2330報酬率5.02%。", [evidence])
    assert not numeric_claims_supported("2330當日報酬率5.02%。", [evidence])
    assert not numeric_claims_supported("2330漲跌幅5.02%。", [evidence])
    assert not numeric_claims_supported("2317報酬率5.02%。", [evidence])
    assert not numeric_claims_supported("2330報酬率17.2%。", [evidence])
    assert numeric_claims_supported("2330報酬率2%。", [market()])


def test_elliptical_growth_keeps_the_preceding_financial_metric():
    evidence = source({"items": [
        {"field": "eps", "value": 27.25, "period": "2026Q2", "yoy_pct": 77.4},
        {"field": "revenue_monthly", "value": 500000, "period": "2026-08", "yoy_pct": 46.7},
    ]}, "fundamental")
    assert numeric_claims_supported("2026Q2 EPS為27.25元，年增率達77.4%。", [evidence])
    assert numeric_claims_supported("2026年8月營收50萬元，年增率46.7%。", [evidence])
    assert not numeric_claims_supported("2026Q2 EPS為27.25元，年增率達46.7%。", [evidence])
    assert not numeric_claims_supported("2026年8月營收50萬元，年增率77.4%。", [evidence])
    assert not numeric_claims_supported("年增率77.4%。", [evidence])
    assert not numeric_claims_supported("EPS27.25元。年增率77.4%。", [evidence])
    assert numeric_claims_supported("年增率77.4%。", [evidence], context="2026Q2 EPS27.25元，")


def test_natural_anchor_description_uses_a_typed_percentage_fact():
    evidence = source({"columns": ["date", "close"], "rows": [["2026-10-02", 2500]],
        "long_term_anchor": [{"field": "close_pos_in_1y_pct", "value": 99.1, "date": "2026-10-02"}]})
    assert numeric_claims_supported("價格(2500元)接近一年高點(99.1%)。", [evidence])
    assert not numeric_claims_supported("價格(2500元)接近一年高點(2500%)。", [evidence])
    assert not numeric_claims_supported("2317 價格接近一年高點(99.1%)。", [evidence])
    assert not numeric_claims_supported("2026-10-01 價格接近一年高點(99.1%)。", [evidence])


def test_unknown_percentage_wording_requires_percentage_provenance():
    evidence = source({"columns": ["date", "close", "volume_shares", "chg_pct"],
        "rows": [["2026-10-02", 100, 500, 2]], "maximum_observations": 30})
    assert numeric_claims_supported("變動2%。", [evidence])
    for claim in ("變動100%。", "變動500%。", "變動30%。", "2317變動2%。", "2026-10-01變動2%。"):
        assert not numeric_claims_supported(claim, [evidence])
    assert not numeric_claims_supported("占比2%。", [evidence])


def test_parenthetical_metric_aliases_preserve_numeric_validation():
    evidence = source({"items": [{"field": "eps", "value": 3.37,
        "period": "2026Q2", "date": "2026-06-30", "qoq_pct": 87.2}]}, "fundamental")
    assert numeric_claims_supported("2026Q2的每股盈餘(EPS)為3.37元，較前一季大幅成長87.2%。", [evidence])
    assert numeric_claims_supported("2026Q2 EPS(每股盈餘)為3.37元。", [evidence])
    assert not numeric_claims_supported("2026Q2每股盈餘(EPS)為999元。", [evidence])
    assert not numeric_claims_supported("2026Q2每股盈餘(股價)為3.37元。", [evidence])
    assert not numeric_claims_supported("2026Q1的每股盈餘(EPS)為3.37元，較前一季大幅成長87.2%。", [evidence])
    assert not numeric_claims_supported("較前一季大幅成長87.2%。", [evidence], context="2026Q1 ")


@pytest.mark.parametrize("claim", [
    "建議先投入可用資金的20%，其餘保留。",
    "建議將現金占比調整至50%。",
])
def test_allocation_proposals_need_the_cited_paper_portfolio(claim):
    """Proposals are a paper-trading feature: without the cited paper-account snapshot they stay unsupported."""
    favorites_only = source({"favorites": [{"symbol": "2330", "name": "台積電"}]}, "personal")
    assert not numeric_claims_supported(claim, [market()])
    assert not numeric_claims_supported(claim, [favorites_only])
    assert numeric_claims_supported(claim, [market(), portfolio()])
