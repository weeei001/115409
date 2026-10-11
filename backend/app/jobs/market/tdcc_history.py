"""Import only TDCC weekly dates actually advertised by the official query form."""
from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import re
import time

from bs4 import BeautifulSoup
import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.market_extra import HoldingShareLevel
from .chips_history import _save
from .fetch import stock_info_symbols
from .import_csv import normalized_rows, upsert_rows
from .tdcc_shareholding import LEVELS


URL = "https://www.tdcc.com.tw/portal/zh/smWeb/qryStock"
HEADERS = ["序", "持股/單位數分級", "人數", "股數/單位數", "占集保庫存數比例 (%)"]


def form_state(html):
    soup = BeautifulSoup(html, "html.parser")
    form = soup.select_one("form#form1")
    if form is None or form.get("action") != "/portal/zh/smWeb/qryStock":
        raise ValueError("Unexpected TDCC query form")
    hidden = {element["name"]: element.get("value", "") for element in form.select("input[type=hidden][name]")}
    if not hidden.get("SYNCHRONIZER_TOKEN") or not hidden.get("firDate"):
        raise ValueError("Missing TDCC session fields")
    dates = sorted({datetime.strptime(option["value"], "%Y%m%d").date()
                    for option in form.select("select[name=scaDate] option[value]")})
    if not dates:
        raise ValueError("No advertised TDCC dates")
    return hidden, dates


def parse_distribution(html, day, symbol):
    soup = BeautifulSoup(html, "html.parser")
    text = soup.get_text(" ", strip=True)
    match = re.search(r"資料日期[：:]\s*(\d+)年\s*(\d+)月\s*(\d+)日", text)
    company = re.search(r"證券代號[：:]\s*(\d{4,6})(?!\d)", text)
    if (not match or date(int(match[1]) + 1911, int(match[2]), int(match[3])) != day
            or not company or company[1] != symbol):
        raise ValueError("TDCC response identity or date mismatch")
    tables = [table for table in soup.select("table")
              if [th.get_text(" ", strip=True) for th in table.select("thead th")] == HEADERS]
    if len(tables) != 1:
        raise ValueError("Unexpected TDCC distribution table")
    rows, seen = [], set()
    for tr in tables[0].select("tr"):
        cells = [td.get_text(" ", strip=True) for td in tr.find_all("td", recursive=False)]
        if not cells:
            continue
        if len(cells) != 5:
            raise ValueError("Invalid TDCC distribution row")
        sequence = int(cells[0])
        label = re.sub(r"\s+", "", cells[1])
        if label in LEVELS[:15]:
            level = LEVELS.index(label) + 1
        elif label.startswith("差異數調整"):
            level = 16
        elif label == LEVELS[16]:
            level = 17
        else:
            raise ValueError("TDCC distribution level changed")
        if sequence != len(rows) + 1 or level in seen:
            raise ValueError("Duplicate or invalid TDCC level")
        people = int(cells[2].replace(",", "")) if cells[2] else None
        units = int(cells[3].replace(",", ""))
        percent = Decimal(cells[4].replace(",", ""))
        if (not percent.is_finite() or people is not None and people < 0
                or level != 16 and (people is None or units < 0 or percent < 0)):
            raise ValueError("Invalid TDCC distribution values")
        seen.add(level)
        rows.append({"date": day.isoformat(), "symbol": symbol, "holding_shares_level": LEVELS[level - 1],
                     "people": people, "unit": units, "percent": str(percent)})
    if not set(range(1, 16)) <= seen or 17 not in seen or seen - set(range(1, 18)):
        raise ValueError("Incomplete TDCC distribution levels")
    return rows


class QueryClient:
    def __init__(self, http, interval=0.5, retries=2):
        self.http, self.interval, self.retries = http, interval, retries
        self.hidden, self.available = {}, []
        self.next_request = 0.0

    def _request(self, method, **kwargs):
        time.sleep(max(0, self.next_request - time.monotonic()))
        try:
            response = self.http.request(method, URL, **kwargs)
            response.raise_for_status()
            return response.text
        finally:
            self.next_request = time.monotonic() + self.interval

    def discover(self):
        self.hidden, self.available = form_state(self._request("GET"))
        return self.available

    def fetch(self, day, symbol):
        for attempt in range(self.retries + 1):
            try:
                if not self.hidden:
                    self.discover()
                if day not in self.available:
                    raise ValueError("Requested date is outside official TDCC availability")
                html = self._request("POST", data={**self.hidden, "scaDate": day.strftime("%Y%m%d"),
                    "sqlMethod": "StockNo", "stockNo": symbol, "stockName": ""})
                self.hidden, self.available = form_state(html)
                return parse_distribution(html, day, symbol)
            except (httpx.HTTPError, ValueError):
                self.hidden = {}
                if attempt == self.retries:
                    raise


def backfill(engine, client, *, symbols, start, end, out: Path, resume=False):
    symbols = sorted(set(symbols))
    if not symbols or start > end or any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in symbols):
        raise ValueError("Invalid TDCC history scope")
    available = client.discover()
    days = [day for day in available if start <= day <= end]
    scope = {"symbols": symbols, "start": start.isoformat(), "end": end.isoformat(),
             "target": hashlib.sha256(engine.url.render_as_string(hide_password=True).encode()).hexdigest()}
    report = {"scope": scope, "source": URL, "weeks": {}}
    if resume and out.exists():
        report = json.loads(out.read_text(encoding="utf-8"))
        if report.get("scope") != scope or not isinstance(report.get("weeks"), dict):
            raise ValueError("TDCC resume scope mismatch")
    report.update(available_dates=[day.isoformat() for day in available],
                  observed_at=datetime.now(timezone.utc).isoformat(),
                  unavailable_before=available[0].isoformat() if start < available[0] else None)
    for day in days:
        key = day.isoformat()
        week = report["weeks"].setdefault(key, {"symbols": {}})
        for symbol in symbols:
            if resume and week["symbols"].get(symbol, {}).get("status") == "complete":
                with Session(engine) as db:
                    levels = set(db.scalars(select(HoldingShareLevel.holding_shares_level).where(
                        HoldingShareLevel.date == day, HoldingShareLevel.symbol == symbol)))
                if levels == set(LEVELS):
                    continue
            try:
                rows = client.fetch(day, symbol)
                levels = {row["holding_shares_level"] for row in rows}
                expected_levels = (set(LEVELS), set(LEVELS) - {LEVELS[15]})
                if (levels not in expected_levels
                        or any(row["date"] != key or row["symbol"] != symbol for row in rows)):
                    raise ValueError("Incomplete TDCC company week")
                normalized = normalized_rows(HoldingShareLevel, rows, symbol)
                with Session(engine) as db, db.begin():
                    count = upsert_rows(db, HoldingShareLevel, normalized)
                week["symbols"][symbol] = {"status": "complete", "rows": count}
            except Exception as exc:
                week["symbols"][symbol] = {"status": "failed", "error": type(exc).__name__}
            _save(out, report)
        week["complete"] = all(week["symbols"].get(symbol, {}).get("status") == "complete" for symbol in symbols)
        _save(out, report)
    report["expected_company_weeks"] = len(days) * len(symbols)
    report["complete_company_weeks"] = sum(report["weeks"][day.isoformat()]["symbols"].get(symbol, {}).get("status")
                                           == "complete" for day in days for symbol in symbols)
    report["available_range_complete"] = bool(days) and report["complete_company_weeks"] == report["expected_company_weeks"]
    report["requested_range_complete"] = report["available_range_complete"] and start >= available[0]
    report["ok"] = report["available_range_complete"]
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
        with make_sync_http_client(settings, timeout=40, follow_redirects=True) as http:
            report = backfill(engine, QueryClient(http), symbols=symbols, start=args.start, end=args.end,
                              out=args.out, resume=args.resume)
        print(json.dumps({key: value for key, value in report.items() if key != "weeks"}))
        return 0 if report["ok"] else 1
    except Exception as exc:
        print(json.dumps({"ok": False, "error": type(exc).__name__}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
