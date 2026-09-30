from collections import defaultdict
import json

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.features.news import repository
from app.features.news.impact import article_hash, config_hash
from app.features.news.schemas import EventAnalysisResponse, EventImpact, News, NewsEvent
from app.features.news.sentiment import company_catalog, clean_text, analysis_content_window
from app.features.news.versions import source_states, content_digest, canonical_url


def attach_event_analysis(db: Session, articles, stock: str | None = None, *, settings=None):
    if not articles:
        return []
    article_ids = [article.article_id for article in articles if article.article_id]
    catalog = company_catalog()
    industry_names = {row.get("industry"): row.get("industry_name") or row.get("industry")
                      for row in catalog.values() if row.get("industry")}
    impact_hash = config_hash(settings, catalog) if settings is not None else None
    current_articles = {article.article_id: article for article in articles}
    states = source_states(db, articles)
    analyses = {row.article_id: row for row in repository.event_analyses(db, article_ids)} if article_ids else {}
    active = {article_id: row for article_id, row in analyses.items()
              if states[article_id]["eligible"] and row.input_hash == article_hash(current_articles[article_id])
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
        content = clean_text(article.content)
        completeness = dict(content_kind=article.content_kind,
                            content_truncated=analysis_content_window(content) != content)
        event_analysis = EventAnalysisResponse(**completeness)
        if not states[article.article_id]["eligible"]:
            event_analysis.status = "skipped"
        if analysis:
            try:
                events = [NewsEvent.model_validate(item) for item in json.loads(analysis.events_json)] if analysis.status == "success" else []
            except (json.JSONDecodeError, TypeError, ValueError):
                events = []
            event_analysis = EventAnalysisResponse(status=analysis.status, events=events,
                impacts=sorted(impacts_by_article[article.article_id],
                               key=lambda item: {"high": 0, "medium": 1, "low": 2}[item.importance]),
                analyzed_at=analysis.analyzed_at, **completeness)
        responses.append(News.model_validate(article).model_copy(update={"event_analysis": event_analysis,
            "source_state": states[article.article_id],
            "target_industries": sorted({row["industry"] for row in catalog.values()
                if stock and row.get("industry") and (catalog.get(stock) or {}).get("industry")
                and row["industry"].split(":")[-1] == catalog[stock]["industry"].split(":")[-1]})}))
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


def news_detail(db: Session, article_id: str, stock: str | None = None, *, settings=None, revision_id: str | None = None):
    if revision_id:
        revision = repository.article_revision(db, article_id, revision_id)
        if revision is None:
            raise AppError("找不到指定的新聞歷史版本。", status_code=404)
        try:
            values = json.loads(revision.snapshot_json)
            if values.get("article_id") != article_id or content_digest(values) != revision.content_hash:
                raise ValueError("Revision snapshot identity/content mismatch")
            news = News.model_validate(values)
        except (ValueError, TypeError, AttributeError) as exc:
            raise AppError("新聞歷史版本資料無法核對。", status_code=503) from exc
        news.source_state = {"eligible": False, "status": "historical", "revision_id": revision.revision_id,
            "canonical_key": revision.source_key, "canonical_url": canonical_url(news.url),
            "observed_at": revision.observed_at.isoformat() + "Z" if revision.observed_at else None,
            "limitation": "此為保存的歷史原文，不代表目前有效版本；首次發布與完整修訂歷史仍可能未知。"}
        news.event_analysis = EventAnalysisResponse(status="skipped", content_kind=news.content_kind,
                                                    validation_scope="historical_source_only")
        return news
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
