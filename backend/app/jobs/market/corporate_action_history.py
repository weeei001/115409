"""Import official TPEx ex-right calculation results by year, never declarations."""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.market_extra import DividendResult
from app.features.market.company_catalog import load_catalog
from . import corporate_actions as actions
from .chips_history import RetryingClient, _save
from .fetch import stock_info_symbols
from .import_csv import normalized_rows, upsert_rows


URL = "https://www.tpex.org.tw/www/zh-tw/bulletin/exDailyQ"
MAPPING = {"before_price": "除權息前收盤價", "after_price": "除權息參考價",
           "stock_and_cash_dividend": "權值+息值", "stock_or_cash_dividend": "權/息",
           "max_price": "漲停價", "min_price": "跌停價", "open_price": "開始交易基準價",
           "reference_price": "減除股利參考價"}


def fetch_results(http, start, end, symbols):
    response = http.get(URL, params={"startDate": start.strftime("%Y/%m/%d"),
                                    "endDate": end.strftime("%Y/%m/%d"), "response": "json"})
    response.raise_for_status()
    payload = response.json()
    if (not isinstance(payload, dict) or str(payload.get("stat")).lower() != "ok"
            or payload.get("date") != f"{start:%Y%m%d}~{end:%Y%m%d}"):
        raise ValueError("Unexpected TPEx calculation result range")
    tables = payload.get("tables")
    if not isinstance(tables, list) or len(tables) != 1:
        raise ValueError("Unexpected TPEx calculation tables")
    table = tables[0]
    fields, data = table.get("fields"), table.get("data")
    if (not isinstance(fields, list) or not {"除權息日期", "代號", *MAPPING.values()} <= set(fields)
            or not isinstance(data, list) or table.get("totalCount") != len(data)):
        raise ValueError("Unexpected or truncated TPEx calculation results")
    result = {}
    for values in data:
        if not isinstance(values, list) or len(values) != len(fields):
            raise ValueError("Invalid TPEx calculation row")
        raw = dict(zip(fields, values))
        symbol = str(raw["代號"]).strip()
        if symbol not in symbols:
            continue
        day = actions._date(raw["除權息日期"])
        if not start <= day <= end:
            raise ValueError("TPEx result outside requested range")
        row = {"date": day.isoformat(), "symbol": symbol}
        row.update({name: str(raw[field]).strip() if name == "stock_or_cash_dividend"
                    else actions._number(raw[field]) for name, field in MAPPING.items()})
        if not row["before_price"] or not row["after_price"]:
            raise ValueError("Missing official calculation prices")
        key = (row["date"], symbol)
        if key in result:
            raise ValueError("Duplicate TPEx calculation event")
        result[key] = row
    return list(result.values())


def backfill(engine, http, *, symbols, catalog, start, end, out: Path, resume=False):
    if not symbols or start > end or any(symbol not in catalog for symbol in symbols):
        raise ValueError("Invalid corporate action history scope")
    selected = sorted({symbol for symbol in symbols if catalog[symbol]["market"] == "TPEx"})
    scope = {"symbols": selected, "start": start.isoformat(), "end": end.isoformat(),
             "target": hashlib.sha256(engine.url.render_as_string(hide_password=True).encode()).hexdigest()}
    report = {"scope": scope, "source": URL, "kind": "calculation_results", "periods": {}}
    if resume and out.exists():
        report = json.loads(out.read_text(encoding="utf-8"))
        if report.get("scope") != scope:
            raise ValueError("Resume scope mismatch")
    for year in range(start.year, end.year + 1):
        first, last = max(start, date(year, 1, 1)), min(end, date(year, 12, 31))
        key = str(year)
        previous = report["periods"].get(key, {})
        if resume and previous.get("status") == "complete":
            with Session(engine) as db:
                stored = {(day.isoformat(), symbol) for day, symbol in db.execute(select(DividendResult.date,
                    DividendResult.symbol).where(DividendResult.symbol.in_(selected), DividendResult.date >= first,
                                                  DividendResult.date <= last))}
            if all(tuple(pair) in stored for pair in previous.get("events", [])):
                continue
        try:
            rows = fetch_results(http, first, last, set(selected))
            normalized = [normalized_rows(DividendResult, [row], row["symbol"])[0] for row in rows]
            with Session(engine) as db, db.begin():
                written = upsert_rows(db, DividendResult, normalized)
            report["periods"][key] = {"status": "complete", "rows": written,
                "events": [[row["date"], row["symbol"]] for row in rows],
                "symbols_with_events": sorted({row["symbol"] for row in rows}),
                "symbols_without_events": sorted(set(selected) - {row["symbol"] for row in rows})}
        except Exception as exc:
            report["periods"][key] = {"status": "failed", "error": type(exc).__name__}
        _save(out, report)
    report["ok"] = all(period["status"] == "complete" for period in report["periods"].values())
    _save(out, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", type=date.fromisoformat, required=True)
    parser.add_argument("--end", type=date.fromisoformat, required=True)
    parser.add_argument("--symbols")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    engine = None
    try:
        from app.core.http import make_sync_http_client
        settings = get_settings()
        engine = make_engine(settings)
        symbols = args.symbols.split(",") if args.symbols else stock_info_symbols()
        with make_sync_http_client(settings, timeout=40) as http:
            report = backfill(engine, RetryingClient(http), symbols=symbols, catalog=load_catalog(),
                              start=args.start, end=args.end, out=args.out, resume=args.resume)
        print(json.dumps(report))
        return 0 if report["ok"] else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
