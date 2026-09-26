"""Load stored articles and chunk revisions without owning transactions."""
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import news_chunks
from app.features.news.repository import event_analyses


def articles_for_hits(db: Session, hits: list[dict]) -> list[NewsArticle]:
    article_ids = [str((hit.get("payload") or {}).get("article_id") or "") for hit in hits]
    urls = [str((hit.get("payload") or {}).get("url") or "") for hit in hits]
    clauses = []
    if any(article_ids):
        clauses.append(NewsArticle.article_id.in_([value for value in article_ids if value]))
    if any(urls):
        clauses.append(NewsArticle.url.in_([value for value in urls if value]))
    if not clauses:
        return []
    rows = list(db.scalars(select(NewsArticle).where(or_(*clauses))))
    by_id = {article.article_id: article for article in rows}
    by_url = {article.url: article for article in rows if article.url}
    articles, seen_articles = [], set()
    for hit in hits:
        payload = hit.get("payload") or {}
        article = by_id.get(payload.get("article_id")) or by_url.get(payload.get("url"))
        if article is not None and article.article_id not in seen_articles:
            seen_articles.add(article.article_id)
            articles.append(article)
    return articles


def versioned_sources(db: Session, chunk_ids: set[str], *, include_analyses: bool):
    chunks = {row["chunk_id"]: dict(row) for row in db.execute(select(news_chunks).where(
        news_chunks.c.chunk_id.in_(chunk_ids))).mappings()}
    article_ids = {chunk["article_id"] for chunk in chunks.values()}
    articles = {item.article_id: item for item in db.scalars(select(NewsArticle).where(
        NewsArticle.article_id.in_(article_ids)))}
    analyses = {item.article_id: item for item in event_analyses(db, list(article_ids))} if include_analyses else {}
    return chunks, articles, analyses
