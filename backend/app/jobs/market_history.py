"""Backfill official TWSE/TPEx historical prices and valuations."""
from __future__ import annotations

import argparse
import json
import math
import re
import time
from calendar import monthrange
from datetime import date
from pathlib import Path

import httpx
from sqlalchemy import func
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.daily_price import DailyPrice
from app.db.models.finmind_extra import StockValuation
from app.jobs.indicators import recompute


TWSE_PRICE_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY"
TPEX_PRICE_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/tradingStock"
TWSE_VALUATION_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/BWIBBU_d"
TPEX_VALUATION_URL = "https://www.tpex.org.tw/www/zh-tw/afterTrading/peQryDate"
CATALOG_PATH = Path(__file__).resolve().parents[2] / ".state" / "company_catalog.json"


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
    rows = payload.get("data")
    if not isinstance(rows, list):
        return []
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) < 9:
            continue
        day = _date(raw[0])
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
    if not isinstance(payload, dict) or not isinstance(payload.get("tables"), list):
        raise ValueError("Unexpected TPEx price response")
    tables = payload["tables"]
    rows = tables[0].get("data", []) if tables and isinstance(tables[0], dict) else []
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) < 9:
            continue
        day = _date(raw[0])
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
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        return []
    output = []
    for raw in payload["data"]:
        if not isinstance(raw, list) or len(raw) < 7:
            continue
        symbol = str(raw[0]).strip()
        if symbol in symbols:
            output.append({"date": day, "symbol": symbol,
                           "dividend_yield": _number(raw[3]), "per": _number(raw[5]),
                           "pbr": _number(raw[6])})
    return output


def _tpex_valuations(client: OfficialClient, day: date, symbols: set[str]) -> list[dict]:
    payload = client.json("POST", TPEX_VALUATION_URL, data={
        "date": day.strftime("%Y/%m/%d"), "cate": "", "response": "json"})
    if not isinstance(payload, dict) or not isinstance(payload.get("tables"), list):
        return []
    table = payload["tables"][0] if payload["tables"] else {}
    rows = table.get("data", []) if isinstance(table, dict) else []
    output = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) < 7:
            continue
        symbol = str(raw[0]).strip()
        if symbol in symbols:
            output.append({"date": day, "symbol": symbol,
                           "dividend_yield": _number(raw[5]), "per": _number(raw[2]),
                           "pbr": _number(raw[6])})
    return output


def _upsert(db: Session, model, rows: list[dict]) -> int:
    if not rows:
        return 0
    table = model.__table__
    keys = [column.name for column in table.primary_key]
    for offset in range(0, len(rows), 500):
        batch = rows[offset:offset + 500]
        if db.bind.dialect.name == "mysql":
            statement = mysql_insert(table).values(batch)
            statement = statement.on_duplicate_key_update(**{
                column.name: func.coalesce(getattr(statement.inserted, column.name), table.c[column.name])
                for column in table.columns if column.name not in keys
            })
        elif db.bind.dialect.name == "sqlite":
            statement = sqlite_insert(table).values(batch)
            statement = statement.on_conflict_do_update(index_elements=keys, set_={
                column.name: func.coalesce(getattr(statement.excluded, column.name), table.c[column.name])
                for column in table.columns if column.name not in keys
            })
        else:
            raise ValueError("Historical market import requires MySQL or SQLite")
        db.execute(statement)
    return len(rows)


def _load_catalog() -> dict[str, dict]:
    try:
        payload = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"Missing official company catalog: {CATALOG_PATH}") from exc
    if not isinstance(payload, dict):
        raise ValueError("Invalid official company catalog")
    return payload


def _symbols_from_db(engine) -> list[str]:
    from sqlalchemy import text
    with engine.connect() as db:
        return list(db.execute(text("select symbol from stock_info order by symbol")).scalars())


def backfill(args: argparse.Namespace) -> dict:
    engine = make_engine(get_settings())
    catalog = _load_catalog()
    symbols = args.symbols or _symbols_from_db(engine)
    unknown = set(symbols) - catalog.keys()
    if unknown:
        raise ValueError(f"Symbols missing from official catalog: {', '.join(sorted(unknown))}")
    selected = {symbol: catalog[symbol] for symbol in symbols}
    report = {"start": args.start.isoformat(), "end": args.end.isoformat(),
              "symbols": len(symbols), "datasets": {}, "requests": 0}
    prices: dict[str, list[dict]] = {symbol: [] for symbol in symbols}
    try:
        with httpx.Client(timeout=args.timeout, trust_env=False, follow_redirects=True) as http:
            client = OfficialClient(http, args.interval, args.retries)
            for symbol in symbols:
                market = selected[symbol].get("market")
                for month in _months(args.start, args.end):
                    rows = (_twse_prices(client, symbol, month, args.start, args.end)
                            if market == "TWSE" else _tpex_prices(client, symbol, month, args.start, args.end))
                    prices[symbol].extend(rows)
                with Session(engine) as db, db.begin():
                    _upsert(db, DailyPrice, prices[symbol])
                print(f"price {symbol} rows={len(prices[symbol])}", flush=True)

            report["datasets"]["daily_prices"] = sum(len(rows) for rows in prices.values())
            if not args.skip_valuations:
                dates = sorted({row["date"] for rows in prices.values() for row in rows})
                listed = {symbol for symbol, item in selected.items() if item.get("market") == "TWSE"}
                otc = {symbol for symbol, item in selected.items() if item.get("market") == "TPEx"}
                valuations = []
                for index, day in enumerate(dates, 1):
                    if listed:
                        valuations.extend(_twse_valuations(client, day, listed))
                    if otc:
                        valuations.extend(_tpex_valuations(client, day, otc))
                    if index % 25 == 0 or index == len(dates):
                        print(f"valuation {index}/{len(dates)}", flush=True)
                with Session(engine) as db, db.begin():
                    _upsert(db, StockValuation, valuations)
                report["datasets"]["stock_valuations"] = len(valuations)
            report["requests"] = client.requests
    finally:
        for symbol in symbols:
            if prices[symbol]:
                with Session(engine) as db:
                    recompute(db, symbol, args.start, args.end)
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
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--stocks")
    group.add_argument("--from-stock-info", action="store_true")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2024, 9, 25))
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--out", type=Path, default=Path(".state/market/history_2y.json"))
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--skip-valuations", action="store_true")
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
