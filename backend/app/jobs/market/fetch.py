"""Export verified TWSE/TPEx snapshots to the existing CSV import format."""
from __future__ import annotations

import argparse
import csv
import io
import json
import logging
import math
import os
import re
import time
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.stock_info import StockInfo
from app.features.market.company_catalog import refresh_catalog
from . import corporate_actions, foreign_shareholding, institutional, margin, mops_financial, tdcc_shareholding


log = logging.getLogger(__name__)
TWSE = "https://openapi.twse.com.tw/v1"
TPEX = "https://www.tpex.org.tw/openapi/v1"
MOPS = "https://mopsfin.twse.com.tw/opendata"
SOURCES = {
    "price_volume": (("TWSE", f"{TWSE}/exchangeReport/STOCK_DAY_ALL"),
                     ("TPEx", f"{TPEX}/tpex_mainboard_quotes")),
    "per_pbr": (("TWSE", f"{TWSE}/exchangeReport/BWIBBU_ALL"),
                ("TPEx", f"{TPEX}/tpex_mainboard_peratio_analysis")),
    "monthly_revenue": (("TWSE", f"{MOPS}/t187ap05_L.csv"),
                        ("TPEx", f"{MOPS}/t187ap05_O.csv")),
}
FIELDS = {
    "price_volume": ["date", "symbol", "open", "high", "low", "close", "volume_shares", "amount", "change", "trades"],
    "per_pbr": ["date", "symbol", "dividend_yield", "per", "pbr"],
    "monthly_revenue": ["date", "symbol", "country", "revenue", "revenue_month", "revenue_year", "create_time"],
    "foreign_shareholding": foreign_shareholding.FIELDS,
    "institutional": institutional.FIELDS,
    "margin": margin.FIELDS,
    "holding_shares_per": tdcc_shareholding.FIELDS,
    "dividend_result": corporate_actions.FIELDS["dividend_result"],
    "financial_statements": mops_financial.FIELDS,
}

FINANCIAL_BATCH_SIZE = 100


def latest_filed_quarter(end: date) -> tuple[int, int] | None:
    """Use a conservative filing lag; never assume the current quarter is filed."""
    limit = min(end, date.today())
    for year in range(limit.year, 2020, -1):
        for quarter in (4, 3, 2, 1):
            month = quarter * 3
            period = date(year, month, 31 if month in (3, 12) else 30)
            if period + timedelta(days=100 if quarter == 4 else 50) <= limit:
                return year, quarter
    return None


def financial_batch(out: Path, selected: set[str], start: str, end: str) -> tuple[set[str], dict | None]:
    """Choose a bounded batch without advancing the durable import checkpoint."""
    quarter = latest_filed_quarter(date.fromisoformat(end))
    if quarter is None:
        return set(), None
    year, number = quarter
    period = mops_financial._quarter_end(year, number).isoformat()
    if period < start:
        return set(), None
    key = f"{year}Q{number}"
    symbols = sorted(selected)
    state_path = out / "financial_progress.json"
    try:
        previous = json.loads(state_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        previous = {}
    offset = previous.get("offset", 0) if (previous.get("quarter") == key
            and previous.get("total") == len(symbols)) else 0
    if not isinstance(offset, int) or offset < 0 or offset >= len(symbols):
        offset = 0
    batch = symbols[offset:offset + FINANCIAL_BATCH_SIZE]
    pending = {"quarter": key, "offset": (offset + len(batch)) % len(symbols),
               "batch_start": offset, "batch_size": len(batch), "total": len(symbols)}
    return set(batch), pending


def stock_info_symbols() -> list[str]:
    engine = make_engine(get_settings())
    try:
        with Session(engine) as db:
            return list(db.scalars(select(StockInfo.symbol).order_by(StockInfo.symbol)))
    finally:
        engine.dispose()


def iso_date(value: object) -> str:
    text = re.sub(r"\D", "", str(value).strip())
    if len(text) == 7:
        text = f"{int(text[:3]) + 1911:04d}{text[3:]}"
    if len(text) != 8:
        raise ValueError("Invalid official data date")
    return date(int(text[:4]), int(text[4:6]), int(text[6:8])).isoformat()


def numeric(value: object) -> str:
    text = str(value or "").strip().replace(",", "")
    return text if re.fullmatch(r"[+-]?\d+(?:\.\d+)?", text) else ""


def normalize(kind: str, row: dict, market: str) -> dict | None:
    symbol = str(row.get("Code") or row.get("SecuritiesCompanyCode") or row.get("公司代號") or "").strip()
    if not re.fullmatch(r"\d{4,6}", symbol):
        return None
    if kind == "monthly_revenue":
        period = re.sub(r"\D", "", str(row.get("資料年月") or ""))
        if len(period) not in (5, 6):
            return None
        year = int(period[:-2]) + (1911 if len(period) == 5 else 0)
        month = int(period[-2:])
        value = numeric(row.get("營業收入-當月營收"))
        if not value:
            return None
        # MOPS reports revenue in NT$ thousands; the existing table stores NT dollars.
        revenue = str(int(value) * 1000)
        return {"date": date(year, month, 1).isoformat(), "symbol": symbol,
                "revenue": revenue, "revenue_month": month, "revenue_year": year,
                "create_time": iso_date(row["出表日期"]) if row.get("出表日期") else ""}
    day = iso_date(row.get("Date"))
    if kind == "price_volume":
        fields = ({"open": "OpeningPrice", "high": "HighestPrice", "low": "LowestPrice",
                   "close": "ClosingPrice", "volume_shares": "TradeVolume", "amount": "TradeValue",
                   "change": "Change", "trades": "Transaction"} if market == "TWSE" else
                  {"open": "Open", "high": "High", "low": "Low", "close": "Close",
                   "volume_shares": "TradingShares", "amount": "TransactionAmount",
                   "change": "Change", "trades": "TransactionNumber"})
        values = {name: numeric(row.get(source)) for name, source in fields.items()}
        if not values["close"]:
            return None
        return {"date": day, "symbol": symbol, **values}
    if kind == "per_pbr":
        fields = ({"per": "PEratio", "pbr": "PBratio", "dividend_yield": "DividendYield"}
                  if market == "TWSE" else
                  {"per": "PriceEarningRatio", "pbr": "PriceBookRatio", "dividend_yield": "YieldRatio"})
        return {"date": day, "symbol": symbol,
                **{name: numeric(row.get(source)) for name, source in fields.items()}}
    raise ValueError(f"Unknown dataset {kind}")


class OfficialClient:
    def __init__(self, http: httpx.Client, retries: int = 2):
        self.http, self.retries = http, retries

    def rows(self, url: str) -> list[dict]:
        for attempt in range(self.retries + 1):
            try:
                response = self.http.get(url)
                response.raise_for_status()
                if url.endswith(".csv"):
                    rows = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
                else:
                    rows = response.json()
                if not isinstance(rows, list) or not rows or not all(isinstance(row, dict) for row in rows):
                    raise ValueError("Invalid official dataset response")
                return rows
            except (httpx.HTTPError, ValueError, UnicodeError) as exc:
                if attempt == self.retries:
                    raise RuntimeError(f"Official dataset failed: {url.rsplit('/', 1)[-1]} ({type(exc).__name__})") from exc
                time.sleep(1.5 * (attempt + 1))
        raise AssertionError("unreachable")

    def call(self, producer):
        for attempt in range(self.retries + 1):
            try:
                return producer()
            except (httpx.HTTPError, ValueError, KeyError, RuntimeError, UnicodeError):
                if attempt == self.retries:
                    raise
                time.sleep(1.5 * (attempt + 1))


def export(args: argparse.Namespace, client: OfficialClient) -> dict:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "market_manifest.json").unlink(missing_ok=True)
    (out / "financial_progress_pending.json").unlink(missing_ok=True)
    catalog = client.call(lambda: refresh_catalog(client.http))
    selected = set(args.symbols or catalog)
    unknown = selected - catalog.keys()
    if unknown:
        raise ValueError(f"Unknown listed company codes: {', '.join(sorted(unknown))}")
    output: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    report = {"catalog": len(catalog), "selected": len(selected), "datasets": {},
              "requested_range": {"start": args.start, "end": args.end},
              "sources": {**{kind: [url for _, url in sources] for kind, sources in SOURCES.items()},
                  "institutional": ["https://www.twse.com.tw/rwd/zh/fund/T86",
                                    "https://www.tpex.org.tw/openapi/v1/tpex_3insti_daily_trading"],
                  "margin": ["https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN",
                             "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_margin_balance"],
                  "foreign_shareholding": ["https://www.twse.com.tw/rwd/zh/fund/MI_QFIIS",
                                           "https://www.tpex.org.tw/openapi/v1/tpex_3insti_qfii"],
                  "holding_shares_per": [tdcc_shareholding.URL],
                  "dividend_result": [corporate_actions.TWSE_RESULT, corporate_actions.TPEX_RESULT],
                  "financial_statements": [mops_financial.URL]},
              "history": "Most daily datasets are official snapshots; TWSE ex-right results cover the requested interval, and financial statements process one recent-quarter batch per run. The requested start date does not imply complete historical backfill.",
              "single_quarter_metric_gap": ["EPS", "Revenue", "GrossProfit", "OperatingIncome"]}
    for kind, sources in SOURCES.items():
        count = 0
        for market, url in sources:
            rows = client.rows(url)
            recognized = 0
            for row in rows:
                item = normalize(kind, row, market)
                if item and item["symbol"] in catalog and catalog[item["symbol"]]["market"] == market:
                    recognized += 1
                if (item and item["symbol"] in selected and catalog[item["symbol"]]["market"] == market
                        and args.start <= item["date"] <= args.end):
                    output[item["symbol"]][kind].append(item)
                    count += 1
            if not recognized:
                raise ValueError(f"No mapped {market} {kind} rows; official fields may have changed")
        report["datasets"][kind] = count
    latest_twse = max((row["date"] for symbol, datasets in output.items()
                       if catalog[symbol]["market"] == "TWSE"
                       for row in datasets.get("price_volume", [])), default=None)
    for kind, module in (("foreign_shareholding", foreign_shareholding),
                         ("institutional", institutional), ("margin", margin)):
        count = 0
        for market in ("TWSE", "TPEx"):
            if not any(symbol in selected and item["market"] == market for symbol, item in catalog.items()):
                continue
            if market == "TWSE" and not latest_twse:
                raise ValueError("No TWSE price date for official daily reports")
            producer = ((lambda: module.fetch_twse(client.http, date.fromisoformat(latest_twse)))
                        if market == "TWSE" else (lambda: module.fetch_tpex(client.http)))
            rows = client.call(producer)
            recognized = 0
            for item in rows:
                if item["symbol"] in catalog and catalog[item["symbol"]]["market"] == market:
                    recognized += 1
                if (item["symbol"] in selected and catalog[item["symbol"]]["market"] == market
                        and args.start <= item["date"] <= args.end):
                    output[item["symbol"]][kind].append(item)
                    count += 1
            if not recognized:
                raise ValueError(f"No mapped {market} {kind} rows")
        report["datasets"][kind] = count
    holdings = client.call(lambda: tdcc_shareholding.fetch(client.http, selected))
    for item in holdings:
        if args.start <= item["date"] <= args.end:
            output[item["symbol"]]["holding_shares_per"].append(item)
    report["datasets"]["holding_shares_per"] = sum(
        len(datasets.get("holding_shares_per", [])) for datasets in output.values())
    results = client.call(lambda: corporate_actions.fetch_dividend_results(
        client.http, date.fromisoformat(args.start), date.fromisoformat(args.end), catalog))
    for item in results:
        if item["symbol"] in selected:
            output[item["symbol"]]["dividend_result"].append(item)
    report["datasets"]["dividend_result"] = sum(
        len(datasets.get("dividend_result", [])) for datasets in output.values())
    batch, pending = financial_batch(out, selected, args.start, args.end)
    if pending:
        year, quarter = int(pending["quarter"][:4]), int(pending["quarter"][-1])
        rows = client.call(lambda: mops_financial.fetch_quarter(
            client.http, year, quarter, {symbol: catalog[symbol] for symbol in batch}))
        for item in rows:
            if item["symbol"] not in batch:
                raise ValueError("Financial report returned an unselected company")
            output[item["symbol"]]["financial_statements"].append(item)
    report["datasets"]["financial_statements"] = sum(
        len(datasets.get("financial_statements", [])) for datasets in output.values())
    report["financial_progress"] = pending
    report["coverage"] = {}
    for kind in FIELDS:
        dates = [row["date"] for datasets in output.values() for row in datasets.get(kind, [])]
        covered = sum(bool(datasets.get(kind)) for datasets in output.values())
        report["coverage"][kind] = {"companies": covered, "missing_companies": len(selected) - covered,
                                    "oldest_date": min(dates) if dates else None,
                                    "newest_date": max(dates) if dates else None}
    manifest = {}
    for symbol, datasets in output.items():
        manifest[symbol] = sorted(datasets)
        for kind, rows in datasets.items():
            path = out / f"{symbol}_{kind}.csv"
            with path.open("w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.DictWriter(handle, fieldnames=FIELDS[kind])
                writer.writeheader()
                writer.writerows(rows)
    (out / "market_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    if pending:
        (out / "financial_progress_pending.json").write_text(json.dumps(pending), encoding="utf-8")
    temporary = out / "market_manifest.tmp"
    temporary.write_text(json.dumps(manifest, sort_keys=True), encoding="utf-8")
    os.replace(temporary, out / "market_manifest.json")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export official TWSE/TPEx market snapshots")
    parser.add_argument("--stocks", help="Comma-separated company codes; omitted means all listed/OTC companies")
    parser.add_argument("--stock", help="One company code")
    parser.add_argument("--from-stock-info", action="store_true")
    parser.add_argument("--start", default="2021-01-01")
    parser.add_argument("--end", default=date.today().isoformat())
    parser.add_argument("--out", required=True)
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=2)
    args = parser.parse_args(argv)
    if args.stocks and args.stock:
        parser.error("Use either --stocks or --stock")
    if args.from_stock_info and (args.stocks or args.stock):
        parser.error("--from-stock-info cannot be combined with --stocks or --stock")
    args.symbols = ([symbol.strip() for symbol in (args.stocks or args.stock or "").split(",") if symbol.strip()]
                    if not args.from_stock_info else stock_info_symbols())
    if args.from_stock_info and not args.symbols:
        parser.error("stock_info has no symbols")
    if any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in args.symbols):
        parser.error("Stock codes must be 4 to 6 digits")
    try:
        args.start, args.end = date.fromisoformat(args.start).isoformat(), date.fromisoformat(args.end).isoformat()
    except ValueError:
        parser.error("Dates must use YYYY-MM-DD")
    if args.start > args.end or not math.isfinite(args.timeout) or args.timeout <= 0 or args.retries < 0:
        parser.error("Invalid date range, timeout or retries")
    try:
        with httpx.Client(timeout=args.timeout, trust_env=False) as http:
            report = export(args, OfficialClient(http, args.retries))
        print(json.dumps(report, ensure_ascii=False))
        return 0
    except Exception as exc:
        log.error("Official market export failed (%s)", type(exc).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
