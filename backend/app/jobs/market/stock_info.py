"""Sync the 40 supported companies while retaining the full recognition catalog."""
from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.stock_info import StockInfo
from app.features.market.company_catalog import load_catalog


SUPPORTED_SYMBOLS = (
    "1101", "1102", "1216", "1231", "1301", "1303", "1402", "1476",
    "1504", "1519", "2002", "2014", "2105", "2106", "2201", "2207",
    "2330", "2454", "2382", "2357", "2409", "3008", "2412", "3045",
    "2308", "2327", "2603", "2609", "2881", "2882", "1795", "6446",
    "2501", "2542", "2707", "2727", "2903", "2912", "2317", "2354",
)


def sync_catalog(db: Session, catalog: dict[str, dict]) -> int:
    missing = set(SUPPORTED_SYMBOLS) - catalog.keys()
    if missing:
        raise ValueError(f"Company catalog is missing supported symbols: {', '.join(sorted(missing))}")
    for symbol in SUPPORTED_SYMBOLS:
        company = catalog[symbol]
        row = db.get(StockInfo, symbol) or StockInfo(symbol=symbol)
        row.name = company["name"]
        row.industry = company.get("industry_name")
        db.add(row)
    return len(SUPPORTED_SYMBOLS)


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Sync 40 supported companies from the full cached catalog into stock_info").parse_args(argv)
    catalog = load_catalog()
    if not catalog:
        raise ValueError("Company catalog is unavailable")
    engine = make_engine(get_settings())
    try:
        with Session(engine) as db, db.begin():
            count = sync_catalog(db, catalog)
        print(f"stock_info={count}")
    finally:
        engine.dispose()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
