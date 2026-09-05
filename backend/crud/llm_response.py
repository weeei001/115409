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
    as_of_date: date | None,
    kind: str,
    config_hash: str,
    max_as_of_date: date | None = None,
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
    if max_as_of_date is not None:
        query = query.filter(LlmResponse.as_of_date <= max_as_of_date)
    return query.order_by(LlmResponse.as_of_date.desc(), LlmResponse.id.desc()).first()
