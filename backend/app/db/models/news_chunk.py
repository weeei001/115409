"""Shared chunk schema, separate from the application's ORM metadata."""
from sqlalchemy import Column, DateTime, Index, Integer, MetaData, String, Table, Text, func


# Keep worker-managed tables separate from the application's ORM metadata.
chunk_metadata = MetaData()
news_chunks = Table(
    "news_chunks", chunk_metadata,
    Column("chunk_id", String(80), primary_key=True),
    Column("article_id", String(64), nullable=False),
    Column("stock_id", String(20)),
    Column("stock_ids", Text),
    Column("source", String(50)),
    Column("pub_time", String(40)),
    Column("title", Text),
    Column("url", Text),
    Column("tags", Text),
    Column("content_chunk", Text),
    Column("chunk_index", Integer, nullable=False),
    Column("content_hash", String(64), nullable=False),
    Column("revision", String(64), nullable=False),
    Column("index_fingerprint", String(64), nullable=False),
    Column("index_version", String(80), nullable=False),
    Column("char_start", Integer, nullable=False),
    Column("char_end", Integer, nullable=False),
    Column("token_count", Integer),
    Column("created_at", DateTime, server_default=func.current_timestamp()),
    Index("idx_v1_article_version", "article_id", "index_version"),
    Index("idx_v1_stock_id", "stock_id"),
    Index("idx_v1_pub_time", "pub_time"),
)
