from datetime import date
import json

import httpx
import pytest
from sqlalchemy import delete, select

from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import ForeignShareholding, MarginTrade
from app.jobs.market import chips_history as history


DAY = date(2021, 1, 4)
CATALOG = {"2330": {"market": "TWSE"}, "6488": {"market": "TPEx"}}


def tpex_payload(kind, *, day="20210104"):
    if kind == "margin":
        fields = history.TPEX_MARGIN_FIELDS
        row = ["6488", "GlobalWafers", "100", "10", "20", "5", "85", "0", "1", "999",
               "30", "8", "4", "2", "32", "0", "1", "999", "3", ""]
    else:
        fields = history.TPEX_FOREIGN_FIELDS
        row = ["1", "6488", "GlobalWafers", "10,000", "7,000", "3,000", "70%", "30%", "100%", ""]
    return {"date": day, "stat": "ok", "tables": [{"fields": list(fields), "data": [row]}]}


@pytest.mark.parametrize("kind", ["margin", "foreign_shareholding"])
def test_tpex_historical_request_validates_date_and_normalizes_units(kind):
    def provider(request):
        assert request.url.params["date"] == "2021/01/04"
        assert request.url.path.endswith("margin/balance" if kind == "margin" else "insti/qfii")
        return httpx.Response(200, json=tpex_payload(kind))
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        row = history.fetch_tpex(http, DAY, kind)[0]
    assert row["symbol"] == "6488" and row["date"] == "2021-01-04"
    if kind == "margin":
        assert row["margin_purchase_today_balance"] == "85"
        assert row["short_sale_sell"] == "8" and row["short_sale_buy"] == "4"
        assert row["short_sale_today_balance"] == "32"
    else:
        assert row["foreign_investment_shares"] == "3000"
        assert row["foreign_investment_shares_ratio"] == "30"


@pytest.mark.parametrize("fault", ["date", "fields", "duplicate"])
def test_tpex_history_rejects_snapshot_or_schema_drift(fault):
    payload = tpex_payload("margin")
    if fault == "date":
        payload["date"] = "20261008"
    elif fault == "fields":
        payload["tables"][0]["fields"][0] = "changed"
    else:
        payload["tables"][0]["data"] *= 2
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=payload))) as http:
        with pytest.raises(ValueError):
            history.fetch_tpex(http, DAY, "margin")


def seed_prices(db):
    db.add_all([DailyPrice(date=DAY, symbol=symbol, close=100) for symbol in CATALOG])
    db.commit()


def test_history_routes_stored_trading_days_and_resumes_only_complete(db_session, tmp_path, monkeypatch):
    seed_prices(db_session)
    calls = []
    def twse(http, day):
        calls.append(("TWSE", day))
        return [{"date": day.isoformat(), "symbol": "2330", "margin_purchase_today_balance": "2",
                 "short_sale_today_balance": "0"}]
    monkeypatch.setattr(history.margin, "fetch_twse", twse)
    def provider(request):
        calls.append(("TPEx", DAY))
        return httpx.Response(200, json=tpex_payload("margin"))
    options = dict(symbols=list(CATALOG), catalog=CATALOG, start=DAY, end=date(2021, 1, 5),
                   out=tmp_path / "report.json", datasets={"margin"})
    with httpx.Client(transport=httpx.MockTransport(provider)) as http:
        report = history.backfill(db_session.bind, http, **options)
        assert report["ok"] and report["complete_days"] == 2
        assert len(calls) == 2
        history.backfill(db_session.bind, http, **options, resume=True)
        assert len(calls) == 2
        db_session.execute(delete(MarginTrade).where(MarginTrade.symbol == "6488"))
        db_session.commit()
        history.backfill(db_session.bind, http, **options, resume=True)
        assert len(calls) == 3
    assert len(list(db_session.scalars(select(MarginTrade)))) == 2
    assert json.loads(options["out"].read_text())["tdcc"]["status"] == "not_backfilled"


@pytest.mark.parametrize("kind", ["margin", "foreign_shareholding"])
def test_history_falls_back_to_other_exchange_for_historically_transferred_symbol(
        db_session, tmp_path, monkeypatch, kind):
    symbols = ["2330", "6446"]
    catalog = {symbol: {"market": "TWSE"} for symbol in symbols}
    db_session.add_all([DailyPrice(date=DAY, symbol=symbol, close=100) for symbol in symbols])
    db_session.commit()
    primary_row = ({"date": DAY.isoformat(), "symbol": "2330", "margin_purchase_today_balance": "2",
                    "short_sale_today_balance": "0"} if kind == "margin" else
                   {"date": DAY.isoformat(), "symbol": "2330", "foreign_investment_shares": "10",
                    "foreign_investment_shares_ratio": "1"})
    module = history.margin if kind == "margin" else history.foreign_shareholding
    monkeypatch.setattr(module, "fetch_twse", lambda *_: [primary_row])
    payload = tpex_payload(kind)
    if kind == "margin":
        payload["tables"][0]["data"][0][0] = "6446"
    else:
        payload["tables"][0]["data"][0][1] = "6446"
    with httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))) as http:
        report = history.backfill(db_session.bind, http, symbols=symbols, catalog=catalog,
                                  start=DAY, end=DAY, out=tmp_path / f"{kind}.json", datasets={kind})
    assert report["ok"]
    assert report["days"][f"{kind}/TWSE/{DAY.isoformat()}"]["obtained"] == symbols


def test_official_no_data_is_recorded_without_synthetic_values(db_session, tmp_path, monkeypatch):
    seed_prices(db_session)
    calls = []
    def fetch(http, day):
        calls.append(day)
        return []
    monkeypatch.setattr(history.foreign_shareholding, "fetch_twse", fetch)
    monkeypatch.setattr(history, "fetch_tpex", lambda *_: [])
    options = dict(symbols=["2330"], catalog=CATALOG, start=DAY, end=DAY,
                   out=tmp_path / "report.json", datasets={"foreign_shareholding"})
    report = history.backfill(db_session.bind, None, **options)
    assert report["ok"] and report["incomplete_days"] == 0
    entry = report["days"]["foreign_shareholding/TWSE/2021-01-04"]
    assert entry["status"] == "complete" and entry["not_reported"] == ["2330"]
    history.backfill(db_session.bind, None, **options, resume=True)
    assert len(calls) == 1 and not list(db_session.scalars(select(ForeignShareholding)))


def test_resume_scope_is_bound_to_symbols_and_dataset(db_session, tmp_path, monkeypatch):
    seed_prices(db_session)
    monkeypatch.setattr(history.margin, "fetch_twse", lambda *_: [])
    options = dict(symbols=["2330"], catalog=CATALOG, start=DAY, end=DAY, out=tmp_path / "report.json")
    history.backfill(db_session.bind, None, **options, datasets={"margin"})
    with pytest.raises(ValueError, match="scope"):
        history.backfill(db_session.bind, None, **options, datasets={"foreign_shareholding"}, resume=True)
