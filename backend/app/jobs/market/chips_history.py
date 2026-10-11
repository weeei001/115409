"""Backfill official daily margin and foreign holdings using stored trading days.

Run with ``python -m app.jobs.market.chips_history --start YYYY-MM-DD
--end YYYY-MM-DD --out REPORT.json``. Resume skips only verified complete days.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import ssl
import time

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.daily_price import DailyPrice
from app.db.models.market_extra import ForeignShareholding, MarginTrade
from app.features.market.company_catalog import load_catalog
from . import foreign_shareholding, margin
from .fetch import stock_info_symbols
from .import_csv import normalized_rows, upsert_rows


TPEX_MARGIN_FIELDS = ["代號", "名稱", "前資餘額(張)", "資買", "資賣", "現償", "資餘額", "資屬證金",
                      "資使用率(%)", "資限額", "前券餘額(張)", "券賣", "券買", "券償", "券餘額", "券屬證金",
                      "券使用率(%)", "券限額", "資券相抵(張)", "備註"]
TPEX_MARGIN_POSITIONS = {"margin_purchase_yesterday_balance": 2, "margin_purchase_buy": 3,
    "margin_purchase_sell": 4, "margin_purchase_cash_repayment": 5, "margin_purchase_today_balance": 6,
    "margin_purchase_limit": 9, "short_sale_yesterday_balance": 10, "short_sale_sell": 11,
    "short_sale_buy": 12, "short_sale_cash_repayment": 13, "short_sale_today_balance": 14,
    "short_sale_limit": 17, "offset_loan_and_short": 18}
TPEX_FOREIGN_FIELDS = ["排行", "代號", "名稱", "發行股數(A)", "僑外資及陸資尚可投資股數B=A*F-C",
    "僑外資及陸資持有股數(C)", "僑外資及陸資尚可投資比率(D=B/A)", "僑外資及陸資持股比率(E=C/A)",
    "法令投資上限比率(F)", "備註"]
TPEX_FOREIGN_POSITIONS = {"symbol": 1, "stock_name": 2, "number_of_shares_issued": 3,
    "foreign_investment_remaining_shares": 4, "foreign_investment_shares": 5,
    "foreign_investment_remain_ratio": 6, "foreign_investment_shares_ratio": 7,
    "foreign_investment_upper_limit_ratio": 8, "note": 9}
MODELS = {"margin": MarginTrade, "foreign_shareholding": ForeignShareholding}
TDCC_LIMITATION = {"status": "not_backfilled", "reason": "official_public_history_retained_one_year",
    "source": "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock",
    "detail": "The official public query retains one year; this job does not substitute current snapshots for historical dates."}


def _fetch_market(http, day: date, kind: str, market: str) -> list[dict]:
    if market == "TPEx":
        return fetch_tpex(http, day, kind)
    module = margin if kind == "margin" else foreign_shareholding
    return module.fetch_twse(http, day)


def fetch_tpex(http, day: date, kind: str) -> list[dict]:
    action, fields = (("margin/balance", TPEX_MARGIN_FIELDS) if kind == "margin"
                      else ("insti/qfii", TPEX_FOREIGN_FIELDS))
    if kind not in MODELS:
        raise ValueError("Unsupported chips dataset")
    response = http.get("https://www.tpex.org.tw/www/zh-tw/" + action,
                        params={"date": day.strftime("%Y/%m/%d"), "response": "json"})
    response.raise_for_status()
    payload = response.json()
    if (not isinstance(payload, dict) or str(payload.get("stat")).lower() != "ok"
            or payload.get("date") != day.strftime("%Y%m%d")):
        raise ValueError("Unexpected TPEx historical report date")
    tables = payload.get("tables")
    if not isinstance(tables, list) or len(tables) != 1 or tables[0].get("fields") != fields:
        raise ValueError("TPEx historical report schema changed")
    rows = tables[0].get("data")
    if not isinstance(rows, list):
        raise ValueError("Invalid TPEx historical rows")
    result = []
    for raw in rows:
        if not isinstance(raw, list) or len(raw) != len(fields):
            raise ValueError("Invalid TPEx historical row")
        if kind == "margin":
            symbol = str(raw[0]).strip()
            if not re.fullmatch(r"\d{4,6}", symbol):
                continue
            item = {"date": day.isoformat(), "symbol": symbol, "note": str(raw[19]).strip()}
            item.update({name: margin._count(raw[pos]) for name, pos in TPEX_MARGIN_POSITIONS.items()})
        else:
            item = foreign_shareholding._row({name: raw[pos] for name, pos in TPEX_FOREIGN_POSITIONS.items()},
                                             day.isoformat())
        if item:
            result.append(item)
    if len({row["symbol"] for row in result}) != len(result):
        raise ValueError("Duplicate TPEx historical companies")
    return result


class RetryingClient:
    def __init__(self, http, interval=0.5, retries=2):
        self.http, self.interval, self.retries = http, interval, retries
        self.next_request = 0.0

    def get(self, url, **kwargs):
        for attempt in range(self.retries + 1):
            time.sleep(max(0, self.next_request - time.monotonic()))
            try:
                response = self.http.get(url, **kwargs)
                response.raise_for_status()
                return response
            except httpx.HTTPError:
                if attempt == self.retries:
                    raise
                time.sleep(attempt + 1)
            finally:
                self.next_request = time.monotonic() + self.interval


def _save(out, report):
    out.parent.mkdir(parents=True, exist_ok=True)
    temporary = out.with_suffix(out.suffix + ".tmp")
    temporary.write_text(json.dumps(report, ensure_ascii=False, sort_keys=True), encoding="utf-8")
    for attempt in range(5):
        try:
            os.replace(temporary, out)
            break
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.1 * (attempt + 1))


def backfill(engine, http, *, symbols, catalog, start, end, out: Path, datasets=None, resume=False):
    symbols = sorted(set(symbols))
    datasets = {"margin", "foreign_shareholding"} if datasets is None else set(datasets)
    if (not symbols or any(not re.fullmatch(r"\d{4,6}", value) for value in symbols)
            or not datasets or not datasets <= MODELS.keys() or start > end):
        raise ValueError("Invalid chips history scope")
    markets = {symbol: catalog.get(symbol, {}).get("market") for symbol in symbols}
    if any(market not in {"TWSE", "TPEx"} for market in markets.values()):
        raise ValueError("Missing official company market routing")
    target = hashlib.sha256(engine.url.render_as_string(hide_password=True).encode()).hexdigest()
    scope = {"symbols": symbols, "markets": markets, "datasets": sorted(datasets),
             "start": start.isoformat(), "end": end.isoformat(), "database": target}
    report = {"scope": scope, "days": {}, "tdcc": TDCC_LIMITATION,
              "routing": "current_official_catalog; historical market transfers are not inferred"}
    if resume and out.exists():
        report = json.loads(out.read_text(encoding="utf-8"))
        if report.get("scope") != scope or not isinstance(report.get("days"), dict):
            raise ValueError("Resume report scope or database mismatch")
    plan = defaultdict(set)
    with Session(engine) as db:
        for day, symbol in db.execute(select(DailyPrice.date, DailyPrice.symbol).where(
                DailyPrice.symbol.in_(symbols), DailyPrice.date >= start, DailyPrice.date <= end)):
            plan[(day, markets[symbol])].add(symbol)
    report["symbols_without_prices"] = sorted(set(symbols) - set().union(*plan.values())) if plan else symbols
    for (day, market), expected in sorted(plan.items()):
        for kind in sorted(datasets):
            key = f"{kind}/{market}/{day.isoformat()}"
            model = MODELS[kind]
            previous = report["days"].get(key, {})
            if resume and previous.get("status") == "complete" and previous.get("expected") == sorted(expected):
                previously_obtained = set(previous.get("obtained", expected))
                with Session(engine) as db:
                    present = set(db.scalars(select(model.symbol).where(
                        model.date == day, model.symbol.in_(previously_obtained)))) if previously_obtained else set()
                if present == previously_obtained:
                    continue
            entry = {"expected": sorted(expected), "obtained": [], "missing": sorted(expected), "rows": 0}
            try:
                selected = [row for row in _fetch_market(http, day, kind, market)
                            if row["symbol"] in expected]
                missing = expected - {row["symbol"] for row in selected}
                # Current exchange routing can differ from a historical listing.
                # Query the other official market for only the unmatched symbols.
                if missing:
                    alternate = "TPEx" if market == "TWSE" else "TWSE"
                    selected.extend(row for row in _fetch_market(http, day, kind, alternate)
                                    if row["symbol"] in missing)
                if any(row["date"] != day.isoformat() for row in selected):
                    raise ValueError("Historical row date mismatch")
                if len({row["symbol"] for row in selected}) != len(selected):
                    raise ValueError("Duplicate historical rows")
                required = (["margin_purchase_today_balance", "short_sale_today_balance"] if kind == "margin"
                            else ["foreign_investment_shares", "foreign_investment_shares_ratio"])
                valid = []
                for row in selected:
                    converted = normalized_rows(model, [row], row["symbol"])[0]
                    if any(converted[name] is None for name in required):
                        raise ValueError("Historical balances missing")
                    valid.append(converted)
                with Session(engine) as db, db.begin():
                    entry["rows"] = upsert_rows(db, model, valid)
                obtained = {row["symbol"] for row in valid}
                # A valid official report can omit securities with no published
                # balance for that date. Keep that absence explicit without
                # fabricating zeros or treating it as a fetch failure.
                entry.update(obtained=sorted(obtained), missing=[], not_reported=sorted(expected - obtained),
                             status="complete")
            except Exception as exc:
                entry.update(status="failed", error=type(exc).__name__)
            report["days"][key] = entry
            _save(out, report)
    report["complete_days"] = sum(row["status"] == "complete" for row in report["days"].values())
    report["incomplete_days"] = sum(row["status"] != "complete" for row in report["days"].values())
    report["ok"] = bool(plan) and not report["symbols_without_prices"] and not report["incomplete_days"]
    _save(out, report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", required=True, type=date.fromisoformat)
    parser.add_argument("--symbols", help="Defaults to stock_info companies")
    parser.add_argument("--datasets", default="margin,foreign_shareholding")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--interval", type=float, default=0.5)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--timeout", type=float, default=40)
    args = parser.parse_args(argv)
    today = datetime.now(timezone(timedelta(hours=8))).date()
    if (args.start > args.end or args.end > today or not math.isfinite(args.interval) or args.interval < 0
            or not math.isfinite(args.timeout) or args.timeout <= 0 or not 0 <= args.retries <= 5):
        parser.error("Invalid dates, retry or timeout options")
    engine = None
    try:
        settings = get_settings()
        symbols = args.symbols.split(",") if args.symbols else stock_info_symbols()
        engine = make_engine(settings)
        context = httpx.create_ssl_context(trust_env=settings.OUTBOUND_HTTP_TRUST_ENV)
        context.load_default_certs(ssl.Purpose.SERVER_AUTH)
        with httpx.Client(verify=context, timeout=args.timeout, follow_redirects=True,
                          trust_env=settings.OUTBOUND_HTTP_TRUST_ENV,
                          proxy=settings.OUTBOUND_HTTP_PROXY.strip() or None) as http:
            report = backfill(engine, RetryingClient(http, args.interval, args.retries),
                symbols=[symbol.strip() for symbol in symbols], catalog=load_catalog(), start=args.start, end=args.end,
                out=args.out, datasets=set(args.datasets.split(",")), resume=args.resume)
        print(json.dumps({key: report[key] for key in ("ok", "complete_days", "incomplete_days", "symbols_without_prices", "tdcc")}))
        return 0 if report["ok"] else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
