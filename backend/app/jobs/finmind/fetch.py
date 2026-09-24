"""Fetch FinMind datasets and export the existing CSV interchange format."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import math
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.stock_info import StockInfo
from . import transforms as transform


log = logging.getLogger(__name__)
FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/data"
DEFAULT_STOCKS = ["2330", "2317", "2454", "2881", "2408", "2615"]
DEFAULT_STOCK_LIMIT = 40
DEFAULT_MAX_API_REQUESTS = 600
API_USAGE_PATH = Path(__file__).resolve().parents[2] / ".state" / "finmind_api_usage.json"
EXTRA_DATASETS = (
    ("monthly_revenue", "TaiwanStockMonthRevenue", transform.normalize_monthly_revenue_df),
    ("per_pbr", "TaiwanStockPER", transform.normalize_per_pbr_df),
    ("dividend_result", "TaiwanStockDividendResult", transform.normalize_dividend_result_df),
    ("margin", "TaiwanStockMarginPurchaseShortSale", transform.normalize_margin_df),
    ("foreign_shareholding", "TaiwanStockShareholding", transform.normalize_foreign_shareholding_df),
)
EXPORT_DATASETS = ("price_volume", "technical", "institutional", "financial_statements",
                   *(name for name, _, _ in EXTRA_DATASETS), "holding_shares_per")


class RequestLimitReached(RuntimeError):
    pass


class FinMindClient:
    def __init__(self, http: httpx.Client, token: str = "", timeout: float = 20, retries: int = 2,
                 max_requests: int = DEFAULT_MAX_API_REQUESTS, usage_path: Path | None = None,
                 window_seconds: int = 3600, request_interval: float = 0):
        if max_requests < 1:
            raise ValueError("max_requests must be positive")
        if window_seconds < 1:
            raise ValueError("window_seconds must be positive")
        if request_interval < 0:
            raise ValueError("request_interval must be nonnegative")
        self.http, self.token, self.timeout, self.retries = http, token, timeout, retries
        self.max_requests, self.window_seconds = max_requests, window_seconds
        self.request_interval, self.last_request_at = request_interval, 0.0
        self.usage_path, self.requests_made = usage_path, 0

    def _reserve_request(self) -> None:
        now = time.time()
        recent = []
        # ponytail: one shared usage file; add an OS file lock if concurrent fetch workers are introduced.
        if self.usage_path is not None and self.usage_path.is_file():
            try:
                state = json.loads(self.usage_path.read_text(encoding="utf-8"))
                if isinstance(state, dict) and state.get("token") == hashlib.sha256(self.token.encode()).hexdigest():
                    recent = state.get("timestamps", [])
            except (OSError, TypeError, ValueError):
                recent = []
        recent = [stamp for stamp in recent if isinstance(stamp, (int, float))
                  and now - stamp < self.window_seconds]
        if len(recent) >= self.max_requests:
            raise RequestLimitReached(
                f"FinMind API request limit reached ({self.max_requests}/{self.window_seconds}s)")
        recent.append(now)
        self.requests_made += 1
        if self.usage_path is not None:
            self.usage_path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.usage_path.with_suffix(".tmp")
            temporary.write_text(json.dumps({
                "token": hashlib.sha256(self.token.encode()).hexdigest(),
                "timestamps": recent,
            }), encoding="utf-8")
            os.replace(temporary, self.usage_path)

    def dataset(self, dataset: str, symbol: str, start: str, end: str) -> pd.DataFrame:
        params = {"dataset": dataset, "data_id": symbol, "start_date": start, "end_date": end}
        headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}
        for attempt in range(self.retries + 1):
            if self.request_interval and self.last_request_at:
                time.sleep(max(0, self.request_interval - (time.monotonic() - self.last_request_at)))
            self._reserve_request()
            self.last_request_at = time.monotonic()
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
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 402:
                    raise RequestLimitReached("FinMind API quota exceeded") from exc
                if attempt == self.retries:
                    raise RuntimeError(f"FinMind dataset {dataset} for {symbol} failed (HTTPStatusError)") from exc
                time.sleep(1.5 * (attempt + 1))
            except (httpx.HTTPError, ValueError) as exc:
                if attempt == self.retries:
                    raise RuntimeError(f"FinMind dataset {dataset} for {symbol} failed ({type(exc).__name__})") from exc
                time.sleep(1.5 * (attempt + 1))


def read_csv(path: str | Path) -> pd.DataFrame:
    return pd.read_csv(path, encoding="utf-8-sig", dtype={"symbol": str, "stock_id": str})


def has_exported_symbol(out_dir: Path, symbol: str) -> bool:
    return all((out_dir / f"{symbol}_{name}.csv").is_file() for name in EXPORT_DATASETS)


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
        except RequestLimitReached:
            raise
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
    parser.add_argument("--request-interval", type=float, default=0,
                        help="Seconds between FinMind API requests (default: 0)")
    parser.add_argument("--warmup-days", type=int, default=500)
    parser.add_argument("--partial-ma", action="store_true")
    parser.add_argument("--price-csv")
    parser.add_argument("--institutional-csv")
    parser.add_argument("--skip-institutional", action="store_true")
    parser.add_argument("--include-holding-shares-per", action="store_true")
    parser.add_argument("--from-stock-info", action="store_true")
    parser.add_argument("--max-stocks", type=int, default=DEFAULT_STOCK_LIMIT,
                        help="Maximum stock_info symbols to fetch (default: 40)")
    args = parser.parse_args(argv)
    args.end = args.end or datetime.now(timezone(timedelta(hours=8))).date().isoformat()
    try:
        for value in (args.start, args.end):
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                raise ValueError("Dates must use YYYY-MM-DD")
            datetime.strptime(value, "%Y-%m-%d")
        if args.start > args.end:
            raise ValueError("--start must be <= --end")
        if (not math.isfinite(args.timeout) or args.timeout <= 0 or args.retries < 0
                or not math.isfinite(args.request_interval) or args.request_interval < 0
                or args.warmup_days < 0 or args.max_stocks < 1):
            raise ValueError("Timeout must be positive; retries, request interval and warmup must be nonnegative; stock limit must be positive")
    except ValueError as exc:
        parser.error(str(exc))
    if args.from_stock_info and (args.stock or args.stocks):
        parser.error("--from-stock-info cannot be combined with --stock or --stocks")
    args.symbols = (list(dict.fromkeys((args.stock or args.stocks or ",".join(DEFAULT_STOCKS)).split(",")))
                    if not args.from_stock_info else [])
    args.symbols = [symbol.strip() for symbol in args.symbols if symbol.strip()]
    if args.symbols and any(not re.fullmatch(r"\d{4,6}", symbol) for symbol in args.symbols):
        parser.error("Stock ids must contain 4 to 6 digits")
    return args


def stock_info_symbols(settings) -> list[str]:
    engine = make_engine(settings)
    try:
        with Session(engine) as db:
            return list(db.scalars(select(StockInfo.symbol).order_by(StockInfo.symbol)))
    finally:
        engine.dispose()


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    settings = get_settings()
    if args.from_stock_info:
        args.symbols = stock_info_symbols(settings)[:args.max_stocks]
        if not args.symbols:
            log.error("stock_info has no symbols")
            return 1
    failed = False
    limit_reached = False
    with httpx.Client() as http:
        client = FinMindClient(http, args.token or settings.FINMIND_API_TOKEN, args.timeout, args.retries,
                               DEFAULT_MAX_API_REQUESTS, usage_path=API_USAGE_PATH,
                               request_interval=args.request_interval)
        for symbol in args.symbols:
            if has_exported_symbol(Path(args.out), symbol):
                print(json.dumps({"symbol": symbol, "skipped": True}, sort_keys=True))
                continue
            try:
                counts, partial_failure = export_symbol(symbol, args, client)
                failed |= partial_failure
                log.info("%s export counts: %s", symbol, counts)
                print(json.dumps({"symbol": symbol, "rows": counts, "failed": partial_failure}, sort_keys=True))
            except RequestLimitReached:
                limit_reached = True
                log.warning("FinMind hourly API request limit reached after %d calls; rerun to continue",
                            client.requests_made)
                break
            except Exception as exc:
                failed = True
                log.error("%s export failed (%s)", symbol, type(exc).__name__)
    return int(failed or limit_reached)


if __name__ == "__main__":
    raise SystemExit(main())
