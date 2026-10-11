"""Copy verified public data into pre-created, empty staging tables.

This module never creates schemas, deletes rows, or copies user/account data.
Callers own environment selection and any later promotion. Keep the source
quiescent while copying; the target copy and verification share one transaction.
"""
from __future__ import annotations

from datetime import date, datetime, time
from decimal import Decimal
import hashlib
import json
from pathlib import Path

from sqlalchemy import MetaData, Table, and_, func, inspect, not_, or_, select
from sqlalchemy.sql import sqltypes


PUBLIC_DATA_TABLES = (
    "stock_info",
    "market_daily_prices", "market_benchmark_prices", "market_technical_indicators",
    "market_institutional_trades", "market_financial_statement_rows",
    "market_monthly_revenues", "market_stock_valuations", "market_dividend_results",
    "market_margin_trades", "market_foreign_shareholdings", "market_holding_share_levels",
    "news_articles", "news_chunks", "news_event_analyses", "news_event_impacts", "news_event_topics",
)


def _selected_tables(tables):
    if tables is None:
        return PUBLIC_DATA_TABLES
    if isinstance(tables, str):
        raise ValueError("tables must be a sequence of public table names")
    requested = tuple(tables)
    if not requested or any(name not in PUBLIC_DATA_TABLES for name in requested):
        raise ValueError("Only explicit PUBLIC_DATA_TABLES may be copied")
    if len(set(requested)) != len(requested):
        raise ValueError("Duplicate public table names")
    return tuple(name for name in PUBLIC_DATA_TABLES if name in requested)


def _reflect(connection, names):
    metadata = MetaData()
    missing = set(names) - set(inspect(connection).get_table_names())
    if missing:
        raise ValueError(f"Missing public tables: {', '.join(sorted(missing))}")
    return {name: Table(name, metadata, autoload_with=connection, resolve_fks=False)
            for name in names}


def _source_tables(connection, names):
    needed = set(names)
    if any(name.startswith("news_") for name in names):
        needed.add("news_articles")
    if {"news_event_impacts", "news_event_topics"}.intersection(names):
        needed.add("news_event_analyses")
    return _reflect(connection, [name for name in PUBLIC_DATA_TABLES if name in needed])


def _cnyes_url(column):
    value = func.lower(func.coalesce(column, ""))
    return or_(*(value.startswith(f"{scheme}://{host}/", autoescape=True)
                 for scheme in ("http", "https")
                 for host in ("news.cnyes.com", "www.cnyes.com", "cnyes.com")))


def _article_condition(table, cnyes_only):
    columns = table.c
    # SQL equivalent of contains_simulation for the flat news_articles schema.
    real = not_(or_(
        func.lower(func.coalesce(columns.source, "")) == "simulation_test",
        func.coalesce(columns.url, "").startswith("https://example.invalid/simulation/", autoescape=True),
        columns.article_id.startswith("sim_war_", autoescape=True),
        func.coalesce(columns.title, "").startswith("【模擬測試・非真實新聞】", autoescape=True),
    ))
    if not cnyes_only:
        return real
    return and_(real, or_(func.lower(func.coalesce(columns.source, "")) == "cnyes",
                         _cnyes_url(columns.url)))


def _filtered_statement(name, tables, cnyes_only):
    table = tables[name]
    statement = select(table)
    if not name.startswith("news_"):
        return statement
    articles = tables["news_articles"]
    article_ids = select(articles.c.article_id).where(_article_condition(articles, cnyes_only))
    if name == "news_articles":
        return statement.where(_article_condition(table, cnyes_only))
    if name in {"news_event_impacts", "news_event_topics"}:
        analyses = tables["news_event_analyses"]
        article_ids = select(analyses.c.article_id).where(analyses.c.article_id.in_(article_ids))
    return statement.where(table.c.article_id.in_(article_ids))


def _schema(table):
    columns = []
    for column in sorted(table.columns, key=lambda item: item.name):
        data_type = column.type
        family = data_type._type_affinity.__name__
        # Dialect-specific TEXT variants all hold unbounded text for this copy.
        if isinstance(data_type, sqltypes.Text):
            family = "Text"
        if isinstance(data_type, sqltypes.Enum):
            family = "Enum"
        columns.append({"name": column.name, "type": family,
                        "length": getattr(data_type, "length", None),
                        "precision": getattr(data_type, "precision", None),
                        "scale": getattr(data_type, "scale", None),
                        "unsigned": bool(getattr(data_type, "unsigned", False)),
                        "fsp": getattr(data_type, "fsp", None) or 0,
                        "enum_values": getattr(data_type, "enums", None),
                        "nullable": column.nullable})
    return {"columns": columns, "primary_key": [column.name for column in table.primary_key]}


def _json_value(value):
    if isinstance(value, (datetime, date, time)):
        return {"datetime": value.isoformat()}
    if isinstance(value, Decimal):
        return {"decimal": format(value.normalize(), "f")}
    if isinstance(value, bytes):
        return {"bytes": value.hex()}
    raise TypeError(f"Unsupported public data value: {type(value).__name__}")


def _encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False, default=_json_value).encode("utf-8")


def _batches(connection, table, statement, batch_size):
    keys = list(table.primary_key)
    if not keys:
        raise ValueError(f"Public table lacks a primary key: {table.name}")
    result = connection.execute(statement.order_by(*keys).execution_options(
        stream_results=True, yield_per=batch_size))
    try:
        for batch in result.mappings().partitions(batch_size):
            yield [dict(row) for row in batch]
    finally:
        result.close()


def _digest(connection, table, statement, batch_size, target=None):
    digest = hashlib.sha256()
    count = 0
    for rows in _batches(connection, table, statement, batch_size):
        for row in rows:
            digest.update(_encode(row) + b"\n")
        if target is not None:
            target_connection, target_table = target
            target_connection.execute(target_table.insert(), rows)
        count += len(rows)
    return {"rows": count, "sha256": digest.hexdigest(),
            "schema_sha256": hashlib.sha256(_encode(_schema(table))).hexdigest()}


def public_data_manifest(engine, *, cnyes_only=True, tables=None, batch_size=500):
    """Read filtered row counts and content/schema checksums without mutations."""
    names = _selected_tables(tables)
    if not isinstance(batch_size, int) or batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    with engine.connect() as connection, connection.begin():
        source_tables = _source_tables(connection, names)
        summaries = {name: _digest(connection, source_tables[name],
                     _filtered_statement(name, source_tables, cnyes_only), batch_size) for name in names}
    return {"cnyes_only": cnyes_only, "tables": summaries}


def _same_database(source_engine, target_engine):
    if source_engine is target_engine:
        return True
    source, target = source_engine.url, target_engine.url
    if source.get_backend_name() != target.get_backend_name():
        return False
    if source.get_backend_name() == "sqlite":
        if source.database in {None, "", ":memory:"} or target.database in {None, "", ":memory:"}:
            return False
        return Path(source.database).resolve() == Path(target.database).resolve()
    return (source.host, source.port, source.database) == (target.host, target.port, target.database)


def copy_public_data(source_engine, target_engine, *, cnyes_only=True, tables=None, batch_size=500):
    """Copy an allowlisted subset atomically; existing target rows cause rejection.

    Both schemas must already exist. Other target tables, including users and
    llm_responses, remain untouched. A failed comparison rolls back every insert.
    """
    names = _selected_tables(tables)
    if not isinstance(batch_size, int) or batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    if _same_database(source_engine, target_engine):
        raise ValueError("Source and target must be different databases")
    with source_engine.connect() as source, source.begin(), target_engine.begin() as target:
        source_tables = _source_tables(source, names)
        target_tables = _reflect(target, names)
        for name in names:
            if _schema(source_tables[name]) != _schema(target_tables[name]):
                source_schema, target_schema = _schema(source_tables[name]), _schema(target_tables[name])
                left = {column["name"]: column for column in source_schema["columns"]}
                right = {column["name"]: column for column in target_schema["columns"]}
                changed = sorted(key for key in left.keys() | right.keys() if left.get(key) != right.get(key))
                raise ValueError(f"Public schema mismatch: {name}; columns={','.join(changed)}; "
                                 f"primary_key_changed={source_schema['primary_key'] != target_schema['primary_key']}")
            if target.dialect.name == "mysql":
                options = inspect(target).get_table_options(name)
                if str(options.get("mysql_engine", "")).lower() != "innodb":
                    raise ValueError(f"Target table must use transactional InnoDB: {name}")
            if target.execute(select(target_tables[name]).limit(1)).first() is not None:
                raise ValueError(f"Target public table must be empty: {name}")
        summaries = {}
        for name in names:
            summaries[name] = _digest(source, source_tables[name],
                _filtered_statement(name, source_tables, cnyes_only), batch_size,
                target=(target, target_tables[name]))
            actual = _digest(target, target_tables[name], select(target_tables[name]), batch_size)
            if actual != summaries[name]:
                raise ValueError(f"Public data verification failed: {name}")
    return {"status": "verified", "cnyes_only": cnyes_only, "tables": summaries}
