"""Backfill official TWSE/TPEx historical prices and valuations."""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from datetime import date
from pathlib import Path

import httpx
from sqlalchemy import func
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings, state_directory
from app.db.engine import make_engine
from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.market_extra import StockValuation
from app.jobs.indicators import recompute


TWSE_PRICE_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
TPEX_PRICE_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock"
TWSE_VALUATION_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d"
TPEX_VALUATION_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/peQryDate"


def _date(value: object) -> date:
    text = re.sub(r"\D", "", str(value or "").strip())
    if len(text) == 7:
        text = f"{int(text[:3]) + 1911:04d}{text[3:]}"
    if len(text) != 8:
        raise ValueError(f"Invalid official date: {value!r}")
    return date(int(text[:4]), int(text[4:6]), int(text[6:8]))


def _number(value: object) -> str | None:
    text = str(value or "").strip().replace(",", "")
    if text in {"", "-", "--", "X", "N/A"}:
        return None
    return text if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text) else None


def _integer(value: object, multiplier: int = 1) -> int | None:
    text = _number(value)
    return int(text) * multiplier if text is not None else None


def _months(start: date, end: date) -> list[date]:
    result = []
    current = date(start.year, start.month, 1)
    while current <= end:
        result.append(current)
        current = date(current.year + (current.month == 12), current.month % 12 + 1, 1)
    return result


class OfficialClient:
    def __init__(self, http: httpx.Client, interval: float, retries: int):
        self.http = http
        self.interval = interval
        self.retries = retries
        self.next_request = 0.0
        self.requests = 0

    def json(self, method: str, url: str, **kwargs) -> object:
        last_error = None
        for attempt in range(self.retries + 1):
            wait = self.next_request - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self.next_request = time.monotonic() + self.interval
            self.requests += 1
            try:
                response = self.http.request(method, url, **kwargs)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError, UnicodeError) as exc:
                last_error = exc
                if attempt < self.retries:
                    time.sleep(1.5 * (attempt + 1))
        raise RuntimeError(f"Official request failed: {url.rsplit('/', 1)[-1]}") from last_error


def _twse_prices(client: OfficialClient, symbol: str, month: date,
                 start: date, end: date) -> list[dict]:
    payload = client.json("GET", TWSE_PRICE_URL, params={
        "date": month.strftime("%Y%m01"), "stockNo": symbol, "response": "json"})
    if not isinstance(payload, dict):
        raise ValueError("Unexpected TWSE price response")
    if str(payload.get("stat", "")).startswith("很抱歉，沒有符合"):
        return []
    rows = payload.get("data")
    if payload.get("stat") != "OK" or not isinstance(rows, list):
        raise ValueError("Unexpected TWSE price data")
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) < 9:
            raise ValueError("Malformed TWSE price row")
        day = _date(raw[0])
        if (day.year, day.month) != (month.year, month.month):
            raise ValueError("TWSE price month mismatch")
        close = _number(raw[6])
        if not start <= day <= end or close is None:
            continue
        output.append({"date": day, "symbol": symbol, "open": _number(raw[3]),
                       "high": _number(raw[4]), "low": _number(raw[5]), "close": close,
                       "volume_shares": _integer(raw[1]), "amount": _integer(raw[2]),
                       "change": _number(raw[7]), "trades": _integer(raw[8])})
    return output


def _tpex_prices(client: OfficialClient, symbol: str, month: date,
                 start: date, end: date) -> list[dict]:
    payload = client.json("POST", TPEX_PRICE_URL, data={
        "code": symbol, "date": month.strftime("%Y/%m/%d"), "response": "json"})
    if (not isinstance(payload, dict) or str(payload.get("stat", "")).lower() != "ok"
            or not isinstance(payload.get("tables"), list)):
        raise ValueError("Unexpected TPEx price response")
    tables = payload["tables"]
    if not tables:
        return []
    rows = tables[0].get("data") if isinstance(tables[0], dict) else None
    if not isinstance(rows, list):
        raise ValueError("Unexpected TPEx price data")
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) < 9:
            raise ValueError("Malformed TPEx price row")
        day = _date(raw[0])
        if (day.year, day.month) != (month.year, month.month):
            raise ValueError("TPEx price month mismatch")
        close = _number(raw[6])
        if not start <= day <= end or close is None:
            continue
        output.append({"date": day, "symbol": symbol, "open": _number(raw[3]),
                       "high": _number(raw[4]), "low": _number(raw[5]), "close": close,
                       # The TPEx historical page reports shares and NT dollars in thousands.
                       "volume_shares": _integer(raw[1], 1000), "amount": _integer(raw[2], 1000),
                       "change": _number(raw[7]), "trades": _integer(raw[8])})
    return output


def _twse_valuations(client: OfficialClient, day: date, symbols: set[str]) -> list[dict]:
    payload = client.json("GET", TWSE_VALUATION_URL, params={
        "date": day.strftime("%Y%m%d"), "response": "json"})
    if (not isinstance(payload, dict) or payload.get("stat") != "OK"
            or not isinstance(payload.get("data"), list)):
        raise ValueError("Unexpected TWSE valuation response")
    if _date(payload.get("date")) != day:
        raise ValueError("TWSE valuation date mismatch")
    fields = payload.get("fields")
    required = {"證券代號", "殖利率(%)", "本益比", "股價淨值比"}
    if not isinstance(fields, list) or not required <= set(fields):
        raise ValueError("TWSE valuation fields changed")
    output = []
    for raw in payload["data"]:
        if not isinstance(raw, list) or len(raw) != len(fields):
            raise ValueError("Malformed TWSE valuation row")
        row = dict(zip(fields, raw, strict=True))
        symbol = str(row["證券代號"]).strip()
        if symbol in symbols:
            output.append({"date": day, "symbol": symbol,
                           "dividend_yield": _number(row["殖利率(%)"]), "per": _number(row["本益比"]),
                           "pbr": _number(row["股價淨值比"])})
    return output


def _tpex_valuations(client: OfficialClient, day: date, symbols: set[str]) -> list[dict]:
    payload = client.json("POST", TPEX_VALUATION_URL, data={
        "date": day.strftime("%Y/%m/%d"), "cate": "", "response": "json"})
    if (not isinstance(payload, dict) or str(payload.get("stat", "")).lower() != "ok"
            or not isinstance(payload.get("tables"), list)):
        raise ValueError("Unexpected TPEx valuation response")
    if _date(payload.get("date")) != day:
        raise ValueError("TPEx valuation date mismatch")
    table = payload["tables"][0] if payload["tables"] else {}
    if not isinstance(table, dict) or _date(table.get("date")) != day:
        raise ValueError("TPEx valuation table date mismatch")
    fields, rows = table.get("fields"), table.get("data")
    required = {"股票代號", "殖利率(%)", "本益比", "股價淨值比"}
    if not isinstance(fields, list) or not required <= set(fields) or not isinstance(rows, list):
        raise ValueError("TPEx valuation fields changed")
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) != len(fields):
            raise ValueError("Malformed TPEx valuation row")
        row = dict(zip(fields, raw, strict=True))
        symbol = str(row["股票代號"]).strip()
        if symbol in symbols:
            output.append({"date": day, "symbol": symbol,
                           "dividend_yield": _number(row["殖利率(%)"]), "per": _number(row["本益比"]),
                           "pbr": _number(row["股價淨值比"])})
    return output


def _upsert(db: Session, model, rows: list[dict], *, preserve_existing=()) -> int:
    if not rows:
        return 0
    table = model.__table__
    keys = [column.name for column in table.primary_key]
    for offset in range(0, len(rows), 500):
        batch = rows[offset:offset + 500]
        if db.bind.dialect.name == "mysql":
            statement = mysql_insert(table).values(batch)
            statement = statement.on_duplicate_key_update(**{
                column.name: (func.coalesce(table.c[column.name], getattr(statement.inserted, column.name))
                              if column.name in preserve_existing else
                              func.coalesce(getattr(statement.inserted, column.name), table.c[column.name]))
                for column in table.columns if column.name not in keys
            })
        elif db.bind.dialect.name == "sqlite":
            statement = sqlite_insert(table).values(batch)
            statement = statement.on_conflict_do_update(index_elements=keys, set_={
                column.name: (func.coalesce(table.c[column.name], getattr(statement.excluded, column.name))
                              if column.name in preserve_existing else
                              func.coalesce(getattr(statement.excluded, column.name), table.c[column.name]))
                for column in table.columns if column.name not in keys
            })
        else:
            raise ValueError("Historical market import requires MySQL or SQLite")
        db.execute(statement)
    return len(rows)


def _load_catalog() -> dict[str, dict]:
    path = state_directory() / "company_catalog.json"
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Missing official company catalog: {path}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Invalid official company catalog")
    return payload


def _symbols_from_db(engine) -> list[str]:
    from sqlalchemy import text
    with engine.connect() as db:
        return list(db.execute(text("select symbol from stock_info order by symbol")).scalars())


def backfill(args: argparse.Namespace) -> dict:
    from app.jobs.market import benchmark, institutional

    engine = make_engine(get_settings())
    if getattr(args, "benchmark_only", False):
        try:
            with httpx.Client(timeout=args.timeout, trust_env=False, follow_redirects=True) as http:
                client = OfficialClient(http, args.interval, args.retries)
                count = benchmark.import_history(engine, client, args.start, args.end,
                                                 incremental=args.incremental)
                return {"datasets": {"benchmark_prices": count}, "requests": client.requests}
        finally:
            engine.dispose()
    try:
        catalog = _load_catalog()
        symbols = args.symbols or _symbols_from_db(engine)
        unknown = set(symbols) - catalog.keys()
        if unknown:
            raise ValueError(f"Symbols missing from official catalog: {', '.join(sorted(unknown))}")
        if not symbols or any(catalog[symbol].get("market") not in {"TWSE", "TPEx"} for symbol in symbols):
            raise ValueError("No supported official market for the selected stocks")
    except BaseException:
        engine.dispose()
        raise
    report = {"start": args.start.isoformat(), "end": args.end.isoformat(),
              "symbols": len(symbols), "datasets": {}, "requests": 0}
    prices: dict[str, list[dict]] = {symbol: [] for symbol in symbols}
    market_members: dict[date, dict[str, set[str]]] = {}
    try:
        with httpx.Client(timeout=args.timeout, trust_env=False, follow_redirects=True) as http:
            client = OfficialClient(http, args.interval, args.retries)
            if not getattr(args, "skip_benchmark", False):
                report["datasets"]["benchmark_prices"] = benchmark.import_history(
                    engine, client, args.start, args.end, incremental=getattr(args, "incremental", False))
            for symbol in symbols:
                market_prices = {"TWSE": [], "TPEx": []}
                for month in _months(args.start, args.end):
                    # A transfer can split one month across both official markets.
                    market_prices["TWSE"].extend(_twse_prices(client, symbol, month, args.start, args.end))
                    market_prices["TPEx"].extend(_tpex_prices(client, symbol, month, args.start, args.end))
                if ({row["date"] for row in market_prices["TWSE"]}
                        & {row["date"] for row in market_prices["TPEx"]}):
                    raise ValueError(f"Overlapping official market history for {symbol}")
                prices[symbol] = sorted((row for rows in market_prices.values() for row in rows),
                                        key=lambda row: row["date"])
                if not prices[symbol]:
                    raise ValueError(f"No official price history returned for {symbol}")
                with Session(engine) as db, db.begin():
                    # TPEx monthly history is rounded to thousands; do not replace
                    # exact share/amount values already stored by daily snapshots.
                    for market, rows in market_prices.items():
                        _upsert(db, DailyPrice, rows,
                                preserve_existing=("volume_shares", "amount") if market == "TPEx" else ())
                for market, rows in market_prices.items():
                    for row in rows:
                        members = market_members.setdefault(row["date"], {"TWSE": set(), "TPEx": set()})
                        members[market].add(symbol)
                print(f"price {symbol} rows={len(prices[symbol])}", flush=True)

            report["datasets"]["daily_prices"] = sum(len(rows) for rows in prices.values())
            dates = sorted(market_members)
            if not args.skip_valuations:
                valuation_count = 0
                valued_symbols = set()
                for index, day in enumerate(dates, 1):
                    valuations = []
                    listed, otc = market_members[day]["TWSE"], market_members[day]["TPEx"]
                    if listed:
                        valuations.extend(_twse_valuations(client, day, listed))
                    if otc:
                        valuations.extend(_tpex_valuations(client, day, otc))
                    with Session(engine) as db, db.begin():
                        valuation_count += _upsert(db, StockValuation, valuations)
                    valued_symbols.update(row["symbol"] for row in valuations)
                    if index % 25 == 0 or index == len(dates):
                        print(f"valuation {index}/{len(dates)}", flush=True)
                report["datasets"]["stock_valuations"] = valuation_count
                if set(symbols) - valued_symbols:
                    raise ValueError("No official valuation history for one or more selected stocks")
            if getattr(args, "include_institutional", False):
                institutional_count = 0
                covered_symbols = set()
                for index, day in enumerate(dates, 1):
                    rows = []
                    for market, members in market_members[day].items():
                        if not members:
                            continue
                        for row in institutional.fetch_history(client, day, market):
                            if row["symbol"] in members:
                                rows.append({**row, "date": _date(row["date"])})
                                covered_symbols.add(row["symbol"])
                    with Session(engine) as db, db.begin():
                        institutional_count += _upsert(db, InstitutionalTrade, rows)
                    if index % 25 == 0 or index == len(dates):
                        print(f"institutional {index}/{len(dates)}", flush=True)
                if set(symbols) - covered_symbols:
                    raise ValueError("No official institutional history for one or more selected stocks")
                report["datasets"]["institutional_trades"] = institutional_count
            report["requests"] = client.requests
    finally:
        try:
            for symbol in symbols:
                if prices[symbol]:
                    with Session(engine) as db:
                        recompute(db, symbol, args.start, args.end)
        finally:
            engine.dispose()
    report["coverage"] = {
        "daily_prices": {symbol: [min(row["date"] for row in rows).isoformat(),
                                   max(row["date"] for row in rows).isoformat(), len(rows)]
                         for symbol, rows in prices.items() if rows},
    }
    if not args.skip_valuations:
        report["coverage"]["stock_valuations"] = {
            "rows": report["datasets"].get("stock_valuations", 0),
            "symbols": len(symbols),
        }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Backfill official TWSE/TPEx market history")
    parser.add_argument("--stocks")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2024, 9, 25))
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--out", type=Path,
                        default=state_directory(production=Path(".state")) / "market" / "history_2y.json")
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--skip-valuations", action="store_true")
    parser.add_argument("--include-institutional", action="store_true", help="Import dated official institutional trades")
    parser.add_argument("--skip-benchmark", action="store_true", help="Keep a single-stock backfill scoped to that stock")
    parser.add_argument("--benchmark-only", action="store_true", help="Import only the official TAIEX closing index")
    parser.add_argument("--incremental", action="store_true", help="Refresh benchmark history from its latest stored month")
    args = parser.parse_args(argv)
    if args.stocks:
        args.symbols = list(dict.fromkeys(s.strip() for s in args.stocks.split(",") if s.strip()))
    else:
        args.symbols = None
    if args.start > args.end or args.interval < 0 or not math.isfinite(args.interval):
        parser.error("Invalid date range or interval")
    if args.timeout <= 0 or args.retries < 0:
        parser.error("Timeout must be positive and retries nonnegative")
    try:
        report = backfill(args)
    except Exception as exc:
        print(f"Official market backfill failed ({type(exc).__name__})")
        return 1
    print(json.dumps({"status": "ok", "datasets": report["datasets"], "requests": report["requests"]},
                     ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
