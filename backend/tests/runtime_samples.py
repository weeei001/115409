"""Identical populated data and HTTP requests for both applications."""
from datetime import date, datetime, timedelta
from decimal import Decimal


DAY = date(2026, 5, 20)
CREATED = datetime(2026, 5, 20, 12)
CONFIG_HASH = "a7240da41160cd0ff08a6b33f01aff78cd75fb1512d998282535dc707a804eb3"
# norm_v1 fingerprint of article-a for the 2330 sentiment fixture.
INPUT_HASH = "a3198284bcfeb3510e555fb48da0b6f43e551cc5796757d871fb2ea99cb09d86"


def populate(db, models):
    for index, close in enumerate(("90.25", "100.00", "110.33")):
        db.add(models.DailyPrice(symbol="2330", date=DAY + timedelta(days=index - 2),
            open=Decimal(close) - 2, close=close, high=Decimal(close) + 3, low=Decimal(close) - 4,
            volume_shares=3_000_000_001 + index, amount=9_000_000_002 + index,
            change=Decimal("0.25"), trades=100))
    db.add_all([
        models.DailyPrice(symbol="2317", date=DAY, close="75.15", high="80", low="70", open="74"),
        models.DailyPrice(symbol="NULL", date=DAY, close=None),
        models.InstitutionalTrade(symbol="2330", date=DAY, foreign_net=-1234,
            investment_trust_net=300, dealer_net=100, total_institutional_net=-834),
        models.TechnicalIndicator(symbol="2330", date=DAY, close="110.33", ma5="103.24", ma20="90.15",
            boll_upper20="112.25", rsi5="65.13", macd_dif="1.1234"),
        models.FinancialStatementRow(symbol="2330", date=DAY, statement="income", item_type="EPS",
            origin_name="EPS", value="10.1234"),
        models.MonthlyRevenue(symbol="2330", date=DAY, revenue=9_000_000_001, revenue_year=2026, revenue_month=4),
        models.StockValuation(symbol="2330", date=DAY, per="15.1234"),
        models.DividendResult(symbol="2330", date=DAY, before_price="110.1234"),
        models.MarginTrade(symbol="2330", date=DAY, margin_purchase_buy=3000000001),
        models.ForeignShareholding(symbol="2330", date=DAY, foreign_investment_shares_ratio="65.1234"),
        models.HoldingShareLevel(symbol="2330", date=DAY, holding_shares_level="1", unit=3000000001),
        models.NewsArticle(article_id="article-a", source="cnyes", stock_id="2330", title="Revenue grows",
            pub_time="2026-05-20T12:00:00+08:00", content="Revenue grows with demand.", tags="2317,2330", created_at=CREATED),
        models.NewsArticle(article_id="article-b", source="ltn", stock_id="2317", title="Markets",
            pub_time="2026-05-19 12:00:00", content=None, tags="2330", created_at=CREATED - timedelta(days=1)),
        models.NewsSentiment(article_id="article-a", target_stock_id="2330", input_hash=INPUT_HASH,
            config_hash=CONFIG_HASH, status="success", label="positive", reason="Revenue grows",
            evidence='[{"field":"title","quote":"Revenue grows"}]', analyzed_at=CREATED),
    ])
    orders = [
        (1, "2330", "buy", -2, 3, "long_term", None, 270750),
        (2, "2330", "sell", -1, 1, None, None, 100000),
        (3, "2330", "buy", -1, 2, "by_date", DAY, 200000),
        (4, "2317", "buy", 0, 1, "by_date", date(2099, 1, 1), 75150),
        (5, "NULL", "buy", 0, 1, "long_term", None, 1000),
    ]
    for id_, symbol, side, delta, quantity, plan, planned, amount in orders:
        db.add(models.SimulatedOrder(id=id_, user_id="demo", symbol=symbol, side=side,
            trade_date=DAY + timedelta(days=delta), quantity=quantity, sell_plan=plan,
            planned_sell_date=planned, status="filled", estimated_amount=amount,
            created_at=CREATED + timedelta(seconds=id_)))
    db.commit()


def requests():
    dates = {"start_date": "2026-05-19", "end_date": "2026-05-20"}
    yield "/", {}
    yield "/health", {}
    yield "/stocks/symbols", {}
    yield "/stocks/2330/latest", {}
    yield "/stocks/2330/date-range", {}
    yield "/stocks/MISSING/latest", {}
    yield "/stocks/2330/history", {**dates, "limit": 1}
    yield "/stocks/2330/history", {"start_date": "2026-05-20"}
    yield "/stocks/2330/statistics", dates
    yield "/stocks/compare/multiple", {**dates, "symbols": "2330,2317"}
    for suffix in ("chart/candlestick-ma", "chart/volume", "chart/price-change", "institutional-trades",
                   "chart/chips-volume", "volume-with-chips", "technical-indicators", "integrated-chart",
                   "fundamentals/monthly-revenues", "fundamentals/valuations",
                   "fundamentals/dividend-results", "chips/margin-trades", "chips/foreign-shareholding",
                   "chips/holding-share-levels"):
        yield f"/stocks/2330/{suffix}", dates
    yield "/stocks/2330/fundamentals/financial-statements", {**dates, "statement": "income", "item_type": "EPS"}
    yield "/stocks/2330/chart/candlestick-ma", {**dates, "ma_periods": "2,3,5"}
    yield "/stocks/2330/chart/candlestick-ma", {**dates, "ma_periods": "bad"}
    yield "/news", {}
    yield "/news", {"stock": "2330", "page_size": 1, "page": 2}
    yield "/news", {"source": "cnyes", "keyword": "Revenue", "sort_order": "asc"}
    yield "/news", {"start_time": "2026-05-20T00:00:00", "end_time": "2026-05-20T23:59:59"}
    yield "/news/article-a", {"stock": "2330"}
    yield "/news/article-a", {"stock": "2317"}
    yield "/news/missing", {}
    yield "/simulated-orders/", {"user_id": "demo"}
    yield "/simulated-orders/", {"user_id": "demo", "limit": 2}
    yield "/simulated-orders/available-lots", {"user_id": "demo", "symbol": "2330"}
    yield "/simulated-orders/available-lots", {"user_id": "demo", "symbol": "missing"}
    yield "/simulated-orders/profit-by-category", {"user_id": "demo"}


def capture(client):
    responses = []
    for path, params in requests():
        response = client.get(path, params=params)
        responses.append({"path": path, "params": params, "status": response.status_code, "body": response.json()})
    return responses
