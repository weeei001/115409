"""Backfill historical monthly revenues and every filed financial quarter.

Run as ``python -m app.jobs.market.supplemental_history --out REPORT.json``.
Each period commits atomically. An explicit --resume skips periods recorded in
the report; omit it to refresh corrections or after restoring/resetting a DB.
"""
from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
import math
import os
from pathlib import Path
import re
import time

import httpx
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.http import make_sync_http_client
from app.db.engine import make_engine
from app.db.models.market_extra import FinancialStatementRow, MonthlyRevenue
from app.features.market.company_catalog import load_catalog
from . import financial_metrics, monthly_revenue, mops_financial
from .fetch import latest_filed_quarter, stock_info_symbols
from .import_csv import normalized_rows, upsert_rows


class RetryingClient:
    """Throttle every request, including MOPS comparison batches and retries."""

    def __init__(self, http, interval=0.5, retries=2):
        self.http, self.interval, self.retries = http, interval, retries
        self.next_request = 0.0

    def get(self, url, **kwargs):
        for attempt in range(self.retries + 1):
            delay = self.next_request - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            self.next_request = time.monotonic() + self.interval
            try:
                response = self.http.get(url, **kwargs)
                response.raise_for_status()
                return response
            except httpx.HTTPError:
                if attempt == self.retries:
                    raise
                time.sleep(1.5 * (attempt + 1))
        raise AssertionError("unreachable")


def periods(start: date, end: date, datasets: set[str]):
    if "monthly_revenue" in datasets:
        month = start.replace(day=1)
        while month <= end and month < date.today().replace(day=1):
            if month >= start:
                yield "monthly_revenue", month, f"monthly_revenue/{month:%Y-%m}"
            month = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    if "financial_statements" in datasets:
        latest = latest_filed_quarter(end)
        if latest is not None:
            last = mops_financial._quarter_end(*latest)
            for year in range(start.year, last.year + 1):
                for quarter in range(1, 5):
                    period = mops_financial._quarter_end(year, quarter)
                    if start <= period <= min(end, last):
                        yield "financial_statements", period, f"financial_statements/{year}Q{quarter}"


def backfill(engine, client, *, symbols: list[str], start: date, end: date,
             out: Path, datasets: set[str], resume=False) -> dict:
    symbols = sorted(set(symbols))
    if not symbols or any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in symbols):
        raise ValueError("Invalid supplemental-history stock codes")
    if start < date(2021, 1, 1) or end < start or end > date.today():
        raise ValueError("History must start in 2021 or later and end no later than today")
    if not datasets or not datasets <= {"monthly_revenue", "financial_statements", "financial_metrics"}:
        raise ValueError("Unsupported supplemental dataset")
    target = hashlib.sha256(engine.url.render_as_string(hide_password=True).encode()).hexdigest()
    scope = {"symbols": symbols, "start": start.isoformat(), "end": end.isoformat(),
             "datasets": sorted(datasets), "target": target}
    report = {"scope": scope, "periods": {}}
    if resume and out.exists():
        report = json.loads(out.read_text(encoding="utf-8"))
        if report.get("scope") != scope or not isinstance(report.get("periods"), dict):
            raise ValueError("Resume report does not match the requested history or database")
    out.parent.mkdir(parents=True, exist_ok=True)
    for kind, period, key in periods(start, end, datasets):
        if resume and key in report["periods"]:
            continue
        if kind == "monthly_revenue":
            rows = monthly_revenue.fetch_month(client, period, set(symbols))
            model = MonthlyRevenue
        else:
            rows = mops_financial.fetch_quarter(client, period.year, (period.month + 2) // 3,
                                               dict.fromkeys(symbols, {}))
            model = FinancialStatementRow
        if any(row["symbol"] not in symbols or row["date"] != period.isoformat() for row in rows):
            raise ValueError("Historical report returned an unexpected company or period")
        count = 0
        with Session(engine) as db, db.begin():
            for symbol in symbols:
                count += upsert_rows(db, model, normalized_rows(model,
                    [row for row in rows if row["symbol"] == symbol], symbol))
        report["periods"][key] = {"rows": count,
            "missing_symbols": sorted(set(symbols) - {row["symbol"] for row in rows})}
        temporary = out.with_suffix(out.suffix + ".tmp")
        temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, out)
        print(f"period={key} rows={count} missing={len(report['periods'][key]['missing_symbols'])}", flush=True)
    if "financial_metrics" in datasets:
        for symbol in symbols:
            key = f"financial_metrics/{symbol}"
            if resume and key in report["periods"]:
                continue
            rows = financial_metrics.fetch(client, symbol, start, end)
            with Session(engine) as db, db.begin():
                count = financial_metrics.import_rows(db, rows, symbol)
            report["periods"][key] = {"rows": count, "coverage": {
                metric: sorted(row["date"] for row in rows if row["item_type"] == metric)
                for metric in financial_metrics.METRICS}}
            temporary = out.with_suffix(out.suffix + ".tmp")
            temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(temporary, out)
            print(f"period={key} rows={count}", flush=True)
    return report


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Backfill supported-stock monthly revenue and quarterly financial statements")
    parser.add_argument("--stocks", help="Comma-separated supported stock codes; default: current stock_info")
    parser.add_argument("--start", type=date.fromisoformat, default=date(2021, 1, 1))
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--datasets", nargs="+", choices=["monthly_revenue", "financial_statements", "financial_metrics"],
                        default=["monthly_revenue", "financial_statements", "financial_metrics"])
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args(argv)
    if (not math.isfinite(args.interval) or args.interval < 0 or not math.isfinite(args.timeout)
            or args.timeout <= 0 or args.retries < 0 or args.start < date(2021, 1, 1)
            or args.end < args.start or args.end > date.today()):
        parser.error("Invalid history range, timeout, interval or retries")
    enabled = set(stock_info_symbols())
    symbols = ([symbol.strip() for symbol in args.stocks.split(",") if symbol.strip()]
               if args.stocks else sorted(enabled))
    if not symbols or not set(symbols) <= enabled or not set(symbols) <= load_catalog().keys():
        parser.error("Select enabled stock_info symbols present in the official company catalog")
    settings = get_settings()
    engine = make_engine(settings)
    try:
        with make_sync_http_client(settings, timeout=args.timeout, follow_redirects=True) as http:
            report = backfill(engine, RetryingClient(http, args.interval, args.retries), symbols=symbols,
                              start=args.start, end=args.end, out=args.out, datasets=set(args.datasets), resume=args.resume)
        print(json.dumps({"status": "ok", "periods": len(report["periods"])}))
        return 0
    except Exception as exc:
        print(f"Supplemental history failed ({type(exc).__name__})")
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
