from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.db.session import Base
from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import StockValuation
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.technical_indicator import TechnicalIndicator
from app.jobs import market_history as history
from app.jobs.market import benchmark, institutional


@pytest.mark.parametrize("market", ["TWSE", "TPEx"])
def test_official_history_import_is_scoped_and_recomputes_indicators(tmp_path, monkeypatch, market):
    engine = create_engine(f"sqlite:///{tmp_path / 'history.db'}")
    Base.metadata.create_all(engine)
    day = date(2026, 10, 2)
    monkeypatch.setattr(history, "get_settings", lambda: None)
    monkeypatch.setattr(history, "make_engine", lambda settings: engine)
    monkeypatch.setattr(history, "_load_catalog", lambda: {"2330": {"market": market}})
    monkeypatch.setattr(benchmark, "import_history", lambda *a, **k: pytest.fail("Unrelated benchmark request"))
    price = {"date": day, "symbol": "2330", "open": "100", "high": "102", "low": "99",
             "close": "101", "volume_shares": 5000}
    if market == "TPEx":
        with Session(engine) as db, db.begin():
            db.add(DailyPrice(date=day, symbol="2330", close=Decimal("99"),
                              volume_shares=5123, amount=517423))
    monkeypatch.setattr(history, "_twse_prices" if market == "TWSE" else "_tpex_prices",
                        lambda *a: [price])
    monkeypatch.setattr(history, "_tpex_prices" if market == "TWSE" else "_twse_prices",
                        lambda *a: [])
    monkeypatch.setattr(history, "_twse_valuations" if market == "TWSE" else "_tpex_valuations",
                        lambda *a: [{"symbol": "2330", "date": day, "per": "20.5"}])
    requested = []

    def trades(client, requested_day, requested_market):
        requested.append((requested_day, requested_market))
        return [{"date": day.isoformat(), "symbol": symbol, "foreign_net": 100}
                for symbol in ("2330", "9999")]

    monkeypatch.setattr(institutional, "fetch_history", trades)
    args = SimpleNamespace(start=day, end=day, symbols=["2330"], timeout=1, interval=0,
                           retries=0, skip_benchmark=True, skip_valuations=False,
                           include_institutional=True, out=tmp_path / "report.json")
    report = history.backfill(args)
    assert report["datasets"] == {"daily_prices": 1, "stock_valuations": 1, "institutional_trades": 1}
    assert requested == [(day, market)]
    with Session(engine) as db:
        assert db.scalar(select(DailyPrice.close)) == Decimal("101.00")
        assert db.scalar(select(DailyPrice.volume_shares)) == (5123 if market == "TPEx" else 5000)
        if market == "TPEx":
            assert db.scalar(select(DailyPrice.amount)) == 517423
        assert db.scalar(select(StockValuation.per)) == Decimal("20.50")
        assert list(db.scalars(select(InstitutionalTrade.symbol))) == ["2330"]
        assert db.scalar(select(TechnicalIndicator.close)) == Decimal("101.00")
    engine.dispose()


@pytest.mark.parametrize("empty_stage", ["prices", "valuations", "institutional"])
def test_official_history_cannot_succeed_without_required_selected_stock_data(tmp_path, monkeypatch, empty_stage):
    engine = create_engine(f"sqlite:///{tmp_path / 'empty.db'}")
    Base.metadata.create_all(engine)
    day = date(2026, 10, 2)
    monkeypatch.setattr(history, "get_settings", lambda: None)
    monkeypatch.setattr(history, "make_engine", lambda settings: engine)
    monkeypatch.setattr(history, "_load_catalog", lambda: {"2330": {"market": "TWSE"}})
    monkeypatch.setattr(history, "_twse_prices", lambda *a: [] if empty_stage == "prices" else [
        {"date": day, "symbol": "2330", "close": "101", "volume_shares": 5000}])
    monkeypatch.setattr(history, "_tpex_prices", lambda *a: [])
    monkeypatch.setattr(institutional, "fetch_history", lambda *a: [
        {"date": day.isoformat(), "symbol": "9999", "foreign_net": 1}])
    monkeypatch.setattr(history, "_twse_valuations", lambda *a: [])
    args = SimpleNamespace(start=day, end=day, symbols=["2330"], timeout=1, interval=0,
                           retries=0, skip_benchmark=True, skip_valuations=empty_stage != "valuations",
                           include_institutional=True, out=tmp_path / "report.json")
    with pytest.raises(ValueError, match="No official"):
        history.backfill(args)
    assert not args.out.exists()
    engine.dispose()


@pytest.mark.parametrize("current_market", ["TWSE", "TPEx"])
def test_history_includes_previous_market_and_switch_month(tmp_path, monkeypatch, current_market):
    engine = create_engine(f"sqlite:///{tmp_path / 'transfer.db'}")
    Base.metadata.create_all(engine)
    previous_market = "TPEx" if current_market == "TWSE" else "TWSE"
    symbol = "6589"
    days = [date(2025, 6, 30), date(2025, 7, 18), date(2025, 7, 21),
            date(2025, 8, 1), date(2025, 8, 4)]
    price_rows = [{"date": day, "symbol": symbol, "open": str(100 + index * 10),
                   "high": str(102 + index * 10), "low": str(99 + index * 10),
                   "close": str(100 + index * 10), "volume_shares": 5000, "amount": 500000}
                  for index, day in enumerate(days)]
    sources = {previous_market: price_rows[:2], current_market: price_rows[2:]}
    day_markets = {row["date"]: market for market, rows in sources.items() for row in rows}
    monkeypatch.setattr(history, "get_settings", lambda: None)
    monkeypatch.setattr(history, "make_engine", lambda settings: engine)
    monkeypatch.setattr(history, "_load_catalog", lambda: {symbol: {"market": current_market}})
    monkeypatch.setattr(benchmark, "import_history", lambda *a, **k: pytest.fail("Unrelated benchmark request"))
    seeded_days = {days[0], days[2]}
    with Session(engine) as db, db.begin():
        db.add_all([DailyPrice(date=day, symbol=symbol, close=Decimal("99"),
                               volume_shares=5123, amount=517423) for day in seeded_days])

    def prices(market):
        def fetch(client, requested_symbol, month, start, end):
            assert requested_symbol == symbol
            return [row for row in sources[market]
                    if (row["date"].year, row["date"].month) == (month.year, month.month)
                    and start <= row["date"] <= end]
        return fetch

    valuation_requests, institutional_requests = [], []

    def valuations(market):
        def fetch(client, day, members):
            assert members == {symbol} and market == day_markets[day]
            valuation_requests.append((day, market))
            return [{"date": day, "symbol": symbol, "per": "20" if market == "TWSE" else "10"}]
        return fetch

    def trades(client, day, market):
        assert market == day_markets[day]
        institutional_requests.append((day, market))
        return [{"date": day.isoformat(), "symbol": member,
                 "foreign_net": 20 if market == "TWSE" else 10} for member in (symbol, "9999")]

    monkeypatch.setattr(history, "_twse_prices", prices("TWSE"))
    monkeypatch.setattr(history, "_tpex_prices", prices("TPEx"))
    monkeypatch.setattr(history, "_twse_valuations", valuations("TWSE"))
    monkeypatch.setattr(history, "_tpex_valuations", valuations("TPEx"))
    monkeypatch.setattr(institutional, "fetch_history", trades)
    args = SimpleNamespace(start=days[0], end=days[-1], symbols=[symbol], timeout=1, interval=0,
                           retries=0, skip_benchmark=True, skip_valuations=False,
                           include_institutional=True, out=tmp_path / "report.json")
    report = history.backfill(args)
    assert report["datasets"] == {"daily_prices": 5, "stock_valuations": 5, "institutional_trades": 5}
    assert report["coverage"]["daily_prices"][symbol] == ["2025-06-30", "2025-08-04", 5]
    expected_requests = [(day, day_markets[day]) for day in days]
    assert valuation_requests == institutional_requests == expected_requests
    with Session(engine) as db:
        for index, day in enumerate(days):
            key = (day, symbol)
            price = db.get(DailyPrice, key)
            assert price.close == Decimal(100 + index * 10)
            preserve_exact = day_markets[day] == "TPEx" and day in seeded_days
            assert price.volume_shares == (5123 if preserve_exact else 5000)
            assert price.amount == (517423 if preserve_exact else 500000)
            assert db.get(StockValuation, key).per == (20 if day_markets[day] == "TWSE" else 10)
            assert db.get(InstitutionalTrade, key).foreign_net == (20 if day_markets[day] == "TWSE" else 10)
        assert db.get(TechnicalIndicator, (days[-1], symbol)).ma5 == Decimal("120.00")
        assert set(db.scalars(select(InstitutionalTrade.symbol))) == {symbol}
    engine.dispose()


def test_history_rejects_same_stock_date_in_both_markets(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'overlap.db'}")
    Base.metadata.create_all(engine)
    day = date(2025, 7, 21)
    row = {"date": day, "symbol": "6589", "close": "100"}
    monkeypatch.setattr(history, "get_settings", lambda: None)
    monkeypatch.setattr(history, "make_engine", lambda settings: engine)
    monkeypatch.setattr(history, "_load_catalog", lambda: {"6589": {"market": "TWSE"}})
    monkeypatch.setattr(history, "_twse_prices", lambda *a: [row])
    monkeypatch.setattr(history, "_tpex_prices", lambda *a: [{**row, "close": "101"}])
    args = SimpleNamespace(start=day, end=day, symbols=["6589"], timeout=1, interval=0,
                           retries=0, skip_benchmark=True, skip_valuations=True,
                           include_institutional=False, out=tmp_path / "report.json")
    with pytest.raises(ValueError, match="Overlapping official market history"):
        history.backfill(args)
    with Session(engine) as db:
        assert list(db.scalars(select(DailyPrice))) == []
        assert list(db.scalars(select(TechnicalIndicator))) == []
    assert not args.out.exists()
    engine.dispose()


@pytest.mark.parametrize("market", ["TWSE", "TPEx"])
def test_historical_valuations_use_field_names_and_reject_wrong_dates(market):
    day = date(2024, 10, 7)
    fields = ["股價淨值比", "本益比", "證券代號" if market == "TWSE" else "股票代號", "殖利率(%)"]
    table = {"date": "113/10/07", "fields": fields, "data": [["1.08", "35.64", "1101", "2.99"]]}
    payload = {"stat": "OK", "date": "20241007", **{k: v for k, v in table.items() if k != "date"}} if market == "TWSE" else {
        "stat": "ok", "date": "20241007", "tables": [table]}
    client = SimpleNamespace(json=lambda *a, **k: payload)
    fetch = history._twse_valuations if market == "TWSE" else history._tpex_valuations
    assert fetch(client, day, {"1101"}) == [{"symbol": "1101", "date": day,
        "dividend_yield": "2.99", "per": "35.64", "pbr": "1.08"}]
    payload["date"] = "20261002"
    with pytest.raises(ValueError, match="date mismatch"):
        fetch(client, day, {"1101"})


@pytest.mark.parametrize("market", ["TWSE", "TPEx"])
def test_price_history_preserves_units_and_rejects_malformed_months(market):
    day = date(2024, 10, 7)
    rows = [["113/10/07", "12,770", "12,430,205", "100", "102", "99", "101", "1", "20"]]
    payload = {"stat": "OK", "data": rows} if market == "TWSE" else {"stat": "ok", "tables": [{"data": rows}]}
    client = SimpleNamespace(json=lambda *a, **k: payload)
    fetch = history._twse_prices if market == "TWSE" else history._tpex_prices
    result = fetch(client, "2330", day.replace(day=1), day, day)
    multiplier = 1 if market == "TWSE" else 1000
    assert result[0]["volume_shares"] == 12770 * multiplier
    assert result[0]["amount"] == 12430205 * multiplier
    rows[0][0] = "113/09/07"
    with pytest.raises(ValueError, match="month mismatch"):
        fetch(client, "2330", day.replace(day=1), day, day)
    rows[:] = [["113/10/07"]]
    with pytest.raises(ValueError, match="Malformed"):
        fetch(client, "2330", day.replace(day=1), day, day)
    payload.clear()
    with pytest.raises(ValueError):
        fetch(client, "2330", day.replace(day=1), day, day)
