"""Explicit, additive migration for durable per-stock administrator runs."""
import argparse
import json

from sqlalchemy import inspect, text


def migrate_admin_runs(engine):
    with engine.begin() as connection:
        inspector = inspect(connection)
        if "admin_job_runs" not in inspector.get_table_names():
            raise ValueError("Initialize the application schema first")
        columns = {column["name"] for column in inspector.get_columns("admin_job_runs")}
        if "symbol" in columns:
            return {"columns_added": []}
        connection.execute(text("ALTER TABLE admin_job_runs ADD COLUMN symbol VARCHAR(10) NULL"))
    return {"columns_added": ["symbol"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Add the nullable stock symbol to existing admin job history.")
    parser.parse_args(argv)
    from app.core.config import get_settings
    from app.db.engine import make_engine

    engine = make_engine(get_settings())
    try:
        print(json.dumps(migrate_admin_runs(engine)))
    finally:
        engine.dispose()
    return 0
