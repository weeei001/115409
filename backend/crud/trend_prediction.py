from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.trend_prediction import TrendPredictionScore, TrendPredictionSnapshot


def create_snapshot(db: Session, **fields: Any) -> TrendPredictionSnapshot:
    row = TrendPredictionSnapshot(**fields)
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    return row


def count_snapshots(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
    config_hash: str,
    run_kind: str,
) -> int:
    return (
        db.query(TrendPredictionSnapshot)
        .filter(
            TrendPredictionSnapshot.symbol == symbol,
            TrendPredictionSnapshot.as_of_date == as_of_date,
            TrendPredictionSnapshot.config_hash == config_hash,
            TrendPredictionSnapshot.run_kind == run_kind,
        )
        .count()
    )


def get_unscored_snapshots(
    db: Session,
    *,
    symbol: str | None = None,
    since: date | None = None,
    limit: int = 200,
) -> list[TrendPredictionSnapshot]:
    score_count = (
        select(func.count(TrendPredictionScore.id))
        .where(TrendPredictionScore.snapshot_id == TrendPredictionSnapshot.id)
        .correlate(TrendPredictionSnapshot)
        .scalar_subquery()
    )
    query = db.query(TrendPredictionSnapshot).filter(
        TrendPredictionSnapshot.is_fallback.is_(False),
        score_count == 0,
    )
    if symbol is not None:
        query = query.filter(TrendPredictionSnapshot.symbol == symbol)
    if since is not None:
        query = query.filter(TrendPredictionSnapshot.as_of_date >= since)
    return query.order_by(TrendPredictionSnapshot.id).limit(limit).all()


def upsert_score(db: Session, **fields: Any) -> TrendPredictionScore:
    row = (
        db.query(TrendPredictionScore)
        .filter(
            TrendPredictionScore.snapshot_id == fields["snapshot_id"],
            TrendPredictionScore.horizon_days == fields["horizon_days"],
        )
        .first()
    )
    if row is None:
        row = TrendPredictionScore(**fields)
        db.add(row)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
    return row
