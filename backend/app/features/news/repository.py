from datetime import datetime

from sqlalchemy import case, exists, false, func, or_, select
from sqlalchemy.orm import Session

from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.db.models.news_version import NewsArticleVersion
from .versions import effective_article_condition


# Preserve wall-clock comparison of stored VARCHAR timestamps across both dialects.
# ponytail: expression cannot use the pub_time index; migrate to a datetime column only with a schema change.
_PUB_TIME = func.substr(func.replace(NewsArticle.pub_time, "T", " "), 1, 19)


def by_article_id(db: Session, article_id: str):
    return db.scalar(select(NewsArticle).where(NewsArticle.article_id == article_id))


def article_revision(db: Session, article_id: str, revision_id: str):
    return db.scalar(select(NewsArticleVersion).where(NewsArticleVersion.article_id == article_id,
                                                    NewsArticleVersion.revision_id == revision_id))


def news_list(
    db: Session, *, page: int, page_size: int, article_id: str | None = None,
    keyword: str | None = None, stock: str | None = None, source: str | None = None,
    start_time: datetime | None = None, end_time: datetime | None = None,
    sort_by: str = "pub_time", sort_order: str = "desc", scope: str | None = None,
    industry: str | None = None, topic: str | None = None, direction: str | None = None,
    importance: str | None = None, relation: str | None = None,
    stock_industries: list[str] | None = None, impact_config_hash: str | None = None,
):
    conditions = [effective_article_condition()]
    if article_id:
        conditions.append(NewsArticle.article_id == article_id)
    if keyword:
        conditions.append(or_(NewsArticle.title.like(f"%{keyword}%"), NewsArticle.content.like(f"%{keyword}%")))
    impact_requested = any((scope, industry, topic, direction, importance, relation))
    if stock and not impact_requested:
        tags = func.replace(NewsArticle.tags, " ", "")
        exact_tags = []
        for identifier in (stock, f"{stock}.TW", f"{stock}.TWO"):
            exact_tags.extend((tags == identifier, tags.like(f"{identifier},%"),
                               tags.like(f"%,{identifier},%"), tags.like(f"%,{identifier}")))
        stock_match = or_(NewsArticle.stock_id.in_((stock, f"{stock}.TW", f"{stock}.TWO")), *exact_tags)
        if impact_config_hash:
            stock_match = or_(stock_match, exists(
                select(NewsEventImpact.article_id).select_from(NewsEventImpact)
                .join(NewsEventAnalysis, NewsEventAnalysis.article_id == NewsEventImpact.article_id)
                .where(NewsEventImpact.article_id == NewsArticle.article_id,
                       NewsEventImpact.target_type == "company",
                       NewsEventImpact.target_id == stock,
                       NewsEventAnalysis.status == "success",
                       NewsEventAnalysis.input_hash == NewsArticle.analysis_input_hash,
                       NewsEventAnalysis.config_hash == impact_config_hash)))
        conditions.append(stock_match)
    if source:
        conditions.append(NewsArticle.source == source)
    if start_time:
        conditions.append(_PUB_TIME >= start_time.strftime("%Y-%m-%d %H:%M:%S"))
    if end_time:
        conditions.append(_PUB_TIME <= end_time.strftime("%Y-%m-%d %H:%M:%S"))
    impact_conditions = [
        NewsEventImpact.article_id == NewsArticle.article_id,
        NewsEventAnalysis.article_id == NewsArticle.article_id,
        NewsEventAnalysis.status == "success",
        NewsEventAnalysis.input_hash == NewsArticle.analysis_input_hash,
        NewsEventAnalysis.config_hash == impact_config_hash,
    ]
    if scope:
        impact_conditions.append(NewsEventImpact.target_type == scope)
    if industry:
        impact_conditions.extend((NewsEventImpact.target_type == "industry", NewsEventImpact.target_id == industry))
    if topic:
        impact_conditions.append(NewsEventImpact.topics.like(f"%,{topic},%"))
    if direction:
        impact_conditions.append(NewsEventImpact.direction == direction)
    if importance:
        impact_conditions.append(NewsEventImpact.importance == importance)
    if relation == "direct":
        impact_conditions.extend((NewsEventImpact.target_type == "company",
                                  NewsEventImpact.target_id == stock if stock else false()))
    elif relation == "market_context":
        impact_conditions.extend((NewsEventImpact.target_type == "market", NewsEventImpact.target_id == "TW"))
    elif relation == "industry_context":
        impact_conditions.extend((NewsEventImpact.target_type == "industry",
                                  NewsEventImpact.target_id.in_(stock_industries) if stock_industries else false()))
    elif stock and impact_requested:
        impact_conditions.extend((NewsEventImpact.target_type == "company", NewsEventImpact.target_id == stock))
    if impact_requested:
        conditions.append(exists(select(NewsEventImpact.article_id).select_from(NewsEventImpact)
                                 .join(NewsEventAnalysis, NewsEventAnalysis.article_id == NewsEventImpact.article_id)
                                 .where(*impact_conditions)))
    total = db.scalar(select(func.count()).select_from(NewsArticle).where(*conditions))
    if sort_by == "importance":
        column = (select(func.max(case((NewsEventImpact.importance == "high", 3),
                                       (NewsEventImpact.importance == "medium", 2), else_=1)))
                  .select_from(NewsEventImpact)
                  .join(NewsEventAnalysis, NewsEventAnalysis.article_id == NewsEventImpact.article_id)
                  .where(*impact_conditions).correlate(NewsArticle).scalar_subquery())
    else:
        column = NewsArticle.created_at if sort_by == "created_at" else _PUB_TIME
    order = column.asc() if sort_order == "asc" else column.desc()
    rows = list(db.scalars(select(NewsArticle).where(*conditions).order_by(order, _PUB_TIME.desc(), NewsArticle.article_id)
                          .offset((page - 1) * page_size).limit(page_size)))
    return total, rows


def event_analyses(db: Session, article_ids: list[str]):
    return list(db.scalars(select(NewsEventAnalysis).where(NewsEventAnalysis.article_id.in_(article_ids))))


def event_impacts(db: Session, article_ids: list[str]):
    return list(db.scalars(select(NewsEventImpact).where(NewsEventImpact.article_id.in_(article_ids))))
