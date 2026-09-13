"""Small, repeatable schema migration for the versioned news chunk table."""
from sqlalchemy import inspect, text


_COLUMNS = {
    "stock_ids": "TEXT NULL",
    "chunk_index": "INT NULL",
    "content_hash": "VARCHAR(64) NULL",
    "revision": "VARCHAR(64) NULL",
    "index_fingerprint": "VARCHAR(64) NULL",
    "index_version": "VARCHAR(80) NULL",
    "char_start": "INT NULL",
    "char_end": "INT NULL",
    "token_count": "INT NULL",
}
_INDEXES = {
    "idx_v2_article_version": "(`article_id`, `index_version`)",
    "idx_v2_stock_id": "(`stock_id`)",
    "idx_v2_pub_time": "(`pub_time`)",
}


def migrate_news_chunks(engine) -> dict[str, int]:
    inspector = inspect(engine)
    if "news_chunks" not in inspector.get_table_names():
        raise RuntimeError("news_chunks table does not exist")
    existing_columns = {column["name"] for column in inspector.get_columns("news_chunks")}
    added = 0
    with engine.begin() as connection:
        for name, definition in _COLUMNS.items():
            if name not in existing_columns:
                connection.execute(text(f"ALTER TABLE `news_chunks` ADD COLUMN `{name}` {definition}"))
                added += 1
        connection.execute(text("""
            UPDATE news_chunks
            SET stock_ids = COALESCE(stock_ids, '[]'),
                chunk_index = COALESCE(chunk_index, CAST(SUBSTRING_INDEX(chunk_id, '_', -1) AS UNSIGNED)),
                content_hash = COALESCE(content_hash, SHA2(COALESCE(content_chunk, ''), 256)),
                revision = COALESCE(revision, 'legacy'),
                index_fingerprint = COALESCE(index_fingerprint, 'legacy'),
                index_version = COALESCE(index_version, 'legacy'),
                char_start = COALESCE(char_start, 0),
                char_end = COALESCE(char_end, CHAR_LENGTH(COALESCE(content_chunk, '')))
        """))
        existing_indexes = {index["name"] for index in inspect(connection).get_indexes("news_chunks")}
        for name, columns in _INDEXES.items():
            if name not in existing_indexes:
                connection.execute(text(f"CREATE INDEX `{name}` ON `news_chunks` {columns}"))
    return {"columns_added": added}
