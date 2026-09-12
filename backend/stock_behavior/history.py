"""Read a saved brief back from llm_responses; never expose raw/blocked model output."""
from __future__ import annotations

import json
from datetime import date

from pydantic import ValidationError
from sqlalchemy.orm import Session

from models.llm_response import LlmResponse, LLM_RESPONSE_KIND_TEXT_BRIEF
from schemas.stock_behavior import StockBehaviorTextBriefResponse


def latest_saved_brief(db: Session, *, symbol: str, as_of_date: date) -> StockBehaviorTextBriefResponse | None:
    rows = db.query(LlmResponse).filter(
        LlmResponse.symbol == symbol,
        LlmResponse.kind == LLM_RESPONSE_KIND_TEXT_BRIEF,
        LlmResponse.as_of_date <= as_of_date,
        LlmResponse.is_fallback.is_(False),
    ).order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc()).yield_per(20)
    for row in rows:
        response = saved_brief(row)
        if response is not None:
            return response
    return None


def saved_brief(row: LlmResponse) -> StockBehaviorTextBriefResponse | None:
    try:
        response = StockBehaviorTextBriefResponse.model_validate_json(row.response_json or "")
    except (ValueError, ValidationError):
        return None
    if response.brief is None or response.symbol != row.symbol or response.as_of_date != row.as_of_date.isoformat():
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

