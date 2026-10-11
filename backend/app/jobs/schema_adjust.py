"""Explicit schema cleanup. Stop application writers before running this command.

MySQL DDL commits implicitly; every step checks existing state so an interrupted
run can be retried. Conflicting legacy data is rejected before changing tables.
"""
import argparse
import json

from sqlalchemy import MetaData, Table, func, inspect, select, text


def _columns(connection, name):
    return {column["name"] for column in inspect(connection).get_columns(name)}


def _quote(connection, name):
    return connection.dialect.identifier_preparer.quote(name)


def _preflight(connection):
    tables = set(inspect(connection).get_table_names())
    if "users" not in tables:
        raise ValueError("Initialize the application schema first")
    if {"admin_audit_logs", "audit_logs"} <= tables:
        if connection.scalar(text("SELECT COUNT(*) FROM audit_logs")):
            raise ValueError("Both audit tables contain or may contain history; reconcile them before migrating")
    checks = []
    if "chat_message_feedback" in tables:
        columns = _columns(connection, "chat_message_feedback")
        if "conversation_id" in columns:
            checks.append("SELECT COUNT(*) FROM chat_message_feedback f LEFT JOIN chat_messages m "
                          "ON m.id=f.message_id WHERE m.id IS NULL OR f.conversation_id<>m.conversation_id")
        if "user_id" in columns:
            checks.append("SELECT COUNT(*) FROM chat_message_feedback f LEFT JOIN chat_messages m "
                          "ON m.id=f.message_id LEFT JOIN chat_conversations c ON c.id=m.conversation_id "
                          "WHERE c.id IS NULL OR f.user_id<>c.user_id")
    if "paper_reviews" in tables and "user_id" in _columns(connection, "paper_reviews"):
        checks.append("SELECT COUNT(*) FROM paper_reviews r LEFT JOIN paper_orders o ON o.id=r.order_id "
                      "WHERE o.id IS NULL OR r.user_id<>o.user_id")
    if "market_technical_indicators" in tables and "macd_signal" in _columns(connection, "market_technical_indicators"):
        checks.append("SELECT COUNT(*) FROM market_technical_indicators WHERE macd_dea IS NOT NULL "
                      "AND macd_signal IS NOT NULL AND macd_dea<>macd_signal")
    if any(connection.scalar(text(query)) for query in checks):
        raise ValueError("Legacy ownership or MACD values disagree; resolve conflicts before migrating")
    if "news_event_impacts" in tables and "topics" in _columns(connection, "news_event_impacts"):
        for value in connection.scalars(text("SELECT DISTINCT topics FROM news_event_impacts")):
            if any(len(topic.strip()) > 80 for topic in (value or "").split(",")):
                raise ValueError("A legacy event topic exceeds 80 characters")


def _drop_columns(connection, name, names):
    names = set(names) & _columns(connection, name)
    if not names:
        return []
    inspector = inspect(connection)
    if connection.dialect.name == "sqlite" and name in {"chat_message_feedback", "paper_reviews"}:
        # SQLite cannot drop columns mentioned in table-level foreign keys.
        # Neither of these leaf tables has application tables referencing it.
        from app.db.base import Base
        model = Base.metadata.tables[name]
        if _columns(connection, name) != set(model.c.keys()) | names:
            raise ValueError(f"Unexpected columns in {name}; migrate custom columns separately")
        for table_name in inspector.get_table_names():
            if any(fk["referred_table"] == name for fk in inspector.get_foreign_keys(table_name)):
                raise ValueError(f"Custom foreign key references {name}; migrate it separately")
        temporary = f"_migrate_{name}"
        if temporary in inspector.get_table_names():
            raise ValueError(f"Temporary table {temporary} already exists")
        metadata = MetaData()
        for table in Base.metadata.tables.values():
            table.to_metadata(metadata)
        replacement = model.to_metadata(metadata, name=temporary)
        replacement.indexes.clear()
        replacement.create(connection)
        old = Table(name, MetaData(), autoload_with=connection)
        keys = list(model.c.keys())
        connection.execute(replacement.insert().from_select(keys, select(*(old.c[key] for key in keys))))
        connection.execute(text(f"DROP TABLE {_quote(connection, name)}"))
        connection.execute(text(f"ALTER TABLE {_quote(connection, temporary)} RENAME TO {_quote(connection, name)}"))
        for index in model.indexes:
            index.create(connection)
    else:
        if connection.dialect.name == "mysql":
            for fk in inspector.get_foreign_keys(name):
                if names.intersection(fk["constrained_columns"]):
                    connection.execute(text(f"ALTER TABLE {_quote(connection, name)} "
                                            f"DROP FOREIGN KEY {_quote(connection, fk['name'])}"))
        for index in inspector.get_indexes(name):
            if names.intersection(index["column_names"]):
                suffix = f" ON {_quote(connection, name)}" if connection.dialect.name == "mysql" else ""
                connection.execute(text(f"DROP INDEX {_quote(connection, index['name'])}{suffix}"))
        for column in sorted(names):
            connection.execute(text(f"ALTER TABLE {_quote(connection, name)} DROP COLUMN {_quote(connection, column)}"))
    return [f"{name}.{column}" for column in sorted(names)]


def migrate_event_topics(connection):
    """Preserve legacy topic membership before removing the repeated CSV field."""
    from app.db.models.news_impact import NewsEventTopic
    NewsEventTopic.__table__.create(connection, checkfirst=True)
    if "topics" not in _columns(connection, "news_event_impacts"):
        return 0
    if connection.dialect.name == "mysql":
        from sqlalchemy.dialects.mysql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    rows = connection.execute(text("SELECT DISTINCT article_id, event_key, topics FROM news_event_impacts")).all()
    before = connection.scalar(select(func.count()).select_from(NewsEventTopic))
    for article_id, event_key, topics in rows:
        values = [{"article_id": article_id, "event_key": event_key, "topic": topic}
                  for topic in sorted({value.strip() for value in (topics or "").split(",") if value.strip()})]
        if not values:
            continue
        if any(len(value["topic"]) > 80 for value in values):
            raise ValueError("A legacy event topic exceeds 80 characters")
        statement = insert(NewsEventTopic).values(values)
        if connection.dialect.name == "mysql":
            statement = statement.on_duplicate_key_update(topic=statement.inserted.topic)
        else:
            statement = statement.on_conflict_do_nothing()
        connection.execute(statement)
    after = connection.scalar(select(func.count()).select_from(NewsEventTopic))
    _drop_columns(connection, "news_event_impacts", ["topics"])
    return after - before


def migrate_schema(engine):
    import app.db.models  # Register metadata without opening external resources.
    from app.db.models.audit import AuditLog
    if engine.dialect.name not in {"mysql", "sqlite"}:
        raise ValueError("Schema migration requires MySQL or SQLite")
    report = {"audit_renamed": False, "topics_added": 0, "columns_removed": [], "indexes_removed": []}
    with engine.begin() as connection:
        _preflight(connection)
        tables = set(inspect(connection).get_table_names())
        if "admin_audit_logs" in tables:
            if "audit_logs" in tables:
                AuditLog.__table__.drop(connection)  # Preflight confirmed this table is empty.
            connection.execute(text("ALTER TABLE admin_audit_logs RENAME TO audit_logs"))
            report["audit_renamed"] = True
        else:
            AuditLog.__table__.create(connection, checkfirst=True)
        if "news_event_impacts" in tables:
            legacy_topics = "topics" in _columns(connection, "news_event_impacts")
            report["topics_added"] = migrate_event_topics(connection)
            if legacy_topics:
                report["columns_removed"].append("news_event_impacts.topics")
        for name, columns in (("chat_message_feedback", ["conversation_id", "user_id"]),
                              ("paper_reviews", ["user_id"])):
            if name in tables:
                report["columns_removed"].extend(_drop_columns(connection, name, columns))
        name = "market_technical_indicators"
        if name in tables and "macd_signal" in _columns(connection, name):
            connection.execute(text("UPDATE market_technical_indicators SET macd_dea=macd_signal "
                                    "WHERE macd_dea IS NULL AND macd_signal IS NOT NULL"))
            report["columns_removed"].extend(_drop_columns(connection, name, ["macd_signal"]))
        if "news_articles" in tables:
            indexes = inspect(connection).get_indexes("news_articles")
            for name in ("idx_stock_id", "idx_pub_time", "idx_source"):
                old = next((index for index in indexes if index["name"] == name), None)
                if old and not old["unique"] and any(index["name"] != name and not index["unique"]
                        and index["column_names"] == old["column_names"] for index in indexes):
                    suffix = " ON news_articles" if connection.dialect.name == "mysql" else ""
                    connection.execute(text(f"DROP INDEX {_quote(connection, name)}{suffix}"))
                    report["indexes_removed"].append(name)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=(
        "Migrate shared audit logs, event topics and redundant columns. Stop application writers first. "
        "MySQL DDL is not transactional; this command can be rerun after interruption."
    ))
    parser.parse_args(argv)
    from app.core.config import get_settings
    from app.db.engine import make_engine
    engine = make_engine(get_settings())
    try:
        print(json.dumps(migrate_schema(engine), sort_keys=True))
    finally:
        engine.dispose()
    return 0
