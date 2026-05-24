#!/usr/bin/env python3
"""Import FinMind exported CSV files into MySQL."""

from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable

import pandas as pd
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy import text

BACKEND_ROOT = Path(__file__).resolve().parents[2]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import Base, SessionLocal, engine
from models.institutional_trade import InstitutionalTrade
from models.daily_price import DailyPrice
from models.technical_indicator import TechnicalIndicator

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


def _parse_date(value: str) -> str:
    datetime.strptime(value, "%Y-%m-%d")
    return value


def _read_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        return pd.DataFrame()
    return pd.read_csv(path, encoding="utf-8-sig")


def _to_python_value(value):
    if pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return value
    return value


def _quantize(value, digits: str):
    if value is None or pd.isna(value):
        return None
    return Decimal(str(value)).quantize(Decimal(digits), rounding=ROUND_HALF_UP)


def _calc_rsi_wilder(close: pd.Series, window: int = 14) -> pd.Series:
    close = pd.to_numeric(close, errors="coerce")
    delta = close.diff()
    gain = delta.clip(lower=0).fillna(0.0)
    loss = (-delta.clip(upper=0)).fillna(0.0)

    rsi_values = [None] * len(close)
    if len(close) <= window:
        return pd.Series(rsi_values, index=close.index, dtype="float64")

    avg_gain = gain.iloc[1 : window + 1].mean()
    avg_loss = loss.iloc[1 : window + 1].mean()

    def calc_rsi(ag: float, al: float) -> float:
        if al == 0 and ag > 0:
            return 100.0
        if ag == 0 and al > 0:
            return 0.0
        if ag == 0 and al == 0:
            return 50.0
        rs = ag / al
        return 100.0 - (100.0 / (1.0 + rs))

    rsi_values[window] = calc_rsi(avg_gain, avg_loss)

    for idx in range(window + 1, len(close)):
        avg_gain = (avg_gain * (window - 1) + gain.iloc[idx]) / window
        avg_loss = (avg_loss * (window - 1) + loss.iloc[idx]) / window
        rsi_values[idx] = calc_rsi(avg_gain, avg_loss)

    return pd.Series(rsi_values, index=close.index, dtype="float64")


def _upsert_rows(db, model, rows: list[dict], update_keys: Iterable[str]) -> int:
    if not rows:
        return 0

    stmt = mysql_insert(model).values(rows)
    update_values = {key: getattr(stmt.inserted, key) for key in update_keys}
    stmt = stmt.on_duplicate_key_update(**update_values)
    db.execute(stmt)
    db.commit()
    return len(rows)


def _calc_safe_int(value):
    if value is None or pd.isna(value):
        return None
    return int(value)


def _existing_columns(db, table_name: str) -> set[str]:
    result = db.execute(text(f"SHOW COLUMNS FROM `{table_name}`"))
    return {row[0] for row in result}


def ensure_finmind_schema(db) -> None:
    technical_columns = {
        "close": "DECIMAL(10,2) NULL",
        "ma5": "DECIMAL(10,2) NULL",
        "ma10": "DECIMAL(10,2) NULL",
        "ma20": "DECIMAL(10,2) NULL",
        "ma60": "DECIMAL(10,2) NULL",
        "ma120": "DECIMAL(10,2) NULL",
        "ma240": "DECIMAL(10,2) NULL",
        "rsi5": "DECIMAL(6,2) NULL",
        "rsi10": "DECIMAL(6,2) NULL",
        "rsv9": "DECIMAL(6,2) NULL",
        "kd_k9": "DECIMAL(6,2) NULL",
        "kd_d9": "DECIMAL(6,2) NULL",
        "kd_j9": "DECIMAL(6,2) NULL",
        "ema12": "DECIMAL(10,4) NULL",
        "ema26": "DECIMAL(10,4) NULL",
        "macd_dif": "DECIMAL(10,4) NULL",
        "macd_dea": "DECIMAL(10,4) NULL",
        "macd_signal": "DECIMAL(10,4) NULL",
        "macd_hist": "DECIMAL(10,4) NULL",
        "boll_mid20": "DECIMAL(10,2) NULL",
        "boll_upper20": "DECIMAL(10,2) NULL",
        "boll_lower20": "DECIMAL(10,2) NULL",
        "volume_ma5": "DECIMAL(20,2) NULL",
    }
    institutional_columns = {
        "foreign_buy": "BIGINT NULL",
        "foreign_sell": "BIGINT NULL",
        "foreign_net": "BIGINT NULL",
        "investment_trust_buy": "BIGINT NULL",
        "investment_trust_sell": "BIGINT NULL",
        "investment_trust_net": "BIGINT NULL",
        "dealer_buy": "BIGINT NULL",
        "dealer_sell": "BIGINT NULL",
        "dealer_net": "BIGINT NULL",
        "total_institutional_buy": "BIGINT NULL",
        "total_institutional_sell": "BIGINT NULL",
        "total_institutional_net": "BIGINT NULL",
    }

    for table_name, column_map in (
        ("technical_indicators", technical_columns),
        ("institutional_trades", institutional_columns),
    ):
        existing = _existing_columns(db, table_name)
        desired_columns = set(column_map.keys()) | {"date", "symbol"}
        for old_column in sorted(existing - desired_columns):
            if old_column in {"date", "symbol"}:
                continue
            db.execute(text(f"ALTER TABLE `{table_name}` DROP COLUMN `{old_column}`"))
        for column_name, column_ddl in column_map.items():
            if column_name in existing:
                continue
            db.execute(
                text(
                    f"ALTER TABLE `{table_name}` ADD COLUMN `{column_name}` {column_ddl}"
                )
            )
        db.commit()


def import_price_csv(db, path: Path) -> int:
    df = _read_csv(path)
    if df.empty:
        return 0

    required = ["date", "symbol", "open", "high", "low", "close", "volume_shares", "amount", "change", "trades"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Price CSV missing column: {col}")

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["symbol"] = df["symbol"].astype(str)
    for col in ["open", "high", "low", "close", "change"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ["volume_shares", "amount", "trades"]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.sort_values(["symbol", "date"]).drop_duplicates(["date", "symbol"], keep="last")
    rows = []
    for _, row in df.iterrows():
        rows.append(
            {
                "date": row["date"],
                "symbol": row["symbol"],
                "open": _quantize(row["open"], "0.01"),
                "high": _quantize(row["high"], "0.01"),
                "low": _quantize(row["low"], "0.01"),
                "close": _quantize(row["close"], "0.01"),
                "volume_shares": None if pd.isna(row["volume_shares"]) else int(row["volume_shares"]),
                "amount": None if pd.isna(row["amount"]) else int(row["amount"]),
                "change": _quantize(row["change"], "0.01"),
                "trades": None if pd.isna(row["trades"]) else int(row["trades"]),
            }
        )

    return _upsert_rows(
        db,
        DailyPrice,
        rows,
        ["open", "high", "low", "close", "volume_shares", "amount", "change", "trades"],
    )


def import_technical_csv(db, price_path: Path, technical_path: Path) -> int:
    price_df = _read_csv(price_path)
    technical_df = _read_csv(technical_path)
    if price_df.empty or technical_df.empty:
        return 0

    price_df = price_df.copy()
    technical_df = technical_df.copy()

    price_df["date"] = pd.to_datetime(price_df["date"]).dt.date
    technical_df["date"] = pd.to_datetime(technical_df["date"]).dt.date
    price_df["symbol"] = price_df["symbol"].astype(str)
    technical_df["symbol"] = technical_df["symbol"].astype(str)

    price_df = price_df.sort_values(["symbol", "date"]).drop_duplicates(["date", "symbol"], keep="last")
    technical_df = technical_df.sort_values(["symbol", "date"]).drop_duplicates(["date", "symbol"], keep="last")

    merged = technical_df.merge(
        price_df[["date", "symbol", "close", "volume_shares"]].rename(
            columns={"close": "price_close", "volume_shares": "price_volume_shares"}
        ),
        on=["date", "symbol"],
        how="left",
    )

    merged["price_close"] = pd.to_numeric(merged["price_close"], errors="coerce")
    merged["price_volume_shares"] = pd.to_numeric(merged["price_volume_shares"], errors="coerce")
    merged["volume_ma5"] = merged.groupby("symbol", sort=False)["price_volume_shares"].transform(
        lambda s: s.rolling(window=5, min_periods=5).mean()
    )

    rows: list[dict] = []
    for _, row in merged.iterrows():
        rows.append(
            {
                "date": row["date"],
                "symbol": row["symbol"],
                "close": _quantize(row.get("price_close"), "0.01"),
                "ma5": _quantize(row.get("ma5"), "0.01"),
                "ma10": _quantize(row.get("ma10"), "0.01"),
                "ma20": _quantize(row.get("ma20"), "0.01"),
                "ma60": _quantize(row.get("ma60"), "0.01"),
                "ma120": _quantize(row.get("ma120"), "0.01"),
                "ma240": _quantize(row.get("ma240"), "0.01"),
                "rsi5": _quantize(row.get("rsi5"), "0.01"),
                "rsi10": _quantize(row.get("rsi10"), "0.01"),
                "rsv9": _quantize(row.get("rsv9"), "0.01"),
                "kd_k9": _quantize(row.get("kd_k9"), "0.01"),
                "kd_d9": _quantize(row.get("kd_d9"), "0.01"),
                "kd_j9": _quantize(row.get("kd_j9"), "0.01"),
                "ema12": _quantize(row.get("ema12"), "0.0001"),
                "ema26": _quantize(row.get("ema26"), "0.0001"),
                "macd_dif": _quantize(row.get("macd_dif"), "0.0001"),
                "macd_dea": _quantize(row.get("macd_dea"), "0.0001"),
                "macd_signal": _quantize(row.get("macd_signal"), "0.0001"),
                "macd_hist": _quantize(row.get("macd_hist"), "0.0001"),
                "boll_mid20": _quantize(row.get("boll_mid20"), "0.01"),
                "boll_upper20": _quantize(row.get("boll_upper20"), "0.01"),
                "boll_lower20": _quantize(row.get("boll_lower20"), "0.01"),
                "volume_ma5": _quantize(row.get("volume_ma5"), "0.01"),
            }
        )

    return _upsert_rows(
        db,
        TechnicalIndicator,
        rows,
        [
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
            "volume_ma5",
        ],
    )


def import_institutional_csv(db, institutional_path: Path) -> int:
    df = _read_csv(institutional_path)
    if df.empty:
        return 0

    required = [
        "date",
        "symbol",
        "foreign_buy",
        "foreign_sell",
        "foreign_net",
        "investment_trust_buy",
        "investment_trust_sell",
        "investment_trust_net",
        "dealer_buy",
        "dealer_sell",
        "dealer_net",
        "total_institutional_buy",
        "total_institutional_sell",
        "total_institutional_net",
    ]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"Institutional CSV missing column: {col}")

    df = df.copy()
    df["date"] = pd.to_datetime(df["date"]).dt.date
    df["symbol"] = df["symbol"].astype(str)
    for col in required[2:]:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.sort_values(["symbol", "date"]).drop_duplicates(["date", "symbol"], keep="last")
    rows = []
    for _, row in df.iterrows():
        rows.append(
            {
                "date": row["date"],
                "symbol": row["symbol"],
                "foreign_buy": _calc_safe_int(row.get("foreign_buy")),
                "foreign_sell": _calc_safe_int(row.get("foreign_sell")),
                "foreign_net": _calc_safe_int(row.get("foreign_net")),
                "investment_trust_buy": _calc_safe_int(row.get("investment_trust_buy")),
                "investment_trust_sell": _calc_safe_int(row.get("investment_trust_sell")),
                "investment_trust_net": _calc_safe_int(row.get("investment_trust_net")),
                "dealer_buy": _calc_safe_int(row.get("dealer_buy")),
                "dealer_sell": _calc_safe_int(row.get("dealer_sell")),
                "dealer_net": _calc_safe_int(row.get("dealer_net")),
                "total_institutional_buy": _calc_safe_int(row.get("total_institutional_buy")),
                "total_institutional_sell": _calc_safe_int(row.get("total_institutional_sell")),
                "total_institutional_net": _calc_safe_int(row.get("total_institutional_net")),
            }
        )

    return _upsert_rows(
        db,
        InstitutionalTrade,
        rows,
        [
            "foreign_buy",
            "foreign_sell",
            "foreign_net",
            "investment_trust_buy",
            "investment_trust_sell",
            "investment_trust_net",
            "dealer_buy",
            "dealer_sell",
            "dealer_net",
            "total_institutional_buy",
            "total_institutional_sell",
            "total_institutional_net",
        ],
    )


def discover_symbols(input_dir: Path) -> list[str]:
    symbols = []
    for price_file in sorted(input_dir.glob("*_price_volume.csv")):
        symbol = price_file.stem.removesuffix("_price_volume")
        if symbol:
            symbols.append(symbol)
    return symbols


def main() -> int:
    parser = argparse.ArgumentParser(description="Import FinMind CSV output into MySQL.")
    parser.add_argument("--input-dir", required=True, help="Directory containing FinMind CSV files")
    parser.add_argument("--symbols", default=None, help="Comma-separated symbol list to import")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.exists():
        raise FileNotFoundError(f"Input directory not found: {input_dir}")

    Base.metadata.create_all(bind=engine)

    requested_symbols = None
    if args.symbols:
        requested_symbols = {symbol.strip() for symbol in args.symbols.split(",") if symbol.strip()}

    symbols = discover_symbols(input_dir)
    if requested_symbols is not None:
        symbols = [symbol for symbol in symbols if symbol in requested_symbols]

    if not symbols:
        log.warning("No FinMind price CSV files found in %s", input_dir)
        return 0

    db = SessionLocal()
    try:
        ensure_finmind_schema(db)
        total_price_rows = 0
        total_technical_rows = 0
        for symbol in symbols:
            price_path = input_dir / f"{symbol}_price_volume.csv"
            technical_path = input_dir / f"{symbol}_technical.csv"
            institutional_path = input_dir / f"{symbol}_institutional.csv"

            price_rows = import_price_csv(db, price_path)
            technical_rows = import_technical_csv(db, price_path, technical_path)
            institutional_rows = import_institutional_csv(db, institutional_path)

            total_price_rows += price_rows
            total_technical_rows += technical_rows

            log.info("[%s] price rows imported: %d", symbol, price_rows)
            log.info("[%s] technical rows imported: %d", symbol, technical_rows)
            log.info("[%s] institutional rows imported: %d", symbol, institutional_rows)

        log.info("Import summary: price=%d, technical=%d", total_price_rows, total_technical_rows)
    finally:
        db.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())