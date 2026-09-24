"""Sync the official company catalog into the stock_info table."""
from __future__ import annotations

import argparse

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.stock_info import StockInfo
from app.features.market.company_catalog import load_catalog


def sync_catalog(db: Session, catalog: dict[str, dict]) -> int:
    for symbol, company in catalog.items():
        row = db.get(StockInfo, symbol) or StockInfo(symbol=symbol)
        row.name = company["name"]
        row.industry = company.get("industry_name")
        db.add(row)
    return len(catalog)


def main(argv: list[str] | None = None) -> int:
    argparse.ArgumentParser(description="Sync the cached company catalog into stock_info").parse_args(argv)
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
