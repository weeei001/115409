from sqlalchemy import Column, DateTime, Float, Index, Integer, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT

from app.db.base import Base

_LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class NewsSentiment(Base):

    __tablename__ = "news_sentiments"

    article_id = Column(
        String(64),
        primary_key=True,
    )
    target_stock_id = Column(
        String(20),
        primary_key=True,
    )
    input_hash = Column(
        String(64),
        nullable=False,
        index=True,
    )
    config_hash = Column(
        String(64),
        nullable=False,
        index=True,
    )
    status = Column(
        String(20),
        nullable=False,
        index=True,
        default="success",
    )
    label = Column(
        String(20),
        nullable=True,
    )
    reason = Column(
        String(255),
        nullable=True,
    )
    evidence = Column(
        _LONG_TEXT,
        nullable=True,
    )
    model = Column(
        String(50),
        nullable=True,
    )
    prompt_version = Column(
        String(20),
        nullable=True,
    )
    input_tokens = Column(
        Integer,
        nullable=True,
    )
    output_tokens = Column(
        Integer,
        nullable=True,
    )
    reasoning_tokens = Column(
        Integer,
        nullable=True,
    )
    estimated_cost_usd = Column(
        Float,
        nullable=True,
    )
    analyzed_at = Column(
        DateTime,
        nullable=True,
    )
    error_code = Column(
        String(255),
        nullable=True,
    )
    created_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
    )
    updated_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
    )

    __table_args__ = (
        Index("idx_sentiment_input_config", "input_hash", "config_hash"),
        Index("idx_sentiment_lookup", "target_stock_id", "status"),
    )

    def __repr__(self) -> str:
        return (
            f"<NewsSentiment(article_id={self.article_id!r}, "
            f"target_stock_id={self.target_stock_id!r}, "
            f"label={self.label!r}, status={self.status!r})>"
        )
