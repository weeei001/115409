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


def get_cached_snapshot(
    db: Session,
    *,
    symbol: str,
    as_of_date: date,
    config_hash: str,
    run_kind: str,
) -> StockBehaviorAnalysisSnapshot | None:
    """同一檔、同一基準日、同一組設定的最近一次成功結果，供文字簡報快取重播。"""
    return (
        db.query(StockBehaviorAnalysisSnapshot)
        .filter(
            StockBehaviorAnalysisSnapshot.symbol == symbol,
            StockBehaviorAnalysisSnapshot.as_of_date == as_of_date,
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
            StockBehaviorAnalysisSnapshot.run_kind == run_kind,
            StockBehaviorAnalysisSnapshot.is_fallback.is_(False),
        )
        .order_by(StockBehaviorAnalysisSnapshot.id.desc())
        .first()
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
        # 只挑真的有情境推演點位的快照。文字簡報（text-first-v2）也寫這個欄位，
        # 但內容是簡報本身、沒有 points；不濾掉的話它們會永遠處於「未評分」狀態，
        # 每次跑 score_snapshots 都被撈出來再算出 0 分。
        StockBehaviorAnalysisSnapshot.public_projection_json.like('%"points"%'),
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
