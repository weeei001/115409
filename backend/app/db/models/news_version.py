"""Observed source versions and explicit, reversible effective-source decisions."""
from sqlalchemy import Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.mysql import LONGTEXT, DATETIME

from app.db.base import Base

_TIMESTAMP = DateTime().with_variant(DATETIME(fsp=6), "mysql")


class NewsArticleVersion(Base):
    __tablename__ = "news_article_versions"
    revision_id = Column(String(64), primary_key=True)
    article_id = Column(String(64), nullable=False, index=True)
    source_key = Column(String(64), nullable=False, index=True)
    content_hash = Column(String(64), nullable=False)
    snapshot_json = Column(Text().with_variant(LONGTEXT(), "mysql"), nullable=False)
    observed_at = Column(_TIMESTAMP, nullable=True)
    recorded_at = Column(_TIMESTAMP, nullable=False)


class NewsSourceSelection(Base):
    __tablename__ = "news_source_selections"
    source_key = Column(String(64), primary_key=True)
    canonical_url = Column(Text, nullable=False)
    selected_article_id = Column(String(64), nullable=True, index=True)
    status = Column(String(20), nullable=False)
    reason = Column(Text, nullable=False)
    observed_at = Column(_TIMESTAMP, nullable=False)


class NewsSourceDecision(Base):
    __tablename__ = "news_source_decisions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    source_key = Column(String(64), nullable=False, index=True)
    before_json = Column(Text, nullable=False)
    after_json = Column(Text, nullable=False)
    reason = Column(Text, nullable=False)
    observed_at = Column(_TIMESTAMP, nullable=False)
