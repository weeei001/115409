"""Explicit, rerunnable cleanup of retired storage and duplicate JSON payloads.

MySQL DDL commits independently: table retirement precedes transactional JSON
updates. A failed compaction can safely be retried without the retired table.
"""
import argparse
import json
import sys

from sqlalchemy import inspect, text


LEGACY_TABLE = "simulated_orders"


def _compact(normalized, response):
    try:
        normalized = json.loads(normalized)
        response = json.loads(response)
    except (TypeError, ValueError):
        return None
    if not isinstance(normalized, dict) or not isinstance(response, dict):
        return None
    if "payload" not in normalized:
        return None
    payload = normalized["payload"]
    if not (
        ("brief" in response and payload == response["brief"])
        or (response.get("brief") is None and "limitations" in response
            and payload == {"limitations": response["limitations"]})
    ):
        return None
    del normalized["payload"]
    return json.dumps(normalized, ensure_ascii=False, separators=(",", ":"))


def _preflight(connection):
    inspector = inspect(connection)
    tables = inspector.get_table_names()
    legacy = LEGACY_TABLE in tables
    if legacy:
        if connection.scalar(text("SELECT COUNT(*) FROM simulated_orders")):
            raise RuntimeError("Refusing cleanup: simulated_orders contains rows")
        for table in tables:
            if any(fk["referred_table"] == LEGACY_TABLE for fk in inspector.get_foreign_keys(table)):
                raise RuntimeError("Refusing cleanup: simulated_orders has incoming foreign keys")
    return legacy, "llm_responses" in tables


def _candidates(connection):
    # Buffer before updating so MySQL does not interleave an active cursor and DML.
    rows = connection.execute(text(
        "SELECT id, normalized_json, response_json FROM llm_responses"
    )).all()
    for row in rows:
        compacted = _compact(row.normalized_json, row.response_json)
        if compacted is not None:
            yield row, compacted


def cleanup_storage(engine, *, apply=False):
    """Report by default; apply only exact duplicate removal and empty-table retirement."""
    with engine.connect() as connection:
        legacy, responses = _preflight(connection)
        candidates = sum(1 for _ in _candidates(connection)) if responses else 0
    report = {"legacy_table_present": legacy, "compact_candidates": candidates,
              "legacy_table_dropped": False, "compacted_rows": 0, "applied": apply}
    if not apply:
        return report
    if legacy:
        with engine.connect() as connection:
            if engine.dialect.name in {"mysql", "mariadb"}:
                connection.exec_driver_sql("SET SESSION lock_wait_timeout=10")
                connection.exec_driver_sql("LOCK TABLES simulated_orders WRITE")
                try:
                    if connection.scalar(text("SELECT COUNT(*) FROM simulated_orders")):
                        raise RuntimeError("Refusing cleanup: simulated_orders contains rows")
                    connection.exec_driver_sql("DROP TABLE simulated_orders")
                finally:
                    connection.exec_driver_sql("UNLOCK TABLES")
            elif engine.dialect.name == "sqlite":
                connection.exec_driver_sql("BEGIN IMMEDIATE")
                try:
                    _preflight(connection)
                    connection.exec_driver_sql("DROP TABLE simulated_orders")
                    connection.commit()
                except BaseException:
                    connection.rollback()
                    raise
            else:
                raise RuntimeError("Unsupported dialect for safe legacy table retirement")
        report["legacy_table_dropped"] = True
    if responses:
        with engine.begin() as connection:
            binary = "BINARY " if engine.dialect.name in {"mysql", "mariadb"} else ""
            for row, compacted in _candidates(connection):
                result = connection.execute(text(
                    "UPDATE llm_responses SET normalized_json = :compacted "
                    f"WHERE id = :id AND {binary}normalized_json = {binary}:previous "
                    f"AND {binary}response_json = {binary}:response"
                ), {"compacted": compacted, "id": row.id,
                    "previous": row.normalized_json, "response": row.response_json})
                report["compacted_rows"] += result.rowcount
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply cleanup; default is a read-only report")
    args = parser.parse_args(argv)
    # Parse first: --help must never load settings or open a database connection.
    from app.core.config import get_settings
    from app.db.engine import make_engine

    engine = make_engine(get_settings())
    try:
        print(json.dumps(cleanup_storage(engine, apply=args.apply), sort_keys=True))
        return 0
    except Exception as exc:
        print(f"Storage cleanup failed ({type(exc).__name__})", file=sys.stderr)
        return 1
    finally:
        engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
