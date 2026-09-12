"""Read analysis inputs and snapshots without committing a transaction."""
from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

from pydantic import ValidationError
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.finmind_extra import MonthlyRevenue, StockValuation
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.llm_response import LlmResponse, LLM_RESPONSE_KIND_TEXT_BRIEF
from app.db.models.news_article import NewsArticle
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.market.repository import financial_statements, symbol_range
from app.features.retrieval.common import parse_timestamp
from .schemas import StockBehaviorTextBriefResponse
from .evidence import (FINANCIAL_LOOKBACK_DAYS, LONG_TERM_LOOKBACK_DAYS,
                       REVENUE_LOOKBACK_DAYS, TIMELINE_TRADING_DAYS,
                       VALUATION_RANK_LOOKBACK_DAYS)


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


def input_fingerprint(db: Session, *, symbol: str, as_of: date, rows=None) -> str:
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
    statement = select(*columns).where(
        or_(NewsArticle.stock_id.in_([symbol, "tw_stock"]), NewsArticle.tags.contains(symbol, autoescape=True)),
        NewsArticle.pub_time >= (start - timedelta(days=1)).isoformat(),
        NewsArticle.pub_time < (as_of + timedelta(days=2)).isoformat(),
    ).order_by(NewsArticle.article_id)
    update("news")
    with db.execute(statement.execution_options(yield_per=100)).mappings() as articles:
        for article in articles:
            timestamp = parse_timestamp(article["pub_time"])
            if timestamp is not None and start <= timestamp.date() <= as_of:
                update(dict(article))
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
        revision = json.loads(row.config_json or "{}").get("revision")
    except (ValueError, AttributeError):
        revision = None
    response.snapshot_id = row.id
    response.generated_at = row.created_at.isoformat() if row.created_at else None
    response.analysis_revision = str(revision) if revision is not None else None
    response.config_hash = row.config_hash
    response.cached = True
    return response


def load_cached(db: Session, *, symbol: str, config_hash: str, as_of: date,
                latest: bool = False, source_fingerprints: dict[date, str] | None = None,
                evidence_fingerprint: str | None = None) -> StockBehaviorTextBriefResponse | None:
    statement = select(LlmResponse).where(
        LlmResponse.symbol == symbol, LlmResponse.kind == LLM_RESPONSE_KIND_TEXT_BRIEF,
        LlmResponse.is_fallback.is_(False),
        LlmResponse.as_of_date <= as_of if latest else LlmResponse.as_of_date == as_of,
    ).order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc())
    if not latest:
        statement = statement.where(LlmResponse.config_hash == config_hash)
    fingerprints = source_fingerprints if source_fingerprints is not None else {}
    # Read snapshot rows together and compute current inputs once per candidate date.
    # Use a buffered result: freshness checks issue queries on this same connection.
    with db.scalars(statement) as rows:
        for row in rows:
            response = saved_brief(row)
            if response is None:
                continue
            # Read-only pages display saved snapshots even after inputs or settings change.
            if latest:
                return response
            try:
                config = json.loads(row.config_json or "{}")
            except (ValueError, TypeError):
                continue
            if not isinstance(config, dict) or not config.get("input_fingerprint"):
                continue
            if evidence_fingerprint is not None and config.get("evidence_fingerprint") != evidence_fingerprint:
                continue
            if row.as_of_date not in fingerprints:
                fingerprints[row.as_of_date] = input_fingerprint(db, symbol=symbol, as_of=row.as_of_date)
            if config["input_fingerprint"] == fingerprints[row.as_of_date]:
                return response
    return None
