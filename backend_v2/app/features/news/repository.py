from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.db.models.news_article import NewsArticle
from app.db.models.news_sentiment import NewsSentiment


# Preserve wall-clock comparison of stored VARCHAR timestamps across both dialects.
# ponytail: expression cannot use the pub_time index; migrate to a datetime column only with a schema change.
_PUB_TIME = func.substr(func.replace(NewsArticle.pub_time, "T", " "), 1, 19)


def by_article_id(db: Session, article_id: str):
    return db.scalar(select(NewsArticle).where(NewsArticle.article_id == article_id))


def news_list(
    db: Session, *, page: int, page_size: int, article_id: str | None = None,
    keyword: str | None = None, stock: str | None = None, source: str | None = None,
    start_time: datetime | None = None, end_time: datetime | None = None,
    sort_by: str = "pub_time", sort_order: str = "desc",
):
    conditions = []
    if article_id:
        conditions.append(NewsArticle.article_id == article_id)
    if keyword:
        conditions.append(or_(NewsArticle.title.like(f"%{keyword}%"), NewsArticle.content.like(f"%{keyword}%")))
    if stock:
        conditions.append(or_(NewsArticle.stock_id == stock, NewsArticle.tags.like(f"%{stock}%")))
    if source:
        conditions.append(NewsArticle.source == source)
    if start_time:
        conditions.append(_PUB_TIME >= start_time.strftime("%Y-%m-%d %H:%M:%S"))
    if end_time:
        conditions.append(_PUB_TIME <= end_time.strftime("%Y-%m-%d %H:%M:%S"))
    total = db.scalar(select(func.count()).select_from(NewsArticle).where(*conditions))
    column = NewsArticle.created_at if sort_by == "created_at" else _PUB_TIME
    order = column.asc() if sort_order == "asc" else column.desc()
    rows = list(db.scalars(select(NewsArticle).where(*conditions).order_by(order)
                          .offset((page - 1) * page_size).limit(page_size)))
    return total, rows


def sentiments(db: Session, article_ids: list[str], config_hashes: list[str], stock: str | None):
    query = select(NewsSentiment).where(
        NewsSentiment.article_id.in_(article_ids), NewsSentiment.status == "success",
        NewsSentiment.config_hash.in_(config_hashes),
    )
    if stock:
        query = query.where(NewsSentiment.target_stock_id == stock)
    return list(db.scalars(query))
