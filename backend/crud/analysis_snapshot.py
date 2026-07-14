from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorBacktestRun,
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


def create_backtest_run(db: Session, **fields: Any) -> StockBehaviorBacktestRun:
    row = StockBehaviorBacktestRun(**fields)
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    return row


def finalize_backtest_run(
    db: Session,
    run_id: int,
    *,
    status: str,
    completed_points: int,
    skipped_points: int,
    failed_points: int,
    finished_at: datetime,
) -> StockBehaviorBacktestRun | None:
    row = db.query(StockBehaviorBacktestRun).filter(StockBehaviorBacktestRun.id == run_id).first()
    if row is None:
        return None
    row.status = status
    row.completed_points = completed_points
    row.skipped_points = skipped_points
    row.failed_points = failed_points
    row.finished_at = finished_at
    try:
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
        db.query(StockBehaviorAnalysisSnapshot)
        .filter(
            StockBehaviorAnalysisSnapshot.symbol == symbol,
            StockBehaviorAnalysisSnapshot.as_of_date == as_of_date,
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
            StockBehaviorAnalysisSnapshot.run_kind == run_kind,
        )
        .count()
    )


def get_latest_backtest_run(db: Session) -> StockBehaviorBacktestRun | None:
    return db.query(StockBehaviorBacktestRun).order_by(StockBehaviorBacktestRun.id.desc()).first()


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
