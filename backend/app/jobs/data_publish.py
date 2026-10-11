"""Read-only preparation of an atomic MySQL public-table promotion.

The caller stops writers, validates a complete rebuilt index, executes the
returned SQL, and checks private-table snapshots. This module never executes
DDL, loads environment settings, or modifies a database.
"""
from __future__ import annotations

import re

from sqlalchemy import MetaData, Table, inspect, select, text

from app.jobs.data_rebuild import PUBLIC_DATA_TABLES, _digest, _filtered_statement, _schema


REQUIRED_VALIDATIONS = (
    "public_data_verified", "full_rebuild_complete", "zero_ltn", "news_index_complete",
)


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_]+", value):
        raise ValueError("Database identifiers must contain only ASCII letters, digits, or underscores")
    return value


def _qualified(database, table):
    return f"`{_identifier(database)}`.`{_identifier(table)}`"


def _rename_sql(pairs):
    return "RENAME TABLE\n  " + ",\n  ".join(
        f"{_qualified(source, table)} TO {_qualified(target, table)}"
        for source, target, table in pairs) + ";"


def _tables(connection, database, names):
    metadata = MetaData()
    return {name: Table(name, metadata, schema=database, autoload_with=connection, resolve_fks=False)
            for name in names}


def _manifest(connection, tables, *, filtered=False, batch_size=500):
    return {name: _digest(connection, table,
                _filtered_statement(name, tables, True) if filtered else select(table), batch_size)
            for name, table in tables.items()}


def private_data_snapshot(engine, database, *, batch_size=500):
    """Return only row counts and hashes for every non-public table, including caches."""
    database = _identifier(database)
    if type(batch_size) is not int or batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    with engine.connect() as connection, connection.begin():
        names = sorted(set(inspect(connection).get_table_names(schema=database)) - set(PUBLIC_DATA_TABLES))
        return _manifest(connection, _tables(connection, database, names), batch_size=batch_size)


def assert_private_data_unchanged(before, after):
    """Reject any private-table addition, removal, row change, or schema change."""
    changed = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
    if changed:
        raise ValueError(f"Private table verification failed: {', '.join(changed)}")


def _check_foreign_keys(connection, inspector, stage, target):
    foreign_keys = connection.execute(text(
        "SELECT TABLE_SCHEMA, TABLE_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_SCHEMA, "
        "REFERENCED_TABLE_NAME FROM information_schema.KEY_COLUMN_USAGE "
        "WHERE REFERENCED_TABLE_NAME IS NOT NULL AND "
        "(TABLE_SCHEMA IN (:stage, :target) OR REFERENCED_TABLE_SCHEMA IN (:stage, :target))"
    ), {"stage": stage, "target": target}).mappings()
    staged_names, private_names = set(), set()
    for key in foreign_keys:
        owner = (key["TABLE_SCHEMA"], key["TABLE_NAME"])
        referred = (key["REFERENCED_TABLE_SCHEMA"], key["REFERENCED_TABLE_NAME"])
        owner_public = owner[0] in {stage, target} and owner[1] in PUBLIC_DATA_TABLES
        referred_public = referred[0] in {stage, target} and referred[1] in PUBLIC_DATA_TABLES
        if owner_public or referred_public:
            if not (owner_public and referred_public and owner[0] == referred[0]):
                raise ValueError(f"Foreign key crosses the public-table boundary: {owner[0]}.{owner[1]}")
        if owner[0] == stage and owner_public:
            staged_names.add(key["CONSTRAINT_NAME"].casefold())
        if owner[0] == target and not owner_public:
            private_names.add(key["CONSTRAINT_NAME"].casefold())
    if staged_names & private_names:
        raise ValueError("Staged foreign key names collide with target private-table constraints")
    for name in PUBLIC_DATA_TABLES:
        signatures = []
        for database in (stage, target):
            signature = []
            for key in inspector.get_foreign_keys(name, schema=database):
                signature.append((tuple(key["constrained_columns"]), key["referred_table"],
                                  tuple(key["referred_columns"]),
                                  tuple(sorted(key.get("options", {}).items()))))
            signatures.append(sorted(signature))
        if signatures[0] != signatures[1]:
            raise ValueError(f"Public foreign key schema mismatch: {name}")


def prepare_publish_plan(engine, *, stage_database, target_database, archive_database,
                         validation_report, batch_size=500):
    """Prepare a 19-table swap and its inverse, without executing either.

    validation_report must explicitly set every REQUIRED_VALIDATIONS item to
    True. It may also supply a ``tables`` manifest from copy_public_data; when
    supplied, it must match the current stage. Assertions about complete market
    history and the new external vector index are supplied by the caller.
    Execute only while writers remain stopped from validation through cutover.
    """
    stage, target, archive = map(_identifier, (stage_database, target_database, archive_database))
    if len({value.casefold() for value in (stage, target, archive)}) != 3:
        raise ValueError("Stage, target, and archive databases must be distinct")
    if not isinstance(validation_report, dict) or any(
            validation_report.get(key) is not True for key in REQUIRED_VALIDATIONS):
        raise ValueError("A complete explicit rebuild, public-data, zero-LTN, and news-index validation report is required")
    if type(batch_size) is not int or batch_size < 1:
        raise ValueError("batch_size must be a positive integer")
    if engine.dialect.name != "mysql":
        raise ValueError("Atomic public-table publication requires MySQL 8 or newer")
    with engine.connect() as connection, connection.begin():
        version = str(connection.execute(text("SELECT VERSION()")).scalar_one())
        match = re.match(r"(\d+)\.", version)
        if not match or int(match[1]) < 8 or "mariadb" in version.lower():
            raise ValueError("Atomic public-table publication requires MySQL 8 or newer")
        inspector = inspect(connection)
        if not {stage, target, archive} <= set(inspector.get_schema_names()):
            raise ValueError("All three databases must already exist")
        if inspector.get_table_names(schema=archive) or inspector.get_view_names(schema=archive):
            raise ValueError("Archive database must be empty")
        for database in (stage, target):
            missing = set(PUBLIC_DATA_TABLES) - set(inspector.get_table_names(schema=database))
            if missing:
                raise ValueError(f"Missing public tables in {database}: {', '.join(sorted(missing))}")
            for name in PUBLIC_DATA_TABLES:
                if str(inspector.get_table_options(name, schema=database).get("mysql_engine", "")).lower() != "innodb":
                    raise ValueError(f"Public table must use InnoDB: {database}.{name}")
        triggers = connection.execute(text(
            "SELECT TRIGGER_SCHEMA, EVENT_OBJECT_TABLE FROM information_schema.TRIGGERS "
            "WHERE TRIGGER_SCHEMA IN (:stage, :target)"
        ), {"stage": stage, "target": target}).mappings()
        if any(row["EVENT_OBJECT_TABLE"] in PUBLIC_DATA_TABLES for row in triggers):
            raise ValueError("Public-table triggers prevent cross-database RENAME TABLE")
        _check_foreign_keys(connection, inspector, stage, target)
        stage_tables, target_tables = (_tables(connection, database, PUBLIC_DATA_TABLES)
                                      for database in (stage, target))
        for name in PUBLIC_DATA_TABLES:
            if _schema(stage_tables[name]) != _schema(target_tables[name]):
                raise ValueError(f"Public schema mismatch: {name}")
        stage_manifest = _manifest(connection, stage_tables, batch_size=batch_size)
        if stage_manifest != _manifest(connection, stage_tables, filtered=True, batch_size=batch_size):
            raise ValueError("Stage contains non-Cnyes, simulated, or orphaned public news records")
        if "tables" in validation_report and validation_report["tables"] != stage_manifest:
            raise ValueError("Stage no longer matches the supplied validation manifest")
        private_names = sorted(set(inspector.get_table_names(schema=target)) - set(PUBLIC_DATA_TABLES))
        private_snapshot = _manifest(connection, _tables(connection, target, private_names), batch_size=batch_size)
    forward = [(target, archive, name) for name in PUBLIC_DATA_TABLES]
    forward.extend((stage, target, name) for name in PUBLIC_DATA_TABLES)
    inverse = [(target, stage, name) for name in PUBLIC_DATA_TABLES]
    inverse.extend((archive, target, name) for name in PUBLIC_DATA_TABLES)
    return {"stage_database": stage, "target_database": target, "archive_database": archive,
            "tables": list(PUBLIC_DATA_TABLES), "stage_manifest": stage_manifest,
            "private_snapshot": private_snapshot, "sql": _rename_sql(forward),
            "rollback_sql": _rename_sql(inverse), "executed": False}
