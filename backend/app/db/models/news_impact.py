"""Current article-level event analysis and searchable impact targets."""
from sqlalchemy import Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, func
from sqlalchemy.dialects.mysql import LONGTEXT

from app.db.base import Base


_LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class NewsEventAnalysis(Base):
    __tablename__ = "news_event_analyses"

    article_id = Column(String(64), ForeignKey("news_articles.article_id"), primary_key=True)
    input_hash = Column(String(64), nullable=False)
    config_hash = Column(String(64), nullable=False)
    status = Column(String(20), nullable=False, index=True)
    events_json = Column(_LONG_TEXT, nullable=False, default="[]")
    error_code = Column(String(120))
    model = Column(String(80))
    prompt_version = Column(String(30))
    input_tokens = Column(Integer)
    output_tokens = Column(Integer)
    estimated_cost_usd = Column(Float)
    analyzed_at = Column(DateTime)
    updated_at = Column(DateTime, server_default=func.current_timestamp(), onupdate=func.current_timestamp())

    __table_args__ = (Index("idx_news_event_revision", "input_hash", "config_hash", "status"),)


class NewsEventImpact(Base):
    __tablename__ = "news_event_impacts"

    article_id = Column(String(64), ForeignKey("news_event_analyses.article_id"), primary_key=True)
    event_key = Column(String(8), primary_key=True)
    target_type = Column(String(20), primary_key=True)
    target_id = Column(String(80), primary_key=True)
    direction = Column(String(20), nullable=False)
    importance = Column(String(20), nullable=False)
    basis = Column(String(20), nullable=False)
    reason = Column(String(200), nullable=False)
    evidence = Column(_LONG_TEXT, nullable=False)
    topics = Column(String(250), nullable=False, default=",")

    __table_args__ = (
        Index("idx_news_event_target", "target_type", "target_id", "importance", "direction"),
        Index("idx_news_event_article", "article_id"),
    )
