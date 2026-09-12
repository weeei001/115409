"""Fetch FinMind datasets and export the existing CSV interchange format."""
from __future__ import annotations

import argparse
import json
import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd

from app.core.config import get_settings
from . import transforms as transform


log = logging.getLogger(__name__)
FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/data"
DEFAULT_STOCKS = ["2330", "2317", "2454", "2881", "2408", "2615"]
EXTRA_DATASETS = (
    ("monthly_revenue", "TaiwanStockMonthRevenue", transform.normalize_monthly_revenue_df),
    ("per_pbr", "TaiwanStockPER", transform.normalize_per_pbr_df),
    ("dividend", "TaiwanStockDividend", transform.normalize_dividend_df),
    ("dividend_result", "TaiwanStockDividendResult", transform.normalize_dividend_result_df),
    ("margin", "TaiwanStockMarginPurchaseShortSale", transform.normalize_margin_df),
    ("foreign_shareholding", "TaiwanStockShareholding", transform.normalize_foreign_shareholding_df),
)


class FinMindClient:
    def __init__(self, http: httpx.Client, token: str = "", timeout: float = 20, retries: int = 2):
        self.http, self.token, self.timeout, self.retries = http, token, timeout, retries

    def dataset(self, dataset: str, symbol: str, start: str, end: str) -> pd.DataFrame:
        params = {"dataset": dataset, "data_id": symbol, "start_date": start, "end_date": end}
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        for attempt in range(self.retries + 1):
            try:
                response = self.http.get(FINMIND_API_URL, params=params, headers=headers, timeout=self.timeout)
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, dict) or payload.get("status") not in (None, 200, "200"):
                    raise ValueError("FinMind rejected the dataset request")
                rows = payload.get("data")
                if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
                    raise ValueError("Invalid FinMind dataset response")
                return pd.DataFrame(rows)
            except (httpx.HTTPError, ValueError) as exc:
                if attempt == self.retries:
                    raise RuntimeError(f"FinMind dataset {dataset} for {symbol} failed ({type(exc).__name__})") from exc
                time.sleep(1.5 * (attempt + 1))


def read_csv(path: str | Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig", dtype={"symbol": str, "stock_id": str})


def export_symbol(symbol: str, args: argparse.Namespace, client: FinMindClient) -> tuple[dict[str, int], bool]:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    warmup_start = (datetime.fromisoformat(args.start) - timedelta(days=args.warmup_days)).date().isoformat()
    raw_price = read_csv(args.price_csv) if args.price_csv else client.dataset(
        "TaiwanStockPrice", symbol, warmup_start, args.end)
    price = transform.normalize_price_df(raw_price, symbol)
    price = price.loc[price["symbol"] == symbol].reset_index(drop=True)
    if price.empty:
        raise ValueError(f"No price data for {symbol}")
    technical = transform.compute_technical_indicators(price, partial_ma=args.partial_ma)
    outputs = {"price_volume": transform.trim_date_range(price, args.start, args.end),
               "technical": transform.trim_date_range(technical, args.start, args.end)}
    if args.skip_institutional:
        institutional, _, _ = transform.normalize_institutional_df(pd.DataFrame(), symbol)
    else:
        raw = read_csv(args.institutional_csv) if args.institutional_csv else client.dataset(
            "TaiwanStockInstitutionalInvestorsBuySell", symbol, args.start, args.end)
        institutional, unknown, warnings = transform.normalize_institutional_df(raw, symbol)
        for warning in warnings:
            log.warning("%s: %s", symbol, warning)
        if raw.shape[0] and institutional.empty:
            raise ValueError(f"Invalid institutional data for {symbol}")
    outputs["institutional"] = transform.trim_date_range(institutional, args.start, args.end)
    financial = [transform.normalize_financial_statement_df(client.dataset(dataset, symbol, args.start, args.end), symbol, kind)
                 for kind, dataset in (("income", "TaiwanStockFinancialStatements"),
                     ("balance", "TaiwanStockBalanceSheet"), ("cashflow", "TaiwanStockCashFlowsStatement"))]
    outputs["financial_statements"] = pd.concat(financial, ignore_index=True)
    for name, dataset, normalize in EXTRA_DATASETS:
        outputs[name] = normalize(client.dataset(dataset, symbol, args.start, args.end), symbol)
    failed = False
    outputs["holding_shares_per"] = transform.normalize_holding_share_levels_df(pd.DataFrame(), symbol)
    if args.include_holding_shares_per:
        try:
            outputs["holding_shares_per"] = transform.normalize_holding_share_levels_df(
                client.dataset("TaiwanStockHoldingSharesPer", symbol, args.start, args.end), symbol)
        except Exception as exc:
            failed = True
            log.error("%s: requested holding-share dataset failed (%s)", symbol, type(exc).__name__)
    else:
        log.info("%s: paid holding-share dataset skipped", symbol)
    for name, frame in outputs.items():
        frame.to_csv(out_dir / f"{symbol}_{name}.csv", index=False, encoding="utf-8-sig")
    return {name: len(frame) for name, frame in outputs.items()}, failed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Export FinMind stock, technical, chips and fundamental CSVs")
    symbols = parser.add_mutually_exclusive_group()
    symbols.add_argument("--stock")
    symbols.add_argument("--stocks")
    parser.add_argument("--start", required=True)
    parser.add_argument("--end")
    parser.add_argument("--out", default="./finmind_output")
    parser.add_argument("--token", help="Override FINMIND_API_TOKEN for this invocation")
    parser.add_argument("--timeout", type=float, default=20)
    parser.add_argument("--retries", type=int, default=2)
    parser.add_argument("--warmup-days", type=int, default=500)
    parser.add_argument("--partial-ma", action="store_true")
    parser.add_argument("--price-csv")
    parser.add_argument("--institutional-csv")
    parser.add_argument("--skip-institutional", action="store_true")
    parser.add_argument("--include-holding-shares-per", action="store_true")
    args = parser.parse_args(argv)
    args.end = args.end or datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    try:
        for value in (args.start, args.end):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError("Dates must use YYYY-MM-DD")
            datetime.strptime(value, "%Y-%m-%d")
        if args.start > args.end:
            raise ValueError("--start must be <= --end")
        if not math.isfinite(args.timeout) or args.timeout <= 0 or args.retries < 0 or args.warmup_days < 0:
            raise ValueError("Timeout must be positive; retries and warmup must be nonnegative")
    except ValueError as exc:
        parser.error(str(exc))
    args.symbols = list(dict.fromkeys((args.stock or args.stocks or ",".join(DEFAULT_STOCKS)).split(",")))
    args.symbols = [symbol.strip() for symbol in args.symbols if symbol.strip()]
    if not args.symbols or any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in args.symbols):
        parser.error("Stock ids must contain 4 to 6 digits")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    failed = False
    with httpx.Client() as http:
        client = FinMindClient(http, args.token or settings.FINMIND_API_TOKEN, args.timeout, args.retries)
        for symbol in args.symbols:
            try:
                counts, partial_failure = export_symbol(symbol, args, client)
                failed |= partial_failure
                log.info("%s export counts: %s", symbol, counts)
                print(json.dumps({"symbol": symbol, "rows": counts, "failed": partial_failure}, sort_keys=True))
            except Exception as exc:
                failed = True
                log.error("%s export failed (%s)", symbol, type(exc).__name__)
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
