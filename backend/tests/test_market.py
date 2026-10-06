from datetime import date, timedelta
from decimal import Decimal

import pytest
from sqlalchemy import event

from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import FinancialStatementRow, MonthlyRevenue, StockValuation
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.technical_indicator import TechnicalIndicator
from app.db.models.stock_info import StockInfo


def price(day, close="100.25", symbol="2330", **extra):
    return DailyPrice(date=day, symbol=symbol, open=close, high=close, low=close,
                      close=close, volume_shares=3_000_000_001, amount=9_000_000_001, **extra)


def test_stock_infos_read_names_from_db_and_require_price_data(client, db_session):
    day = date(2026, 5, 20)
    db_session.add_all([
        price(day, symbol="1101"),
        StockInfo(symbol="1101", name="台泥", industry="水泥工業"),
        StockInfo(symbol="2330", name="台積電", industry="半導體業"),
    ])
    db_session.commit()

    response = client.get("/stocks/info")

    assert response.status_code == 200
    assert response.json() == [{"symbol": "1101", "name": "台泥", "industry": "水泥工業"}]


def test_history_inclusive_dates_pagination_decimal_and_read_only(client, db_session):
    day = date(2026, 5, 20)
    db_session.add_all([price(day - timedelta(days=1)), price(day), price(day + timedelta(days=1))])
    db_session.commit()
    commits = []
    event.listen(db_session, "before_commit", lambda session: commits.append(True))
    response = client.get("/stocks/2330/history", params={
        "start_date": day.isoformat(), "end_date": (day + timedelta(days=1)).isoformat(), "limit": 1,
    })
    assert response.status_code == 200
    result = response.json()
    assert result["total"] == 2
    assert result["data"][0]["date"] == "2026-05-21"
    assert result["data"][0]["close"] == "100.25"
    assert result["data"][0]["change"] is None
    assert result["data"][0]["amount"] == 9_000_000_001
    assert client.get("/stocks/2330/history", params={"start_date": "2026-05-20"}).json()["total"] == 2
    assert not commits


def test_history_defaults_but_only_missing_both_dates(client, db_session):
    today = date.today()
    db_session.add_all([price(today), price(today - timedelta(days=30)), price(today - timedelta(days=31))])
    db_session.commit()
    result = client.get("/stocks/2330/history").json()
    assert result["start_date"] == (today - timedelta(days=30)).isoformat()
    assert result["total"] == 2
    result = client.get("/stocks/2330/history", params={"end_date": today.isoformat()}).json()
    assert result["start_date"] == "0001-01-01" and result["total"] == 3


def test_candlestick_uses_history_before_visible_boundary(client, db_session):
    day = date(2026, 5, 20)
    db_session.add_all([price(day - timedelta(days=2), "90"),
                        price(day - timedelta(days=1), "100"), price(day, "110")])
    db_session.commit()
    result = client.get("/stocks/2330/chart/candlestick-ma", params={
        "start_date": day.isoformat(), "end_date": day.isoformat(), "ma_periods": "2,3,5",
    }).json()
    assert result["dates"] == [day.isoformat()]
    assert result["moving_averages"] == {"MA2": [105.0], "MA3": [100.0], "MA5": [None]}
    assert result["candlestick"][0]["change"] == 0.0


def test_chart_request_limits_reject_invalid_work_before_query(client):
    params = {"start_date": "2026-05-20", "end_date": "2026-05-20"}
    for periods in ("0", "-2", "1,2,3,4,5,6", "not-an-integer", "9999999999999999999999"):
        response = client.get("/stocks/2330/chart/candlestick-ma", params={**params, "ma_periods": periods})
        assert response.status_code == 400
        assert response.json()["detail"].startswith("移動平均線週期格式錯誤:")


def test_compare_accepts_all_40_stock_pool_symbols(client, db_session):
    day = date(2026, 5, 20)
    symbols = [str(1000 + index) for index in range(40)]
    db_session.add_all([price(day, symbol=symbol) for symbol in symbols])
    db_session.commit()

    response = client.get("/stocks/compare/multiple", params={
        "start_date": day.isoformat(), "end_date": day.isoformat(), "symbols": ",".join(symbols),
    })

    assert response.status_code == 200
    assert response.json()["symbols"] == symbols


def test_statistics_comparison_and_price_change_preserve_nulls(client, db_session):
    first, last = date(2026, 5, 19), date(2026, 5, 20)
    db_session.add_all([price(first, "100"), price(last, "103.33"), price(first, "50", "2317")])
    db_session.commit()
    params = {"start_date": first.isoformat(), "end_date": last.isoformat()}
    stats = client.get("/stocks/2330/statistics", params=params).json()
    assert stats["highest_price"] == "103.33" and stats["trading_days"] == 2
    comparison = client.get("/stocks/compare/multiple", params={**params, "symbols": "2330,2317"}).json()
    assert comparison["data"][-1]["prices"] == {"2330": 103.33, "2317": None}
    changes = client.get("/stocks/2330/chart/price-change", params=params).json()["data"]
    assert [row["change_percent"] for row in changes] == [0.0, 3.33]


def test_integrated_chart_partial_data_and_exact_join(client, db_session):
    day = date(2026, 5, 20)
    db_session.add_all([price(day), price(day - timedelta(days=1)),
        InstitutionalTrade(date=day, symbol="2330", investment_trust_net=123),
        TechnicalIndicator(date=day, symbol="2330", ma5=Decimal("101.23"), boll_mid20=Decimal("90.12"))])
    db_session.commit()
    params = {"start_date": "2026-05-19", "end_date": "2026-05-20"}
    result = client.get("/stocks/2330/integrated-chart", params=params).json()
    assert len(result["price_volume"]) == 2 and len(result["volume_with_chips"]) == 1
    assert result["volume_with_chips"][0]["foreign_net"] is None
    assert result["institutional_trades"][0]["trust_net"] == 123
    assert result["technical_indicators"][0]["ma5"] == 101.23
    assert "boll_mid20" not in result["technical_indicators"][0]
    technical = client.get("/stocks/2330/technical-indicators", params=params).json()
    assert technical["data"][0]["boll_mid20"] == "90.12"
    chips = client.get("/stocks/2330/volume-with-chips", params=params).json()
    assert chips == client.get("/stocks/2330/chart/chips-volume", params=params).json()
    assert client.get("/stocks/2330/integrated-chart", params={
        "start_date": "2026-05-19", "end_date": "2026-05-19"}).json()["institutional_trades"] == []


def test_financial_statement_filters_and_bigint(client, db_session):
    day = date(2026, 5, 20)
    db_session.add_all([
        FinancialStatementRow(date=day, symbol="2330", statement="income", item_type="EPS", origin_name="eps", value="10.1234"),
        FinancialStatementRow(date=day, symbol="2330", statement="balance", item_type="EPS", origin_name="other", value="999"),
        FinancialStatementRow(date=day - timedelta(days=1), symbol="2330", statement="income", item_type="EPS", origin_name="eps", value="5"),
        MonthlyRevenue(date=day, symbol="2330", revenue=9_000_000_001),
        StockValuation(date=day, symbol="2330", per="11.1234"),
    ])
    db_session.commit()
    params = {"start_date": day.isoformat(), "end_date": day.isoformat()}
    statement = client.get("/stocks/2330/fundamentals/financial-statements", params={
        **params, "statement": "income", "item_type": "EPS"}).json()
    assert statement["total"] == 1 and statement["data"][0]["value"] == "10.1234"
    assert client.get("/stocks/2330/fundamentals/monthly-revenues", params=params).json()["data"][0]["revenue"] == 9_000_000_001
    assert client.get("/stocks/2330/fundamentals/valuations", params=params).json()["data"][0]["per"] == "11.1234"


@pytest.mark.parametrize("endpoint", ["latest", "date-range", "statistics", "chart/volume", "integrated-chart",
    "institutional-trades", "technical-indicators", "fundamentals/dividend-results",
    "chips/margin-trades", "chips/foreign-shareholding", "chips/holding-share-levels"])
def test_missing_data_keeps_404_detail(client, endpoint):
    response = client.get(f"/stocks/MISSING/{endpoint}", params={"start_date": "2026-05-20", "end_date": "2026-05-20"})
    assert response.status_code == 404
    assert "MISSING" in response.json()["detail"]
