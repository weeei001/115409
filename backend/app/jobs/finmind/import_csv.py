"""Import normalized market CSVs without creating or altering database tables."""
from __future__ import annotations

import argparse
import csv
import json
import logging
import os
from collections import defaultdict, deque
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

from sqlalchemy import Date, Integer, Numeric, func
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.daily_price import DailyPrice
from app.db.models.technical_indicator import TechnicalIndicator
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.finmind_extra import (DividendResult, FinancialStatementRow, ForeignShareholding,
    HoldingShareLevel, MarginTrade, MonthlyRevenue, StockValuation)


log = logging.getLogger(__name__)
CSV_MODELS = {
    "price_volume": DailyPrice,
    "institutional": InstitutionalTrade,
    "financial_statements": FinancialStatementRow,
    "monthly_revenue": MonthlyRevenue,
    "per_pbr": StockValuation,
    "dividend_result": DividendResult,
    "margin": MarginTrade,
    "foreign_shareholding": ForeignShareholding,
    "holding_shares_per": HoldingShareLevel,
}


def read_rows(path: Path, required: list[str]) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        missing = set(required) - set(reader.fieldnames or [])
        if missing:
            raise ValueError(f"{path.name} missing columns: {', '.join(sorted(missing))}")
        return list(reader)


def number(value) -> Decimal | None:
    if value is None or not str(value).strip():
        return None
    try:
        parsed = Decimal(str(value).strip())
        return parsed if parsed.is_finite() else None
    except InvalidOperation:
        return None


def convert(value, column):
    if isinstance(column.type, Date):
        if isinstance(value, date):
            return value
        try:
            return datetime.fromisoformat(str(value).strip()).date()
        except ValueError:
            return None
    if isinstance(column.type, (Integer, Numeric)):
        parsed = number(value)
        if parsed is None:
            return None
        if isinstance(column.type, Integer):
            return int(parsed)
        return parsed.quantize(Decimal(1).scaleb(-column.type.scale), rounding=ROUND_HALF_UP)
    text = str(value).strip() if value is not None else ""
    if text:
        return text
    default = column.default
    return default.arg if default is not None and default.is_scalar else ("" if column.primary_key else None)


def normalized_rows(model, rows: list[dict], symbol: str) -> list[dict]:
    columns = list(model.__table__.columns)
    keys = [column.name for column in model.__table__.primary_key]
    unique = {}
    for raw in rows:
        item = {column.name: convert(raw.get(column.name), column) for column in columns}
        if item.get("symbol") != symbol or not all(item[key] is not None for key in keys):
            continue
        unique[tuple(item[key] for key in keys)] = item
    return [unique[key] for key in sorted(unique)]


def upsert_rows(db: Session, model, rows: list[dict]) -> int:
    if not rows:
        return 0
    table = model.__table__
    keys = [column.name for column in table.primary_key]
    update_keys = [column.name for column in table.columns if column.name not in keys]
    for start in range(0, len(rows), 500):
        batch = rows[start:start + 500]
        if db.bind.dialect.name == "sqlite":
            statement = sqlite_insert(table).values(batch)
            statement = statement.on_conflict_do_update(index_elements=keys,
                set_={key: func.coalesce(getattr(statement.excluded, key), table.c[key]) for key in update_keys})
        else:
            statement = mysql_insert(table).values(batch)
            statement = statement.on_duplicate_key_update(**{
                key: func.coalesce(getattr(statement.inserted, key), table.c[key]) for key in update_keys})
        db.execute(statement)
    return len(rows)


def import_technical_csv(db: Session, price_path: Path, technical_path: Path, symbol: str) -> int:
    prices = normalized_rows(DailyPrice, read_rows(price_path, ["date", "symbol", "close", "volume_shares"]), symbol)
    technical = normalized_rows(TechnicalIndicator, read_rows(technical_path, ["date", "symbol"]), symbol)
    price_index = {(row["date"], row["symbol"]): row for row in prices}
    windows = defaultdict(lambda: deque(maxlen=5))
    for row in technical:
        price = price_index.get((row["date"], row["symbol"]), {})
        row["close"] = price.get("close")
        window = windows[row["symbol"]]
        window.append(price.get("volume_shares"))
        row["volume_ma5"] = ((Decimal(sum(window)) / 5).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                             if len(window) == 5 and all(value is not None for value in window) else None)
    return upsert_rows(db, TechnicalIndicator, technical)


def import_symbol(db: Session, input_dir: Path, symbol: str,
                  datasets: list[str] | None = None) -> dict[str, int]:
    counts = {}
    for suffix, model in CSV_MODELS.items():
        if datasets is not None and suffix not in datasets:
            continue
        path = input_dir / f"{symbol}_{suffix}.csv"
        if datasets is not None and not path.is_file():
            raise ValueError(f"Missing market CSV: {path.name}")
        rows = read_rows(path, ["date", "symbol"] if datasets is not None
                         else [column.name for column in model.__table__.columns])
        counts[suffix] = upsert_rows(db, model, normalized_rows(model, rows, symbol))
    if datasets is None:
        counts["technical"] = import_technical_csv(db, input_dir / f"{symbol}_price_volume.csv",
                                                  input_dir / f"{symbol}_technical.csv", symbol)
    return counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Import market CSVs into existing tables")
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--symbols")
    parser.add_argument("--require-manifest", action="store_true")
    args = parser.parse_args(argv)
    input_dir = Path(args.input_dir)
    if not input_dir.is_dir():
        log.error("Input directory does not exist")
        return 1
    manifest_path = input_dir / "market_manifest.json"
    if args.require_manifest and not manifest_path.is_file():
        log.error("Missing market manifest; run market-fetch first")
        return 1
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
    if manifest is not None and (not isinstance(manifest, dict) or any(
            not isinstance(k, str) or not isinstance(v, list) or not set(v) <= CSV_MODELS.keys()
            for k, v in manifest.items())):
        log.error("Invalid market manifest")
        return 1
    symbols = sorted(manifest if manifest is not None else
                     (path.stem.removesuffix("_price_volume") for path in input_dir.glob("*_price_volume.csv")))
    if args.symbols is not None:
        requested = {symbol.strip() for symbol in args.symbols.split(",") if symbol.strip()}
        symbols = [symbol for symbol in symbols if symbol in requested]
    if not symbols:
        log.warning("No matching market CSV files")
        return 0
    engine = make_engine(get_settings())
    failed = False
    try:
        for symbol in symbols:
            try:
                # All datasets for one stock commit together; a malformed later CSV rolls them back.
                with Session(engine) as db, db.begin():
                    counts = import_symbol(db, input_dir, symbol,
                                           manifest[symbol] if manifest is not None else None)
                if manifest is not None and counts.get("price_volume"):
                    from app.jobs.indicators import recompute
                    with Session(engine) as db:
                        dates = [row["date"] for row in read_rows(
                            input_dir / f"{symbol}_price_volume.csv", ["date", "symbol"])]
                        counts["technical"] = recompute(db, symbol, min(date.fromisoformat(value) for value in dates))
                log.info("%s imported rows: %s", symbol, counts)
                print(json.dumps({"symbol": symbol, "rows": counts}, sort_keys=True))
            except Exception as exc:
                failed = True
                log.error("%s import failed (%s)", symbol, type(exc).__name__)
    finally:
        engine.dispose()
    pending = input_dir / "financial_progress_pending.json"
    if not failed and manifest is not None and set(symbols) == set(manifest) and pending.is_file():
        state = json.loads(pending.read_text(encoding="utf-8"))
        if (isinstance(state, dict) and isinstance(state.get("quarter"), str)
                and isinstance(state.get("offset"), int)):
            os.replace(pending, input_dir / "financial_progress.json")
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
