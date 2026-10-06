"""Idempotent schema upgrade for article-level event impacts."""
from sqlalchemy import inspect, select, text

from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.news.impact import article_source_hash


def migrate_news_impact(engine) -> dict[str, int]:
    inspector = inspect(engine)
    if "news_articles" not in inspector.get_table_names():
        raise RuntimeError("news_articles table does not exist")
    columns = {row["name"] for row in inspector.get_columns("news_articles")}
    added = 0
    with engine.begin() as connection:
        if "content_kind" not in columns:
            connection.execute(text("ALTER TABLE news_articles ADD COLUMN content_kind VARCHAR(20) NOT NULL DEFAULT 'unknown'"))
            added += 1
        if "analysis_input_hash" not in columns:
            connection.execute(text("ALTER TABLE news_articles ADD COLUMN analysis_input_hash VARCHAR(64) NULL"))
            added += 1
        indexes = {row["name"] for row in inspect(connection).get_indexes("news_articles")}
        if "ix_news_articles_analysis_input_hash" not in indexes:
            connection.execute(text("CREATE INDEX ix_news_articles_analysis_input_hash ON news_articles (analysis_input_hash)"))
    NewsEventAnalysis.__table__.create(engine, checkfirst=True)
    NewsEventImpact.__table__.create(engine, checkfirst=True)
    updated = 0
    with engine.begin() as connection:
        rows = connection.execute(select(NewsArticle.article_id, NewsArticle.title, NewsArticle.content,
                                        NewsArticle.pub_time, NewsArticle.content_kind,
                                        NewsArticle.analysis_input_hash)
                                  .where(NewsArticle.analysis_input_hash.is_(None)))
        for row in rows:
            current = article_source_hash(row.title, row.content, row.pub_time, row.content_kind)
            if row.analysis_input_hash != current:
                connection.execute(text("UPDATE news_articles SET analysis_input_hash = :digest WHERE article_id = :article_id"),
                                   {"digest": current, "article_id": row.article_id})
                updated += 1
    return {"columns_added": added, "hashes_updated": updated}
