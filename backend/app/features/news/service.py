from collections import defaultdict
import json

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.features.news import repository
from app.features.news.impact import article_hash, config_hash
from app.features.news.schemas import EventAnalysisResponse, EventImpact, News, NewsEvent
from app.features.news.sentiment import company_catalog


def attach_event_analysis(db: Session, articles, stock: str | None = None, *, settings=None):
    if not articles:
        return []
    article_ids = [article.article_id for article in articles if article.article_id]
    catalog = company_catalog()
    industry_names = {row.get("industry"): row.get("industry_name") or row.get("industry")
                      for row in catalog.values() if row.get("industry")}
    impact_hash = config_hash(settings, catalog) if settings is not None else None
    current_articles = {article.article_id: article for article in articles}
    analyses = {row.article_id: row for row in repository.event_analyses(db, article_ids)} if article_ids else {}
    active = {article_id: row for article_id, row in analyses.items()
              if row.input_hash == article_hash(current_articles[article_id])
              and row.config_hash == impact_hash}
    impact_rows = repository.event_impacts(db, list(active)) if active else []
    impacts_by_article = defaultdict(list)
    for row in impact_rows:
        if active[row.article_id].status != "success":
            continue
        try:
            evidence = json.loads(row.evidence)
        except (json.JSONDecodeError, TypeError):
            evidence = []
        target_name = ("台股" if row.target_type == "market" else
                       _industry_label(row.target_id, industry_names.get(row.target_id)) if row.target_type == "industry" else
                       (catalog.get(row.target_id) or {}).get("name"))
        impacts_by_article[row.article_id].append(EventImpact(
            event_key=row.event_key, target_type=row.target_type, target_id=row.target_id,
            target_name=target_name, direction=row.direction, importance=row.importance,
            basis=row.basis, reason=row.reason, evidence=evidence))
    responses = []
    for article in articles:
        analysis = active.get(article.article_id)
        event_analysis = EventAnalysisResponse()
        if analysis:
            try:
                events = [NewsEvent.model_validate(item) for item in json.loads(analysis.events_json)] if analysis.status == "success" else []
            except (json.JSONDecodeError, TypeError, ValueError):
                events = []
            event_analysis = EventAnalysisResponse(status=analysis.status, events=events,
                impacts=sorted(impacts_by_article[article.article_id],
                               key=lambda item: {"high": 0, "medium": 1, "low": 2}[item.importance]),
                analyzed_at=analysis.analyzed_at)
        responses.append(News.model_validate(article).model_copy(update={"event_analysis": event_analysis}))
    return responses


def news_list(db: Session, *, settings=None, **filters):
    catalog = company_catalog()
    stock_row = catalog.get(filters.get("stock")) or {}
    industry_code = stock_row.get("industry_code") or (stock_row.get("industry") or "").split(":")[-1]
    filters["stock_industries"] = sorted({row["industry"] for row in catalog.values()
        if row.get("industry") and industry_code and
        (row.get("industry_code") or row["industry"].split(":")[-1]) == industry_code})
    filters["impact_config_hash"] = config_hash(settings, catalog) if settings is not None else None
    total, articles = repository.news_list(db, **filters)
    return {"page": filters["page"], "page_size": filters["page_size"], "total": total,
            "items": attach_event_analysis(db, articles, filters.get("stock"), settings=settings)}


def news_detail(db: Session, article_id: str, stock: str | None = None, *, settings=None):
    article = repository.by_article_id(db, article_id)
    if article is None:
        raise AppError("?曆??唳?摰??啗???", status_code=404)
    return attach_event_analysis(db, [article], stock, settings=settings)[0]


def industries():
    catalog = company_catalog()
    labels = {row.get("industry"): row.get("industry_name") or row.get("industry")
              for row in catalog.values() if row.get("industry")}
    return {"items": [{"id": key, "name": _industry_label(key, value)}
                      for key, value in sorted(labels.items())]}


def _industry_label(industry_id: str, name: str | None) -> str:
    market = "上市" if industry_id.startswith("TWSE:") else "上櫃" if industry_id.startswith("TPEx:") else ""
    return f"{market} · {name or industry_id}" if market else name or industry_id
