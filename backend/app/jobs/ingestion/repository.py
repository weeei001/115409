"""Versioned chunk storage; schema creation and transactions belong to callers."""
from datetime import date, timedelta
import json
from types import SimpleNamespace

from sqlalchemy import delete, func, insert, or_, select
from sqlalchemy.orm import Session

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import news_chunks
from app.features.retrieval.chunking import DEFAULT_INDEX_VERSION
from app.features.news.versions import source_states


def _scope(statement, table, symbols: list[str], start: date | None, end: date | None):
    if symbols:
        # Broad SQL prefilter; the worker checks normalized full IDs afterwards.
        clauses = [table.c.stock_id.in_(symbols),
                   *(table.c.tags.contains(symbol, autoescape=True) for symbol in symbols)]
        if "stock_ids" in table.c:
            clauses.extend(table.c.stock_ids.contains(json.dumps(symbol), autoescape=True) for symbol in symbols)
        statement = statement.where(or_(*clauses))
    if start is not None:
        earliest = start - timedelta(days=1) if start > date.min else start
        statement = statement.where(func.substr(table.c.pub_time, 1, 10) >= earliest.isoformat())
    if end is not None:
        latest = end + timedelta(days=1) if end < date.max else end
        statement = statement.where(func.substr(table.c.pub_time, 1, 10) <= latest.isoformat())
    return statement


def pending_articles(db: Session, *, after: str = "", page_size: int = 50,
                     symbols: list[str] = (), start: date | None = None,
                     end: date | None = None, index_version: str = DEFAULT_INDEX_VERSION) -> list[dict]:
    articles = NewsArticle.__table__
    stored_revision = select(news_chunks.c.revision).where(
        news_chunks.c.article_id == articles.c.article_id,
        news_chunks.c.index_version == index_version).limit(1).scalar_subquery()
    statement = _scope(select(articles, stored_revision.label("_stored_revision")).where(
        articles.c.article_id > after), articles, symbols, start, end)
    rows = [dict(row) for row in db.execute(statement.order_by(articles.c.article_id).limit(page_size)).mappings()]
    states = source_states(db, [SimpleNamespace(**row) for row in rows])
    return [{**row, "_source_eligible": states[row["article_id"]]["eligible"]} for row in rows]


def chunk_page(db: Session, *, after: str = "", page_size: int = 50,
               symbols: list[str] = (), start: date | None = None,
               end: date | None = None, index_version: str = DEFAULT_INDEX_VERSION,
               article_ids: list[str] | None = None) -> list[dict]:
    """Page complete articles, so stale vectors are never removed mid-article."""
    selected = _scope(select(news_chunks.c.article_id).where(
        news_chunks.c.article_id > after, news_chunks.c.index_version == index_version),
        news_chunks, symbols, start, end)
    if article_ids is not None:
        selected = selected.where(news_chunks.c.article_id.in_(article_ids))
    selected = selected.distinct().order_by(news_chunks.c.article_id).limit(page_size)
    # MySQL rejects LIMIT inside an IN subquery. Fetch the bounded article IDs
    # first, then load all chunks for that page.
    article_ids = [row[0] for row in db.execute(selected)]
    if not article_ids:
        return []
    statement = select(news_chunks).where(news_chunks.c.article_id.in_(article_ids),
        news_chunks.c.index_version == index_version).order_by(news_chunks.c.article_id, news_chunks.c.chunk_index)
    rows = [dict(row) for row in db.execute(statement).mappings()]
    articles = list(db.scalars(select(NewsArticle).where(NewsArticle.article_id.in_(article_ids))))
    states = source_states(db, articles)
    for row in rows:
        row["stock_ids"] = json.loads(row["stock_ids"] or "[]")
        row["_source_eligible"] = states.get(row["article_id"], {}).get("eligible", False)
    return rows


def insert_article_chunks(db: Session, chunks: list[dict]) -> None:
    if chunks:
        db.execute(delete(news_chunks).where(news_chunks.c.article_id == chunks[0]["article_id"],
            news_chunks.c.index_version == chunks[0]["index_version"]))
        db.execute(insert(news_chunks), [{**chunk, "stock_ids": json.dumps(chunk["stock_ids"])} for chunk in chunks])

