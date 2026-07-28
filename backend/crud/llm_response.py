from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session

from models.llm_response import LlmResponse


def create_llm_response(db: Session, **fields: Any) -> LlmResponse:
    row = LlmResponse(**fields)
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    return row


def get_cached_llm_response(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
    kind: str,
    config_hash: str,
) -> LlmResponse | None:
    """同一檔、同一基準日、同一組設定的最近一次成功回覆，供快取重播。"""
    return (
        db.query(LlmResponse)
        .filter(
            LlmResponse.symbol == symbol,
            LlmResponse.as_of_date == as_of_date,
            LlmResponse.kind == kind,
            LlmResponse.config_hash == config_hash,
            LlmResponse.is_fallback.is_(False),
        )
        .order_by(LlmResponse.id.desc())
        .first()
    )
