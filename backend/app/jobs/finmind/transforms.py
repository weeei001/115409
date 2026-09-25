"""FinMind dataset normalization and legacy indicator calculations; no I/O."""
import numpy as np
import pandas as pd


FINANCIAL_STATEMENT_COLUMNS = ["date", "symbol", "statement", "item_type", "origin_name", "value"]
MONTHLY_REVENUE_COLUMNS = ["date", "symbol", "country", "revenue", "revenue_month", "revenue_year", "create_time"]
PER_PBR_COLUMNS = ["date", "symbol", "dividend_yield", "per", "pbr"]
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
