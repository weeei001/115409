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


def list_llm_responses(
    db: Session,
    *,
    kind: str,
    symbol: str | None = None,
    limit: int = 30,
) -> list[LlmResponse]:
    """最近幾次呼叫，新到舊。含 fallback，因為失敗那幾次才是最需要回頭看的。"""
    query = db.query(LlmResponse).filter(LlmResponse.kind == kind)
    if symbol:
        query = query.filter(LlmResponse.symbol == symbol)
    return query.order_by(LlmResponse.id.desc()).limit(limit).all()


def get_llm_response(db: Session, *, response_id: int, kind: str) -> LlmResponse | None:
    return (
        db.query(LlmResponse)
        .filter(LlmResponse.id == response_id, LlmResponse.kind == kind)
        .first()
    )


def get_cached_llm_response(
    db: Session,
    *,
    symbol: str,
    as_of_date: date | None,
    kind: str,
    config_hash: str,
) -> LlmResponse | None:
    """同一檔、同一組設定的最近一次成功回覆，供快取重播。

    as_of_date=None 代表不限基準日，取該檔最新的一筆（cache_only 查無當日時的退路）。
    """
    query = db.query(LlmResponse).filter(
        LlmResponse.symbol == symbol,
        LlmResponse.kind == kind,
        LlmResponse.config_hash == config_hash,
        LlmResponse.is_fallback.is_(False),
    )
    if as_of_date is not None:
        query = query.filter(LlmResponse.as_of_date == as_of_date)
    return query.order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc()).first()
