from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorProjectionScore,
)


def create_snapshot(db: Session, **fields: Any) -> StockBehaviorAnalysisSnapshot:
    row = StockBehaviorAnalysisSnapshot(**fields)
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    return row


def get_unscored_snapshots(
    db: Session,
    *,
    symbol: str | None = None,
    since: date | None = None,
    limit: int = 200,
) -> list[StockBehaviorAnalysisSnapshot]:
    score_count = (
        select(func.count(StockBehaviorProjectionScore.id))
        .where(StockBehaviorProjectionScore.snapshot_id == StockBehaviorAnalysisSnapshot.id)
        .correlate(StockBehaviorAnalysisSnapshot)
        .scalar_subquery()
    )
    query = db.query(StockBehaviorAnalysisSnapshot).filter(
        StockBehaviorAnalysisSnapshot.is_fallback.is_(False),
        score_count < 8,
    )
    if symbol is not None:
        query = query.filter(StockBehaviorAnalysisSnapshot.symbol == symbol)
    if since is not None:
        query = query.filter(StockBehaviorAnalysisSnapshot.as_of_date >= since)
    return query.order_by(StockBehaviorAnalysisSnapshot.id).limit(limit).all()


def upsert_projection_score(db: Session, **fields: Any) -> StockBehaviorProjectionScore:
    row = (
        db.query(StockBehaviorProjectionScore)
        .filter(
            StockBehaviorProjectionScore.snapshot_id == fields["snapshot_id"],
            StockBehaviorProjectionScore.day == fields["day"],
        )
        .first()
    )
    if row is None:
        row = StockBehaviorProjectionScore(**fields)
        db.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    return row
