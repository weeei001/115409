#!/usr/bin/env python3
"""
fetch_finmind_three_csv.py

使用 FinMind 匯出台股資料為三個 CSV：
1. {symbol}_price_volume.csv  價量
2. {symbol}_technical.csv     技術面
3. {symbol}_institutional.csv 三大法人

設計重點：
- 先輸出 CSV，不寫 DB。
- 支援 FinMind TaiwanStockPrice。
- 支援 FinMind TaiwanStockInstitutionalInvestorsBuySell。
- 技術指標包含 MA5/10/20/60/120/240、RSI5/10/14、KD、MACD、BOLL。
- 為了讓匯出區間月初也能有 MA 值，FinMind 抓取時會自動往前抓 warmup_days 的歷史資料，
  計算完技術指標後才裁切回使用者指定的 start/end 區間。
- 若使用 --price-csv 載入本地 CSV 且沒有 warmup 歷史資料，可用 --partial-ma 讓 MA 以可用資料計算。

使用範例：
python fetch_finmind_three_csv.py --stock 2330 --start 2026-01-01 --end 2026-05-16 --out ./finmind_output

多股票：
python fetch_finmind_three_csv.py --stocks 2317,2330,2454 --start 2026-01-01 --end 2026-05-16 --out ./finmind_output

離線測試：
python fetch_finmind_three_csv.py --stock 2330 --start 2026-01-01 --end 2026-05-16 --out ./finmind_output --price-csv ./2330_price_with_indicators.csv --institutional-csv ./2330_institutional.csv --partial-ma
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd
import requests


FINMIND_API_URL = "https://api.finmindtrade.com/api/v4/data"

DEFAULT_STOCKS = ["2330", "2317", "2454", "2881", "2408", "2615"]

FINANCIAL_STATEMENT_COLUMNS = ["date", "symbol", "statement", "item_type", "origin_name", "value"]
MONTHLY_REVENUE_COLUMNS = ["date", "symbol", "country", "revenue", "revenue_month", "revenue_year", "create_time"]
PER_PBR_COLUMNS = ["date", "symbol", "dividend_yield", "per", "pbr"]
DIVIDEND_COLUMNS = [
    "date",
    "symbol",
    "year",
    "stock_earnings_distribution",
    "stock_statutory_surplus",
    "stock_ex_dividend_trading_date",
    "total_employee_stock_dividend",
    "total_employee_stock_dividend_amount",
    "ratio_of_employee_stock_dividend_of_total",
    "ratio_of_employee_stock_dividend",
    "cash_earnings_distribution",
    "cash_statutory_surplus",
    "cash_ex_dividend_trading_date",
    "cash_dividend_payment_date",
    "total_employee_cash_dividend",
    "total_number_of_cash_capital_increase",
    "cash_increase_subscription_rate",
    "cash_increase_subscription_price",
    "remuneration_of_directors_and_supervisors",
    "participate_distribution_of_total_shares",
    "announcement_date",
    "announcement_time",
]
DIVIDEND_RESULT_COLUMNS = [
    "date",
    "symbol",
    "before_price",
    "after_price",
    "stock_and_cash_dividend",
    "stock_or_cash_dividend",
    "max_price",
    "min_price",
    "open_price",
    "reference_price",
]
MARGIN_COLUMNS = [
    "date",
    "symbol",
    "margin_purchase_buy",
    "margin_purchase_cash_repayment",
    "margin_purchase_limit",
    "margin_purchase_sell",
    "margin_purchase_today_balance",
    "margin_purchase_yesterday_balance",
    "note",
    "offset_loan_and_short",
    "short_sale_buy",
    "short_sale_cash_repayment",
    "short_sale_limit",
    "short_sale_sell",
    "short_sale_today_balance",
    "short_sale_yesterday_balance",
]
FOREIGN_SHAREHOLDING_COLUMNS = [
    "date",
    "symbol",
    "stock_name",
    "international_code",
    "foreign_investment_remaining_shares",
    "foreign_investment_shares",
    "foreign_investment_remain_ratio",
    "foreign_investment_shares_ratio",
    "foreign_investment_upper_limit_ratio",
    "chinese_investment_upper_limit_ratio",
    "number_of_shares_issued",
    "recently_declare_date",
    "note",
]
HOLDING_SHARE_LEVEL_COLUMNS = ["date", "symbol", "holding_shares_level", "people", "percent", "unit"]


@dataclass
class ExportSummary:
    symbol: str
    start_date: str
    end_date: str
    price_rows: int = 0
    technical_rows: int = 0
    institutional_rows: int = 0
    financial_statement_rows: int = 0
    monthly_revenue_rows: int = 0
    per_pbr_rows: int = 0
    dividend_rows: int = 0
    dividend_result_rows: int = 0
    margin_rows: int = 0
    foreign_shareholding_rows: int = 0
    holding_share_level_rows: int = 0
    unknown_institutional_names: list[str] | None = None
    warnings: list[str] | None = None

    def __post_init__(self) -> None:
        if self.unknown_institutional_names is None:
            self.unknown_institutional_names = []
        if self.warnings is None:
            self.warnings = []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch FinMind Taiwan stock data and export three CSVs: price_volume, technical, institutional."
    )
    symbol_group = parser.add_mutually_exclusive_group(required=False)
    symbol_group.add_argument("--stock", help="Single stock id, e.g. 2330")
    symbol_group.add_argument(
        "--stocks", help="Comma-separated stock ids, e.g. 2317,2330,2454")

    parser.add_argument("--start", required=True,
                        help="Output start date YYYY-MM-DD")
    parser.add_argument("--end", default=None,
                        help="Output end date YYYY-MM-DD. Default: today")
    parser.add_argument("--out", default="./finmind_output",
                        help="Output directory")
    parser.add_argument("--token", default=None,
                        help="FinMind API token. Overrides FINMIND_API_TOKEN.")
    parser.add_argument("--timeout", type=int, default=20,
                        help="HTTP timeout seconds")
    parser.add_argument("--retries", type=int, default=2,
                        help="Retry count for transient HTTP errors")
    parser.add_argument(
        "--warmup-days",
        type=int,
        default=500,
        help="Fetch this many calendar days before start for MA/indicator warmup. Used only for FinMind price fetch.",
    )
    parser.add_argument(
        "--partial-ma",
        action="store_true",
        help="Use min_periods=1 for MA. Useful when local --price-csv has no warmup data.",
    )

    parser.add_argument("--price-csv", default=None,
                        help="Use local price CSV instead of FinMind price fetch.")
    parser.add_argument("--institutional-csv", default=None,
                        help="Use local institutional CSV instead of FinMind fetch.")
    parser.add_argument("--skip-institutional", action="store_true",
                        help="Skip institutional investors fetch/export.")
    parser.add_argument(
        "--include-holding-shares-per",
        action="store_true",
        help="Fetch paid TaiwanStockHoldingSharesPer. Disabled by default; failures only warn.",
    )

    return parser.parse_args()


def validate_date_string(value: str, field_name: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError as exc:
        raise ValueError(
            f"{field_name} must be YYYY-MM-DD, got {value!r}") from exc
    return value


def date_minus_days(date_str: str, days: int) -> str:
    dt = datetime.strptime(date_str, "%Y-%m-%d")
    return (dt - timedelta(days=days)).strftime("%Y-%m-%d")


def get_symbols(args: argparse.Namespace) -> list[str]:
    if getattr(args, "stock", None):
        return [args.stock.strip()]
    if getattr(args, "stocks", None):
        return [s.strip() for s in args.stocks.split(",") if s.strip()]
    return DEFAULT_STOCKS.copy()


def read_csv_safely(path: str) -> pd.DataFrame:
    # utf-8-sig works for normal utf-8 too.
    return pd.read_csv(path, encoding="utf-8-sig")


def fetch_finmind_dataset(
    dataset: str,
    data_id: str,
    start_date: str,
    end_date: str,
    token: str | None,
    timeout: int = 20,
    retries: int = 2,
) -> pd.DataFrame:
    params = {
        "dataset": dataset,
        "data_id": data_id,
        "start_date": start_date,
        "end_date": end_date,
    }

    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    last_error: Exception | None = None
    for attempt in range(retries + 1):
        try:
            resp = requests.get(
                FINMIND_API_URL,
                params=params,
                headers=headers or None,
                timeout=timeout,
            )

            if resp.status_code in {429, 500, 502, 503, 504} and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue

            resp.raise_for_status()
            payload = resp.json()

            status = payload.get("status")
            msg = payload.get("msg", "")
            if status not in (None, 200, "200"):
                raise RuntimeError(
                    f"FinMind returned status={status}, msg={msg}")

            if "data" not in payload:
                raise ValueError(
                    f"FinMind response has no data field: {payload}")

            return pd.DataFrame(payload["data"])

        except Exception as exc:
            last_error = exc
            if attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue

    raise RuntimeError(
        f"Failed to fetch FinMind dataset={dataset}, data_id={data_id}: {last_error}") from last_error


def normalize_price_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(
            columns=[
                "date", "symbol", "open", "high", "low", "close",
                "volume_shares", "amount", "change", "trades",
            ]
        )

    out = df.copy()

    rename_map = {
        "stock_id": "symbol",
        "max": "high",
        "min": "low",
        "Trading_Volume": "volume_shares",
        "Trading_money": "amount",
        "spread": "change",
        "Trading_turnover": "trades",
    }
    out = out.rename(
        columns={k: v for k, v in rename_map.items() if k in out.columns})

    if "symbol" not in out.columns:
        out["symbol"] = symbol
    out["symbol"] = out["symbol"].astype(str)

    required = ["date", "symbol", "open", "high", "low",
                "close", "volume_shares", "amount", "change", "trades"]
    for col in required:
        if col not in out.columns:
            out[col] = np.nan

    out["date"] = pd.to_datetime(out["date"]).dt.strftime("%Y-%m-%d")

    numeric_cols = ["open", "high", "low", "close",
                    "volume_shares", "amount", "change", "trades"]
    for col in numeric_cols:
        out[col] = pd.to_numeric(out[col], errors="coerce")

    out = out[required].sort_values("date").drop_duplicates(
        ["date", "symbol"], keep="last").reset_index(drop=True)
    return out


def trim_date_range(df: pd.DataFrame, start_date: str, end_date: str) -> pd.DataFrame:
    if df.empty or "date" not in df.columns:
        return df
    mask = (df["date"] >= start_date) & (df["date"] <= end_date)
    return df.loc[mask].reset_index(drop=True)


def _empty_df(columns: list[str]) -> pd.DataFrame:
    return pd.DataFrame(columns=columns)


def _with_date_symbol(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    out = df.rename(columns={"stock_id": "symbol"}).copy()
    if "symbol" not in out.columns:
        out["symbol"] = symbol
    if "date" not in out.columns:
        raise ValueError("DataFrame must contain 'date' column")
    out["symbol"] = out["symbol"].astype(str)
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.strftime("%Y-%m-%d")
    return out.dropna(subset=["date"]).reset_index(drop=True)


def _ensure_columns(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = df.copy()
    for col in columns:
        if col not in out.columns:
            out[col] = np.nan
    return out


def _coerce_numeric(df: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    out = df.copy()
    for col in columns:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    return out


def normalize_financial_statement_df(df: pd.DataFrame, symbol: str, statement: str) -> pd.DataFrame:
    if statement not in {"income", "balance", "cashflow"}:
        raise ValueError(f"unknown statement: {statement}")
    if df.empty:
        return _empty_df(FINANCIAL_STATEMENT_COLUMNS)

    out = _with_date_symbol(df, symbol).rename(columns={"type": "item_type"})
    out["statement"] = statement
    out = _ensure_columns(out, FINANCIAL_STATEMENT_COLUMNS)
    out = _coerce_numeric(out, ["value"])
    return (
        out[FINANCIAL_STATEMENT_COLUMNS]
        .sort_values(["date", "symbol", "statement", "item_type"])
        .drop_duplicates(["date", "symbol", "statement", "item_type", "origin_name"], keep="last")
        .reset_index(drop=True)
    )


def normalize_monthly_revenue_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(MONTHLY_REVENUE_COLUMNS)
    out = _with_date_symbol(df, symbol)
    out = _ensure_columns(out, MONTHLY_REVENUE_COLUMNS)
    out = _coerce_numeric(out, ["revenue", "revenue_month", "revenue_year"])
    return (
        out[MONTHLY_REVENUE_COLUMNS]
        .sort_values(["date", "symbol"])
        .drop_duplicates(["date", "symbol"], keep="last")
        .reset_index(drop=True)
    )


def normalize_per_pbr_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(PER_PBR_COLUMNS)
    out = _with_date_symbol(df, symbol).rename(columns={"PER": "per", "PBR": "pbr"})
    out = _ensure_columns(out, PER_PBR_COLUMNS)
    out = _coerce_numeric(out, ["dividend_yield", "per", "pbr"])
    return (
        out[PER_PBR_COLUMNS]
        .sort_values(["date", "symbol"])
        .drop_duplicates(["date", "symbol"], keep="last")
        .reset_index(drop=True)
    )


def normalize_dividend_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(DIVIDEND_COLUMNS)
    rename_map = {
        "StockEarningsDistribution": "stock_earnings_distribution",
        "StockStatutorySurplus": "stock_statutory_surplus",
        "StockExDividendTradingDate": "stock_ex_dividend_trading_date",
        "TotalEmployeeStockDividend": "total_employee_stock_dividend",
        "TotalEmployeeStockDividendAmount": "total_employee_stock_dividend_amount",
        "RatioOfEmployeeStockDividendOfTotal": "ratio_of_employee_stock_dividend_of_total",
        "RatioOfEmployeeStockDividend": "ratio_of_employee_stock_dividend",
        "CashEarningsDistribution": "cash_earnings_distribution",
        "CashStatutorySurplus": "cash_statutory_surplus",
        "CashExDividendTradingDate": "cash_ex_dividend_trading_date",
        "CashDividendPaymentDate": "cash_dividend_payment_date",
        "TotalEmployeeCashDividend": "total_employee_cash_dividend",
        "TotalNumberOfCashCapitalIncrease": "total_number_of_cash_capital_increase",
        "CashIncreaseSubscriptionRate": "cash_increase_subscription_rate",
        "CashIncreaseSubscriptionpRrice": "cash_increase_subscription_price",
        "RemunerationOfDirectorsAndSupervisors": "remuneration_of_directors_and_supervisors",
        "ParticipateDistributionOfTotalShares": "participate_distribution_of_total_shares",
        "AnnouncementDate": "announcement_date",
        "AnnouncementTime": "announcement_time",
    }
    out = _with_date_symbol(df, symbol).rename(columns=rename_map)
    out = _ensure_columns(out, DIVIDEND_COLUMNS)
    numeric_cols = [
        col
        for col in DIVIDEND_COLUMNS
        if col not in {"date", "symbol", "year", "stock_ex_dividend_trading_date", "cash_ex_dividend_trading_date", "cash_dividend_payment_date", "announcement_date", "announcement_time"}
    ]
    out = _coerce_numeric(out, numeric_cols)
    return (
        out[DIVIDEND_COLUMNS]
        .sort_values(["date", "symbol", "year"])
        .drop_duplicates(["date", "symbol", "year"], keep="last")
        .reset_index(drop=True)
    )


def normalize_dividend_result_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(DIVIDEND_RESULT_COLUMNS)
    out = _with_date_symbol(df, symbol).rename(
        columns={
            "stock_and_cache_dividend": "stock_and_cash_dividend",
            "stock_or_cache_dividend": "stock_or_cash_dividend",
        }
    )
    out = _ensure_columns(out, DIVIDEND_RESULT_COLUMNS)
    out = _coerce_numeric(
        out,
        [
            "before_price",
            "after_price",
            "stock_and_cash_dividend",
            "max_price",
            "min_price",
            "open_price",
            "reference_price",
        ],
    )
    return (
        out[DIVIDEND_RESULT_COLUMNS]
        .sort_values(["date", "symbol"])
        .drop_duplicates(["date", "symbol"], keep="last")
        .reset_index(drop=True)
    )


def normalize_margin_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(MARGIN_COLUMNS)
    rename_map = {
        "MarginPurchaseBuy": "margin_purchase_buy",
        "MarginPurchaseCashRepayment": "margin_purchase_cash_repayment",
        "MarginPurchaseLimit": "margin_purchase_limit",
        "MarginPurchaseSell": "margin_purchase_sell",
        "MarginPurchaseTodayBalance": "margin_purchase_today_balance",
        "MarginPurchaseYesterdayBalance": "margin_purchase_yesterday_balance",
        "Note": "note",
        "OffsetLoanAndShort": "offset_loan_and_short",
        "ShortSaleBuy": "short_sale_buy",
        "ShortSaleCashRepayment": "short_sale_cash_repayment",
        "ShortSaleLimit": "short_sale_limit",
        "ShortSaleSell": "short_sale_sell",
        "ShortSaleTodayBalance": "short_sale_today_balance",
        "ShortSaleYesterdayBalance": "short_sale_yesterday_balance",
    }
    out = _with_date_symbol(df, symbol).rename(columns=rename_map)
    out = _ensure_columns(out, MARGIN_COLUMNS)
    out = _coerce_numeric(out, [col for col in MARGIN_COLUMNS if col not in {"date", "symbol", "note"}])
    return (
        out[MARGIN_COLUMNS]
        .sort_values(["date", "symbol"])
        .drop_duplicates(["date", "symbol"], keep="last")
        .reset_index(drop=True)
    )


def normalize_foreign_shareholding_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(FOREIGN_SHAREHOLDING_COLUMNS)
    rename_map = {
        "InternationalCode": "international_code",
        "ForeignInvestmentRemainingShares": "foreign_investment_remaining_shares",
        "ForeignInvestmentShares": "foreign_investment_shares",
        "ForeignInvestmentRemainRatio": "foreign_investment_remain_ratio",
        "ForeignInvestmentSharesRatio": "foreign_investment_shares_ratio",
        "ForeignInvestmentUpperLimitRatio": "foreign_investment_upper_limit_ratio",
        "ChineseInvestmentUpperLimitRatio": "chinese_investment_upper_limit_ratio",
        "NumberOfSharesIssued": "number_of_shares_issued",
        "RecentlyDeclareDate": "recently_declare_date",
    }
    out = _with_date_symbol(df, symbol).rename(columns=rename_map)
    out = _ensure_columns(out, FOREIGN_SHAREHOLDING_COLUMNS)
    out = _coerce_numeric(
        out,
        [
            "foreign_investment_remaining_shares",
            "foreign_investment_shares",
            "foreign_investment_remain_ratio",
            "foreign_investment_shares_ratio",
            "foreign_investment_upper_limit_ratio",
            "chinese_investment_upper_limit_ratio",
            "number_of_shares_issued",
        ],
    )
    return (
        out[FOREIGN_SHAREHOLDING_COLUMNS]
        .sort_values(["date", "symbol"])
        .drop_duplicates(["date", "symbol"], keep="last")
        .reset_index(drop=True)
    )


def normalize_holding_share_levels_df(df: pd.DataFrame, symbol: str) -> pd.DataFrame:
    if df.empty:
        return _empty_df(HOLDING_SHARE_LEVEL_COLUMNS)
    out = _with_date_symbol(df, symbol).rename(columns={"HoldingSharesLevel": "holding_shares_level"})
    out = _ensure_columns(out, HOLDING_SHARE_LEVEL_COLUMNS)
    out = _coerce_numeric(out, ["people", "percent", "unit"])
    return (
        out[HOLDING_SHARE_LEVEL_COLUMNS]
        .sort_values(["date", "symbol", "holding_shares_level"])
        .drop_duplicates(["date", "symbol", "holding_shares_level"], keep="last")
        .reset_index(drop=True)
    )



def ema(series: pd.Series, span: int) -> pd.Series:
    return series.ewm(span=span, adjust=False).mean()


def compute_rsi_wilder(close: pd.Series, window: int) -> pd.Series:
    close = pd.to_numeric(close, errors="coerce")
    delta = close.diff()
    gain = delta.clip(lower=0).fillna(0.0)
    loss = (-delta.clip(upper=0)).fillna(0.0)

    rsi_values = [np.nan] * len(close)
    if len(close) <= window:
        return pd.Series(rsi_values, index=close.index, dtype="float64")

    # First valid average uses rows 1..window, because row 0 diff is NaN/0.
    avg_gain = gain.iloc[1: window + 1].mean()
    avg_loss = loss.iloc[1: window + 1].mean()

    def calc_rsi(ag: float, al: float) -> float:
        if al == 0 and ag > 0:
            return 100.0
        if ag == 0 and al > 0:
            return 0.0
        if ag == 0 and al == 0:
            return 50.0
        rs = ag / al
        return 100 - (100 / (1 + rs))

    rsi_values[window] = calc_rsi(avg_gain, avg_loss)

    for i in range(window + 1, len(close)):
        avg_gain = (avg_gain * (window - 1) + gain.iloc[i]) / window
        avg_loss = (avg_loss * (window - 1) + loss.iloc[i]) / window
        rsi_values[i] = calc_rsi(avg_gain, avg_loss)

    return pd.Series(rsi_values, index=close.index, dtype="float64")


def compute_kdj(df: pd.DataFrame, window: int = 9) -> tuple[pd.Series, pd.Series, pd.Series, pd.Series]:
    high_n = df["high"].rolling(window=window, min_periods=1).max()
    low_n = df["low"].rolling(window=window, min_periods=1).min()
    denom = high_n - low_n

    rsv = ((df["close"] - low_n) / denom.replace(0, np.nan)) * 100
    rsv = rsv.fillna(50).clip(lower=0, upper=100)

    k_values = []
    d_values = []
    prev_k = 50.0
    prev_d = 50.0

    for value in rsv:
        k = (prev_k * 2 / 3) + (value * 1 / 3)
        d = (prev_d * 2 / 3) + (k * 1 / 3)
        k_values.append(k)
        d_values.append(d)
        prev_k = k
        prev_d = d

    k_series = pd.Series(k_values, index=df.index, dtype="float64")
    d_series = pd.Series(d_values, index=df.index, dtype="float64")
    j_series = 3 * k_series - 2 * d_series
    return rsv, k_series, d_series, j_series


def compute_technical_indicators(price_df: pd.DataFrame, partial_ma: bool = False) -> pd.DataFrame:
    if price_df.empty:
        return pd.DataFrame()

    df = price_df.copy().sort_values("date").reset_index(drop=True)

    for col in ["open", "high", "low", "close"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    for window in [5, 10, 20, 60, 120, 240]:
        min_periods = 1 if partial_ma else window
        df[f"ma{window}"] = df["close"].rolling(
            window=window, min_periods=min_periods).mean()

    # RSI
    for window in [5, 10]:
        df[f"rsi{window}"] = compute_rsi_wilder(df["close"], window)

    rsv9, k9, d9, j9 = compute_kdj(df, window=9)
    df["rsv9"] = rsv9
    df["kd_k9"] = k9
    df["kd_d9"] = d9
    df["kd_j9"] = j9

    df["ema12"] = ema(df["close"], 12)
    df["ema26"] = ema(df["close"], 26)
    df["macd_dif"] = df["ema12"] - df["ema26"]
    df["macd_dea"] = ema(df["macd_dif"], 9)
    # macd_signal is an alias for DEA / Signal line. Keep both names for clarity.
    df["macd_signal"] = df["macd_dea"]
    df["macd_hist"] = df["macd_dif"] - df["macd_dea"]

    df["boll_mid20"] = df["close"].rolling(
        window=20, min_periods=1 if partial_ma else 20).mean()
    std20 = df["close"].rolling(
        window=20, min_periods=1 if partial_ma else 20).std(ddof=0)
    df["boll_upper20"] = df["boll_mid20"] + 2 * std20
    df["boll_lower20"] = df["boll_mid20"] - 2 * std20

    technical_cols = [
        "date",
        "symbol",
        "close",
        "ma5",
        "ma10",
        "ma20",
        "ma60",
        "ma120",
        "ma240",
        "rsi5",
        "rsi10",
        "rsv9",
        "kd_k9",
        "kd_d9",
        "kd_j9",
        "ema12",
        "ema26",
        "macd_dif",
        "macd_dea",
        "macd_signal",
        "macd_hist",
        "boll_mid20",
        "boll_upper20",
        "boll_lower20",
    ]
    return df[technical_cols].copy()


def detect_institutional_category(name: str) -> str | None:
    value = str(name).strip().lower()

    trust_keys = ["investment_trust", "investment trust", "投信", "trust"]
    foreign_keys = ["foreign", "foreign_investor", "外資", "外陸資", "外資及陸資"]
    dealer_keys = ["dealer", "dealer_self",
                   "dealer_hedging", "自營商", "自行買賣", "避險"]

    if any(k.lower() in value for k in trust_keys):
        return "investment_trust"
    if any(k.lower() in value for k in foreign_keys):
        return "foreign"
    if any(k.lower() in value for k in dealer_keys):
        return "dealer"
    return None


def normalize_institutional_df(df: pd.DataFrame, symbol: str) -> tuple[pd.DataFrame, list[str], list[str]]:
    warnings: list[str] = []
    unknown_names: list[str] = []

    if df.empty:
        columns = [
            "date", "symbol",
            "foreign_buy", "foreign_sell", "foreign_net",
            "investment_trust_buy", "investment_trust_sell", "investment_trust_net",
            "dealer_buy", "dealer_sell", "dealer_net",
            "total_institutional_buy", "total_institutional_sell", "total_institutional_net",
        ]
        return pd.DataFrame(columns=columns), unknown_names, warnings

    raw = df.copy()
    rename_candidates = {
        "stock_id": "symbol",
        "buy_volume": "buy",
        "sell_volume": "sell",
        "buy": "buy",
        "sell": "sell",
        "name": "name",
        "institutional_investors": "name",
    }
    raw = raw.rename(
        columns={k: v for k, v in rename_candidates.items() if k in raw.columns})

    if "symbol" not in raw.columns:
        raw["symbol"] = symbol
    raw["symbol"] = raw["symbol"].astype(str)

    if "date" not in raw.columns:
        raise ValueError("Institutional DataFrame must contain 'date' column")

    raw["date"] = pd.to_datetime(raw["date"]).dt.strftime("%Y-%m-%d")

    if "buy" not in raw.columns or "sell" not in raw.columns:
        warnings.append(
            f"Institutional data columns are insufficient: {list(df.columns)}")
        return pd.DataFrame(), unknown_names, warnings

    raw["buy"] = pd.to_numeric(raw["buy"], errors="coerce").fillna(0)
    raw["sell"] = pd.to_numeric(raw["sell"], errors="coerce").fillna(0)

    base_dates = raw[["date", "symbol"]].drop_duplicates().sort_values(
        ["date", "symbol"]).reset_index(drop=True)

    output = base_dates.copy()
    for prefix in ["foreign", "investment_trust", "dealer"]:
        output[f"{prefix}_buy"] = 0.0
        output[f"{prefix}_sell"] = 0.0
        output[f"{prefix}_net"] = 0.0

    if "name" in raw.columns:
        raw["category"] = raw["name"].map(detect_institutional_category)

        unknown = sorted(raw.loc[raw["category"].isna(
        ), "name"].dropna().astype(str).unique().tolist())
        unknown_names.extend(unknown)
        if unknown:
            warnings.append(
                f"Unknown institutional names not included in category totals: {unknown}")

        mapped = raw.dropna(subset=["category"]).copy()

        if not mapped.empty:
            grouped = mapped.groupby(["date", "symbol", "category"], as_index=False)[
                ["buy", "sell"]].sum()
            for _, row in grouped.iterrows():
                mask = (output["date"] == row["date"]) & (
                    output["symbol"] == row["symbol"])
                prefix = row["category"]
                output.loc[mask, f"{prefix}_buy"] += float(row["buy"])
                output.loc[mask, f"{prefix}_sell"] += float(row["sell"])
                output.loc[mask,
                           f"{prefix}_net"] += float(row["buy"]) - float(row["sell"])
        else:
            warnings.append(
                "Institutional data has name column but no rows could be mapped to 外資 / 投信 / 自營商.")
    else:
        warnings.append(
            "Institutional data has no investor category/name column. "
            "Cannot split 外資 / 投信 / 自營商; only total_institutional_* is available."
        )

    output["total_institutional_buy"] = (
        output["foreign_buy"] +
        output["investment_trust_buy"] + output["dealer_buy"]
    )
    output["total_institutional_sell"] = (
        output["foreign_sell"] +
        output["investment_trust_sell"] + output["dealer_sell"]
    )
    output["total_institutional_net"] = (
        output["foreign_net"] +
        output["investment_trust_net"] + output["dealer_net"]
    )

    if "name" not in raw.columns:
        totals = raw.groupby(["date", "symbol"], as_index=False)[
            ["buy", "sell"]].sum()
        output = output.drop(columns=[
                             "total_institutional_buy", "total_institutional_sell", "total_institutional_net"])
        output = output.merge(totals, on=["date", "symbol"], how="left")
        output = output.rename(
            columns={"buy": "total_institutional_buy", "sell": "total_institutional_sell"})
        output["total_institutional_net"] = output["total_institutional_buy"] - \
            output["total_institutional_sell"]

    ordered_cols = [
        "date", "symbol",
        "foreign_buy", "foreign_sell", "foreign_net",
        "investment_trust_buy", "investment_trust_sell", "investment_trust_net",
        "dealer_buy", "dealer_sell", "dealer_net",
        "total_institutional_buy", "total_institutional_sell", "total_institutional_net",
    ]
    output = output[ordered_cols].sort_values(
        ["date", "symbol"]).reset_index(drop=True)
    return output, unknown_names, warnings


def get_holding_share_levels_df(
    symbol: str,
    args: argparse.Namespace,
    token: str | None,
) -> tuple[pd.DataFrame, list[str]]:
    if not getattr(args, "include_holding_shares_per", False):
        return _empty_df(HOLDING_SHARE_LEVEL_COLUMNS), [
            "TaiwanStockHoldingSharesPer skipped; pass --include-holding-shares-per to fetch paid dataset."
        ]

    try:
        raw = fetch_finmind_dataset(
            dataset="TaiwanStockHoldingSharesPer",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        )
    except Exception as exc:
        return _empty_df(HOLDING_SHARE_LEVEL_COLUMNS), [
            f"TaiwanStockHoldingSharesPer failed and was skipped: {exc}"
        ]
    return normalize_holding_share_levels_df(raw, symbol), []


def fetch_extra_csvs_for_symbol(
    symbol: str,
    args: argparse.Namespace,
    token: str | None,
    out_dir: Path,
) -> tuple[dict[str, int], list[str]]:
    statement_frames = []
    for statement, dataset in (
        ("income", "TaiwanStockFinancialStatements"),
        ("balance", "TaiwanStockBalanceSheet"),
        ("cashflow", "TaiwanStockCashFlowsStatement"),
    ):
        raw = fetch_finmind_dataset(
            dataset=dataset,
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        )
        statement_frames.append(normalize_financial_statement_df(raw, symbol, statement))

    financial = (
        pd.concat(statement_frames, ignore_index=True)
        if statement_frames
        else _empty_df(FINANCIAL_STATEMENT_COLUMNS)
    )
    monthly_revenue = normalize_monthly_revenue_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockMonthRevenue",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    per_pbr = normalize_per_pbr_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockPER",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    dividend = normalize_dividend_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockDividend",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    dividend_result = normalize_dividend_result_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockDividendResult",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    margin = normalize_margin_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockMarginPurchaseShortSale",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    foreign_shareholding = normalize_foreign_shareholding_df(
        fetch_finmind_dataset(
            dataset="TaiwanStockShareholding",
            data_id=symbol,
            start_date=args.start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        ),
        symbol,
    )
    holding_share_levels, warnings = get_holding_share_levels_df(symbol, args, token)

    csvs = {
        "financial_statement_rows": (financial, out_dir / f"{symbol}_financial_statements.csv"),
        "monthly_revenue_rows": (monthly_revenue, out_dir / f"{symbol}_monthly_revenue.csv"),
        "per_pbr_rows": (per_pbr, out_dir / f"{symbol}_per_pbr.csv"),
        "dividend_rows": (dividend, out_dir / f"{symbol}_dividend.csv"),
        "dividend_result_rows": (dividend_result, out_dir / f"{symbol}_dividend_result.csv"),
        "margin_rows": (margin, out_dir / f"{symbol}_margin.csv"),
        "foreign_shareholding_rows": (foreign_shareholding, out_dir / f"{symbol}_foreign_shareholding.csv"),
        "holding_share_level_rows": (holding_share_levels, out_dir / f"{symbol}_holding_shares_per.csv"),
    }

    counts: dict[str, int] = {}
    for key, (df, path) in csvs.items():
        df.to_csv(path, index=False, encoding="utf-8-sig")
        counts[key] = len(df)
    return counts, warnings


def export_three_csvs_for_symbol(
    symbol: str,
    args: argparse.Namespace,
    token: str | None,
) -> ExportSummary:
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    summary = ExportSummary(
        symbol=symbol, start_date=args.start, end_date=args.end)

    if args.price_csv:
        raw_price = read_csv_safely(args.price_csv)
        price = normalize_price_df(raw_price, symbol=symbol)
        price_for_calc = price.copy()
    else:
        fetch_start = date_minus_days(args.start, args.warmup_days)
        raw_price = fetch_finmind_dataset(
            dataset="TaiwanStockPrice",
            data_id=symbol,
            start_date=fetch_start,
            end_date=args.end,
            token=token,
            timeout=args.timeout,
            retries=args.retries,
        )
        price_for_calc = normalize_price_df(raw_price, symbol=symbol)

    if price_for_calc.empty:
        raise RuntimeError(f"No price data for symbol={symbol}")

    technical_full = compute_technical_indicators(
        price_for_calc, partial_ma=args.partial_ma)

    price_out = trim_date_range(price_for_calc, args.start, args.end)
    technical_out = trim_date_range(technical_full, args.start, args.end)

    price_cols = ["date", "symbol", "open", "high", "low",
                  "close", "volume_shares", "amount", "change", "trades"]
    price_out = price_out[price_cols]

    price_path = out_dir / f"{symbol}_price_volume.csv"
    technical_path = out_dir / f"{symbol}_technical.csv"
    institutional_path = out_dir / f"{symbol}_institutional.csv"

    price_out.to_csv(price_path, index=False, encoding="utf-8-sig")
    technical_out.to_csv(technical_path, index=False, encoding="utf-8-sig")

    summary.price_rows = len(price_out)
    summary.technical_rows = len(technical_out)

    if args.skip_institutional:
        inst_out = pd.DataFrame()
        summary.warnings.append(
            "Institutional export skipped by --skip-institutional.")
    else:
        if args.institutional_csv:
            raw_inst = read_csv_safely(args.institutional_csv)
        else:
            raw_inst = fetch_finmind_dataset(
                dataset="TaiwanStockInstitutionalInvestorsBuySell",
                data_id=symbol,
                start_date=args.start,
                end_date=args.end,
                token=token,
                timeout=args.timeout,
                retries=args.retries,
            )

        inst_out, unknown_names, warnings = normalize_institutional_df(
            raw_inst, symbol=symbol)
        inst_out = trim_date_range(inst_out, args.start, args.end)

        summary.unknown_institutional_names.extend(unknown_names)
        summary.warnings.extend(warnings)
        summary.institutional_rows = len(inst_out)

    # Always create the institutional CSV, even if empty/skipped, so downstream paths are stable.
    if args.skip_institutional:
        inst_out = pd.DataFrame(
            columns=[
                "date", "symbol",
                "foreign_buy", "foreign_sell", "foreign_net",
                "investment_trust_buy", "investment_trust_sell", "investment_trust_net",
                "dealer_buy", "dealer_sell", "dealer_net",
                "total_institutional_buy", "total_institutional_sell", "total_institutional_net",
            ]
        )
    inst_out.to_csv(institutional_path, index=False, encoding="utf-8-sig")

    extra_counts, extra_warnings = fetch_extra_csvs_for_symbol(symbol, args, token, out_dir)
    for field_name, count in extra_counts.items():
        setattr(summary, field_name, count)
    summary.warnings.extend(extra_warnings)

    print(f"[{symbol}] exported:")
    print(f"  price volume : {price_path} ({summary.price_rows} rows)")
    print(f"  technical    : {technical_path} ({summary.technical_rows} rows)")
    print(
        f"  institutional: {institutional_path} ({summary.institutional_rows} rows)")
    print(f"  financial    : {summary.financial_statement_rows} rows")
    print(f"  monthly rev  : {summary.monthly_revenue_rows} rows")
    print(f"  per/pbr      : {summary.per_pbr_rows} rows")
    print(f"  dividends    : {summary.dividend_rows} rows")
    print(f"  dividend res : {summary.dividend_result_rows} rows")
    print(f"  margin       : {summary.margin_rows} rows")
    print(f"  foreign hold : {summary.foreign_shareholding_rows} rows")
    print(f"  holding lvls : {summary.holding_share_level_rows} rows")
    for warning in summary.warnings:
        print(f"  warning      : {warning}")

    return summary


def main() -> int:
    args = parse_args()
    args.start = validate_date_string(args.start, "start")
    if args.end is None:
        args.end = datetime.now().strftime("%Y-%m-%d")
    args.end = validate_date_string(args.end, "end")
    if args.start > args.end:
        raise ValueError("--start must be <= --end")

    token = args.token or os.environ.get("FINMIND_API_TOKEN")
    symbols = get_symbols(args)

    summaries: list[ExportSummary] = []
    for symbol in symbols:
        try:
            summaries.append(export_three_csvs_for_symbol(
                symbol=symbol, args=args, token=token))
        except Exception as exc:
            print(f"[{symbol}] ERROR: {exc}", file=sys.stderr)
            if len(symbols) == 1:
                return 1

    print("\nExport summary:")
    for s in summaries:
        print(asdict(s))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
