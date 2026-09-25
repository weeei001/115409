from sqlalchemy import Column, DateTime, Index, String, Text, event, func
from sqlalchemy.dialects.mysql import LONGTEXT

from app.db.base import Base


_LONG_TEXT = Text().with_variant(LONGTEXT(), "mysql")


class NewsArticle(Base):

    __tablename__ = "news_articles"

    article_id = Column(String(64), primary_key=True)
    source = Column(String(50), nullable=True, index=True)
    source_group = Column(String(50), nullable=True)
    stock_id = Column(String(20), nullable=True, index=True)
    title = Column(Text, nullable=True)
    pub_time = Column(
        String(40),
        nullable=True,
        index=True,
    )
    url = Column(Text, nullable=True)
    tags = Column(Text, nullable=True)
    content = Column(_LONG_TEXT, nullable=True)
    content_kind = Column(String(20), nullable=False, default="unknown")
    analysis_input_hash = Column(String(64), nullable=True, index=True)
    created_at = Column(
        DateTime,
        nullable=True,
        server_default=func.current_timestamp(),
    )

    __table_args__ = (
        Index("idx_stock_id", "stock_id"),
        Index("idx_pub_time", "pub_time"),
        Index("idx_source", "source"),
    )

    def __repr__(self) -> str:
        return f"<NewsArticle(article_id={self.article_id!r}, stock_id={self.stock_id!r}, title={self.title!r})>"


@event.listens_for(NewsArticle, "before_insert")
@event.listens_for(NewsArticle, "before_update")
def refresh_analysis_hash(mapper, connection, target):
    from app.features.news.impact import article_hash

    target.analysis_input_hash = article_hash(target)
