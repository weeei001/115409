"""Explicit first-install schema creation; existing tables and rows are preserved."""
import argparse
import json

from sqlalchemy import MetaData, inspect
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.models.news_chunk import chunk_metadata


def schema_metadata():
    import app.db.models  # Register every application mapping before copying metadata.

    metadata = MetaData()
    for source in (Base.metadata, chunk_metadata):
        for table in source.tables.values():
            if table.name == "news_sentiments":
                continue  # Retained ORM compatibility mapping; no current runtime reader or writer.
            copied = table.to_metadata(metadata)
            copied.dialect_options["mysql"]["charset"] = "utf8mb4"
            copied.dialect_options["mysql"]["engine"] = "InnoDB"
    return metadata


def initialize_schema(engine):
    metadata = schema_metadata()
    existing = set(inspect(engine).get_table_names())
    metadata.create_all(engine, checkfirst=True)
    return sorted(set(metadata.tables) - existing)


def main(argv=None):
    parser = argparse.ArgumentParser(description=(
        "Create missing application tables in the configured database. "
        "Does not create a database, alter existing tables, delete data, or call AI providers."
    ))
    parser.add_argument("--sync-catalog", action="store_true",
                        help="Fetch the full official TWSE/TPEx directory and sync 40 supported companies into stock_info")
    args = parser.parse_args(argv)
    from app.core.config import get_settings
    from app.db.engine import make_engine

    engine = make_engine(get_settings())
    try:
        report = {"tables_created": initialize_schema(engine)}
        if args.sync_catalog:
            from app.features.market.company_catalog import refresh_catalog
            from app.jobs.market.stock_info import sync_catalog

            catalog = refresh_catalog()
            if not catalog:
                raise ValueError("Company catalog is unavailable")
            with Session(engine) as db, db.begin():
                report["stock_info_synced"] = sync_catalog(db, catalog)
        print(json.dumps(report, sort_keys=True))
    finally:
        engine.dispose()
    return 0
