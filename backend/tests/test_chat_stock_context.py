import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event

from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import FinancialStatementRow, MonthlyRevenue, StockValuation
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.llm_response import LlmResponse
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.analysis.evidence import TIMELINE_TRADING_DAYS
from app.features.analysis.schemas import StockBehaviorTextBriefResponse
from app.features.chat.stock_context import collect_stock_sources
from test_analysis_service import brief_payload


AS_OF = date(2026, 9, 11)


def payloads(sources):
    return {(source.stock_id, value["category"]): value
            for source in sources for value in [json.loads(source.content)]}


def records(table):
    return [dict(zip(table["columns"], row)) for row in table["rows"]]


def test_aligned_market_and_institutional_sources_preserve_missing_values_and_cutoff(db_session):
    yesterday = AS_OF - timedelta(days=1)
    future = AS_OF + timedelta(days=1)
    db_session.add_all([
        DailyPrice(symbol="2330", date=yesterday, close=100, volume_shares=100_000),
        DailyPrice(symbol="2330", date=AS_OF, close=102, volume_shares=None),
        DailyPrice(symbol="2317", date=yesterday, close=60, volume_shares=0),
        DailyPrice(symbol="2330", date=future, close=999),
        TechnicalIndicator(symbol="2330", date=yesterday, kd_k9=45, kd_d9=50, rsi5=None),
        TechnicalIndicator(symbol="2330", date=AS_OF, kd_k9=55, kd_d9=50,
                           rsi5=65, rsi10=60, macd_dif=2, macd_dea=1, macd_hist=1),
        TechnicalIndicator(symbol="2330", date=future, kd_k9=99, kd_d9=1),
        InstitutionalTrade(symbol="2330", date=yesterday, foreign_net=0),
        InstitutionalTrade(symbol="2330", date=AS_OF, foreign_net=123_456, dealer_net=None),
        InstitutionalTrade(symbol="2330", date=future, foreign_net=999_999),
    ])
    db_session.commit()
    commits = []
    event.listen(db_session, "before_commit", lambda session: commits.append(True))
    sources = collect_stock_sources(db_session, ["2330", "2317", "2330"], AS_OF)
    data = payloads(sources)
    market, other = data["2330", "market_technical"], data["2317", "market_technical"]
    assert market["columns"] == other["columns"]
    first, last = records(market)
    assert [row["date"] for row in records(market)] == [row["date"] for row in records(other)]
    assert (first["kd_k9"], first["kd_d9"], last["kd_k9"], last["kd_d9"]) == (45, 50, 55, 50)
    assert last["chg_pct"] == 2 and last["macd_hist"] == 1
    assert first["rsi5"] is None and last["volume_shares"] is None
    assert records(other)[0]["volume_shares"] == 0
    assert records(other)[-1]["close"] is None
    chips = records(data["2330", "institutional"])
    assert chips[0]["foreign_net"] == 0 and chips[-1]["foreign_net"] == 123_456
    assert chips[-1]["dealer_net"] is None
    assert all(source.citation_id == "" and source.url == "" and source.score == 1
               and source.source == "system_market" for source in sources)
    assert not any(future.isoformat() in source.content for source in sources)
    assert not commits


def test_requested_interval_is_bounded_and_single_day_keeps_previous_kd(db_session):
    days = sorted(AS_OF - timedelta(days=offset) for offset in range(70)
                  if (AS_OF - timedelta(days=offset)).weekday() < 5)[-45:]
    for index, day in enumerate(days):
        db_session.add(DailyPrice(symbol="2330", date=day, close=100 + index, volume_shares=1000))
        db_session.add(TechnicalIndicator(symbol="2330", date=day, kd_k9=index, kd_d9=20))
    db_session.commit()
    table = payloads(collect_stock_sources(db_session, ["2330"], AS_OF, days[0]))["2330", "market_technical"]
    assert len(table["rows"]) == TIMELINE_TRADING_DAYS
    assert table["window_truncated"] is True
    assert table["requested_start_date"] == days[0].isoformat()
    assert table["rows"][0][0] == days[-TIMELINE_TRADING_DAYS].isoformat()
    assert table["previous_window_observation"][0] == days[-TIMELINE_TRADING_DAYS - 1].isoformat()
    single = payloads(collect_stock_sources(db_session, ["2330"], AS_OF, AS_OF))["2330", "market_technical"]
    prior = dict(zip(single["columns"], single["previous_window_observation"]))
    assert len(single["rows"]) == 1 and single["window_truncated"] is False
    assert (prior["date"], prior["kd_k9"], prior["kd_d9"]) == (days[-2].isoformat(), 43, 20)


def test_financials_without_prices_use_existing_publication_lags_and_keep_raw_zero(db_session):
    cutoff = date(2026, 5, 20)
    db_session.add_all([
        FinancialStatementRow(symbol="2330", date=date(2025, 12, 31), statement="income", item_type="EPS", value=1),
        FinancialStatementRow(symbol="2330", date=date(2026, 3, 31), statement="income", item_type="EPS", value=2),
        FinancialStatementRow(symbol="2330", date=date(2026, 3, 31), statement="income", item_type="Revenue", value=100),
        FinancialStatementRow(symbol="2330", date=date(2026, 3, 31), statement="income", item_type="GrossProfit", value=40),
        FinancialStatementRow(symbol="2330", date=date(2026, 6, 30), statement="income", item_type="EPS", value=999),
        MonthlyRevenue(symbol="2330", date=date(2026, 5, 10), revenue_year=2026, revenue_month=4, revenue=100_000),
        MonthlyRevenue(symbol="2330", date=date(2026, 6, 10), revenue_year=2026, revenue_month=5, revenue=999_999),
        StockValuation(symbol="2330", date=cutoff, per=20, pbr=None),
        FinancialStatementRow(symbol="2317", date=date(2026, 3, 31), statement="income", item_type="Revenue", value=500),
        MonthlyRevenue(symbol="2317", date=date(2026, 5, 10), revenue_year=2026, revenue_month=4, revenue=0),
    ])
    db_session.commit()
    data = payloads(collect_stock_sources(db_session, ["2330", "2317"], cutoff))
    finance = data["2330", "fundamental"]
    items = {item["field"]: item for item in finance["items"]}
    assert items["eps"]["value"] == 2 and items["gross_margin_pct"]["value"] == 40
    assert items["pbr"]["value"] is None
    assert items["revenue_monthly"]["period"] == "2026-04"
    assert "not verified publication dates" in finance["publication_basis"]
    assert "not a verified publication date" in finance["source_date_basis"]
    assert "publication_basis" in items["eps"]
    assert "market_technical" not in {key[1] for key in data}
    assert data["2317", "fundamental"]["reported_income"][0]["value"] == 500
    assert data["2317", "fundamental"]["reported_monthly_revenue"]["revenue"] == 0
    before = payloads(collect_stock_sources(db_session, ["2330"], cutoff - timedelta(days=1)))["2330", "fundamental"]
    assert next(item for item in before["items"] if item["field"] == "eps")["value"] == 1


@pytest.mark.parametrize("has_market_rows", [False, True])
def test_live_stock_context_never_scans_archived_analyses_or_news(db_session, monkeypatch, has_market_rows):
    from app.features.analysis import repository
    response = StockBehaviorTextBriefResponse(
        symbol="2330", as_of_date=AS_OF.isoformat(), generated_by="test", status="verified",
        brief=brief_payload(), disclaimer={"version": "test", "text": "Stored interpretation"},
    )
    archived = LlmResponse(
        symbol="2330", as_of_date=AS_OF, created_at=datetime.combine(AS_OF, datetime.min.time()),
        kind="text_brief", config_hash="test", config_json='{"purpose":"production"}',
        response_json=response.model_dump_json(), is_fallback=False,
    )
    db_session.add(archived)
    if has_market_rows:
        db_session.add(DailyPrice(symbol="2330", date=AS_OF, close=102, volume_shares=30_526_551))
    db_session.commit()

    def unexpected_fingerprint(*args, **kwargs):
        raise AssertionError("Live chat must not rescan news to validate archived AI analyses")

    monkeypatch.setattr(repository, "input_fingerprint", unexpected_fingerprint)
    statements = []
    def capture(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement.lower())
    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        sources = collect_stock_sources(db_session, ["2330"], AS_OF)
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert {source.category for source in sources} == {"market_technical" if has_market_rows else "data_availability"}
    assert not any("llm_responses" in statement or "news_articles" in statement for statement in statements)
    # Removing derived interpretations from live chat does not erase archived reports.
    assert repository.saved_brief(archived).brief is not None


def test_missing_data_is_a_limitation_and_invalid_date_order_is_rejected(db_session):
    sources = collect_stock_sources(db_session, [" 2330 ", "2330", ""], AS_OF)
    assert len(sources) == 1 and sources[0].stock_id == "2330"
    assert payloads(sources)["2330", "data_availability"]["status"] == "unavailable"
    assert collect_stock_sources(db_session, [], AS_OF) == []
    with pytest.raises(ValueError, match="start_date"):
        collect_stock_sources(db_session, ["2330"], AS_OF, AS_OF + timedelta(days=1))


def test_technical_observations_remain_available_without_price_rows(db_session):
    db_session.add(TechnicalIndicator(symbol="2330", date=AS_OF, kd_k9=15, kd_d9=None, rsi5=0))
    db_session.commit()
    data = payloads(collect_stock_sources(db_session, ["2330"], AS_OF))
    table = data["2330", "market_technical"]
    row = records(table)[0]
    assert row["close"] is None and row["chg_pct"] is None
    assert row["kd_k9"] == 15 and row["kd_d9"] is None and row["rsi5"] == 0
    assert table["previous_window_observation"] is None


def test_long_term_deviations_require_price_and_indicator_dates_to_match(db_session):
    old_price_date = date(2026, 9, 1)
    db_session.add_all([
        DailyPrice(symbol="2330", date=old_price_date, close=100),
        TechnicalIndicator(symbol="2330", date=AS_OF, ma60=200, ma240=250),
    ])
    db_session.commit()
    source = payloads(collect_stock_sources(db_session, ["2330"], AS_OF))["2330", "market_technical"]
    assert not {item["field"] for item in source["long_term_anchor"]} & {"vs_ma60_pct", "vs_ma240_pct"}
    assert "no same-date" in source["long_term_anchor_limitations"][0]
    assert old_price_date.isoformat() in source["long_term_anchor_limitations"][0]
    assert AS_OF.isoformat() in source["long_term_anchor_limitations"][0]
    assert records(source)[0]["close"] == 100 and records(source)[-1]["ma60"] == 200
    db_session.add(DailyPrice(symbol="2330", date=AS_OF, close=220))
    db_session.commit()
    aligned = payloads(collect_stock_sources(db_session, ["2330"], AS_OF))["2330", "market_technical"]
    anchors = {item["field"]: item["value"] for item in aligned["long_term_anchor"]}
    assert anchors["vs_ma60_pct"] == 10 and anchors["vs_ma240_pct"] == -12
    assert aligned["long_term_anchor_limitations"] == []


@pytest.mark.parametrize("latest_revenue", [0, None])
def test_latest_zero_or_missing_revenue_does_not_reuse_previous_period_growth(db_session, latest_revenue):
    db_session.add_all([
        MonthlyRevenue(symbol="2330", date=date(2025, 8, 10), revenue_year=2025, revenue_month=7, revenue=50),
        MonthlyRevenue(symbol="2330", date=date(2026, 8, 10), revenue_year=2026, revenue_month=7, revenue=100),
        MonthlyRevenue(symbol="2330", date=date(2026, 9, 10), revenue_year=2026, revenue_month=8, revenue=latest_revenue),
    ])
    db_session.commit()
    finance = payloads(collect_stock_sources(db_session, ["2330"], AS_OF))["2330", "fundamental"]
    items = {item["field"]: item for item in finance["items"]}
    latest = items["revenue_monthly"]
    assert latest["period"] == "2026-08" and latest["value"] == latest_revenue
    assert not {"yoy_pct", "mom_pct", "yoy_last6"} & latest.keys()
    assert items["revenue_yoy_positive_streak"]["value"] is None
    assert "unavailable" in latest["growth_limitation"]
