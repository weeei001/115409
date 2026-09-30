"""Read analysis inputs and snapshots without committing a transaction."""
from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, time, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.finmind_extra import MonthlyRevenue, StockValuation
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.llm_response import LlmResponse, LLM_RESPONSE_KIND_TEXT_BRIEF
from app.db.models.news_article import NewsArticle
from app.db.models.news_version import NewsArticleVersion, NewsSourceDecision, NewsSourceSelection
from app.db.models.stock_info import StockInfo
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.market.repository import financial_statements, symbol_range
from app.features.news.repository import news_list
from app.features.news.sentiment import company_catalog, extract_candidate_stocks
from app.features.news.versions import source_identity
from app.features.retrieval.common import parse_timestamp
from .schemas import StockBehaviorTextBriefResponse
from app.features.news.eligibility import contains_simulation
from .evidence import (FINANCIAL_LOOKBACK_DAYS, LONG_TERM_LOOKBACK_DAYS,
                       REVENUE_LOOKBACK_DAYS, TIMELINE_TRADING_DAYS,
                       VALUATION_RANK_LOOKBACK_DAYS)


def stock_names(db: Session) -> dict[str, str]:
    return {row.symbol: row.name for row in db.execute(select(StockInfo.symbol, StockInfo.name))}


def collect_rows(db: Session, *, symbol: str, as_of: date) -> dict[str, list[Any]]:
    start = as_of - timedelta(days=LONG_TERM_LOOKBACK_DAYS)
    prices = symbol_range(db, DailyPrice, symbol, start, as_of)
    chip_start = prices[-TIMELINE_TRADING_DAYS].date if len(prices) >= TIMELINE_TRADING_DAYS else start
    return {
        "price_rows": prices,
        "chip_rows": symbol_range(db, InstitutionalTrade, symbol, chip_start, as_of),
        "technical_rows": symbol_range(db, TechnicalIndicator, symbol, start, as_of),
        "income_rows": financial_statements(db, symbol, "income", as_of - timedelta(days=FINANCIAL_LOOKBACK_DAYS), as_of, None),
        "revenue_rows": symbol_range(db, MonthlyRevenue, symbol, as_of - timedelta(days=REVENUE_LOOKBACK_DAYS), as_of),
        "valuation_rows": symbol_range(db, StockValuation, symbol, as_of - timedelta(days=VALUATION_RANK_LOOKBACK_DAYS), as_of),
    }


def trend_inputs(db: Session, *, symbol: str, history_days: int,
                 news_window_days: int, news_limit: int):
    """Load Bob's live-prediction inputs from the backend-owned MySQL tables."""
    latest = db.scalar(select(DailyPrice.date).where(DailyPrice.symbol == symbol)
                       .order_by(DailyPrice.date.desc()).limit(1))
    if latest is None:
        return None
    prices = symbol_range(db, DailyPrice, symbol, latest - timedelta(days=history_days), latest)
    _, articles = news_list(
        db, page=1, page_size=news_limit, stock=symbol,
        start_time=datetime.combine(latest - timedelta(days=news_window_days), time.min),
        end_time=datetime.combine(latest, time.max), sort_by="pub_time", sort_order="desc",
    )
    titles = [article.title.strip() for article in articles if article.title and article.title.strip()]
    return latest, prices, titles


def analysis_digest(db: Session, *, symbol: str, as_of_date: date, period: str):
    row = db.execute(text(
        "SELECT stock_id, as_of_date, period, analyst_json, news_json, "
        "technical_json, digest_json FROM analysis_digests "
        "WHERE stock_id=:symbol AND as_of_date=:as_of_date AND period=:period LIMIT 1"
    ), {"symbol": symbol, "as_of_date": as_of_date, "period": period}).mappings().first()
    if row is None:
        return None

    def load_json(value, default):
        if value is None:
            return default
        parsed = json.loads(value) if isinstance(value, str) else value
        return default if parsed is None else parsed

    return {
        "stock_id": row["stock_id"],
        "as_of_date": row["as_of_date"].isoformat() if hasattr(row["as_of_date"], "isoformat") else str(row["as_of_date"]),
        "period": row["period"],
        "digest": load_json(row["digest_json"], {}),
        "technical": load_json(row["technical_json"], {}),
        "analyst_count": len(load_json(row["analyst_json"], [])),
        "news_count": len(load_json(row["news_json"], [])),
        "generated_by": "prebuilt",
    }


def attach_article_ids(db: Session, sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    unresolved = [source for source in sources if not source.get("article_id")]
    if not unresolved:
        return sources
    urls = {source["url"] for source in unresolved if source.get("url")}
    matches = db.execute(select(NewsArticle.article_id, NewsArticle.url).where(
        NewsArticle.url.in_(urls))).all()
    by_url = {row.url: row.article_id for row in matches}
    return [{**source, "article_id": source.get("article_id") or by_url.get(source.get("url"))}
            for source in sources]


def news_article_ids(value: Any) -> set[str]:
    """Include supporting source_refs as well as the selected representative."""
    if isinstance(value, dict):
        own = {value["article_id"]} if isinstance(value.get("article_id"), str) and value["article_id"] else set()
        return own.union(*(news_article_ids(child) for child in value.values()))
    if isinstance(value, list):
        return set().union(*(news_article_ids(child) for child in value))
    return set()


def input_fingerprint(db: Session, *, symbol: str, as_of: date, rows=None,
                      referenced_article_ids: set[str] | None = None) -> str:
    """Detect same-day additions, corrections and deletions without provider calls."""
    digest = hashlib.sha256()

    def update(value):
        digest.update(json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode("utf-8"))
        digest.update(b"\n")

    for name, items in sorted((rows if rows is not None else collect_rows(db, symbol=symbol, as_of=as_of)).items()):
        update(name)
        for item in items:
            update({column.name: getattr(item, column.name) for column in item.__table__.columns})

    start = as_of - timedelta(days=60)
    # Include a one-day SQL margin for timezone offsets, then check Taiwan dates.
    # ponytail: hash the bounded source content; add stored revisions if reads become a bottleneck.
    columns = [column for column in NewsArticle.__table__.columns if column.name != "created_at"]
    catalog = company_catalog()
    catalog = {**catalog, **{key: {**catalog.get(key, {}), "name": name} for key, name in stock_names(db).items()}}
    referenced_article_ids = referenced_article_ids or set()
    window = (NewsArticle.pub_time >= (start - timedelta(days=1)).isoformat()) & (
        NewsArticle.pub_time < (as_of + timedelta(days=2)).isoformat())
    statement = select(*columns).where(or_(window, NewsArticle.article_id.in_(referenced_article_ids)))
    statement = statement.order_by(NewsArticle.article_id)
    update("news")
    update(sorted(referenced_article_ids))
    source_keys = set()
    with db.execute(statement.execution_options(yield_per=100)).mappings() as articles:
        for article in articles:
            if article["article_id"] in referenced_article_ids:
                update(dict(article))
                source_keys.add(source_identity(dict(article))[0])
                continue
            timestamp = parse_timestamp(article["pub_time"])
            if timestamp is not None and start <= timestamp.date() <= as_of:
                mentioned = extract_candidate_stocks(article["stock_id"], article["tags"],
                    article["title"], article["content"], catalog)
                if article["stock_id"] == "tw_stock" or symbol in mentioned:
                    update(dict(article))
                    source_keys.add(source_identity(dict(article))[0])
    # Source decisions concern the canonical group, including other article IDs
    # outside this stock/date selection. A rollback is a new decision, not reuse
    # of a previously cached interpretation of the same body text.
    update("news_publication_time_eligibility_v1")
    update("news_source_decisions_v1")
    if source_keys:
        for row in db.scalars(select(NewsSourceSelection).where(
                NewsSourceSelection.source_key.in_(source_keys)).order_by(NewsSourceSelection.source_key)):
            update({column.name: getattr(row, column.name) for column in row.__table__.columns})
        for row in db.execute(select(NewsSourceDecision.source_key, func.max(NewsSourceDecision.id)).where(
                NewsSourceDecision.source_key.in_(source_keys)).group_by(NewsSourceDecision.source_key)
                .order_by(NewsSourceDecision.source_key)):
            update(list(row))
        for row in db.execute(select(NewsArticleVersion.source_key, NewsArticleVersion.revision_id,
                NewsArticleVersion.article_id, NewsArticleVersion.observed_at).where(
                NewsArticleVersion.source_key.in_(source_keys)).order_by(
                NewsArticleVersion.source_key, NewsArticleVersion.revision_id)):
            update(list(row))
    return digest.hexdigest()


def saved_brief(row: LlmResponse) -> StockBehaviorTextBriefResponse | None:
    try:
        response = StockBehaviorTextBriefResponse.model_validate_json(row.response_json or "")
    except (ValueError, ValidationError):
        return None
    if (row.is_fallback or response.status not in {"verified", "limited"} or response.brief is None
            or response.symbol != row.symbol or response.as_of_date != row.as_of_date.isoformat()):
        return None
    try:
        config = json.loads(row.config_json or "{}")
        if config.get("purpose") != "production" or contains_simulation(response.model_dump(mode="python")):
            return None
        revision = config.get("revision")
    except (ValueError, AttributeError):
        return None
    response.snapshot_id = row.id
    response.generated_at = row.created_at.isoformat() if row.created_at else None
    response.analysis_revision = str(revision) if revision is not None else None
    response.config_hash = row.config_hash
    try:
        removed = json.loads(row.normalized_json or "{}").get("model_metadata", {}).get("verification", {}).get("removed_item_ids", [])
    except (ValueError, AttributeError):
        removed = []
    if isinstance(removed, list):
        for horizon in ("short_1_5", "swing_6_20", "medium_21_40"):
            view = getattr(response.brief.forward_views, horizon)
            if f"forward_views.{horizon}" in removed and view.stance == "uncertain":
                view.validation_status = "rejected"
    response.cached = True
    return response


def load_latest_saved(db: Session, *, symbol: str, as_of: date) -> StockBehaviorTextBriefResponse | None:
    statement = select(LlmResponse).where(
        LlmResponse.symbol == symbol, LlmResponse.kind == LLM_RESPONSE_KIND_TEXT_BRIEF,
        LlmResponse.is_fallback.is_(False), LlmResponse.as_of_date <= as_of,
    ).order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc())
    with db.scalars(statement) as rows:
        for row in rows:
            response = saved_brief(row)
            if response is not None:
                return response
    return None


def load_cached(db: Session, *, symbol: str, config_hash: str, as_of: date,
                source_fingerprints: dict[date, str] | None = None,
                evidence_fingerprint: str | None = None) -> StockBehaviorTextBriefResponse | None:
    statement = select(LlmResponse).where(
        LlmResponse.symbol == symbol, LlmResponse.kind == LLM_RESPONSE_KIND_TEXT_BRIEF,
        LlmResponse.is_fallback.is_(False),
        LlmResponse.as_of_date == as_of,
    ).order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc())
    statement = statement.where(LlmResponse.config_hash == config_hash)
    fingerprints = source_fingerprints if source_fingerprints is not None else {}
    # Read snapshot rows together and compute current inputs once per candidate date.
    # Use a buffered result: freshness checks issue queries on this same connection.
    with db.scalars(statement) as rows:
        for row in rows:
            response = saved_brief(row)
            if response is None:
                continue
            try:
                config = json.loads(row.config_json or "{}")
            except (ValueError, TypeError):
                continue
            if not isinstance(config, dict) or not config.get("input_fingerprint"):
                continue
            if evidence_fingerprint is not None and config.get("evidence_fingerprint") != evidence_fingerprint:
                continue
            referenced = news_article_ids([item.model_dump(mode="python") for item in response.evidence_catalog
                                          if item.field == "news"])
            key = (row.as_of_date, tuple(sorted(referenced))) if referenced else row.as_of_date
            if key not in fingerprints:
                fingerprints[key] = input_fingerprint(db, symbol=symbol, as_of=row.as_of_date,
                                                       referenced_article_ids=referenced)
            if config["input_fingerprint"] == fingerprints[key]:
                return response
    return None
