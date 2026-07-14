from __future__ import annotations

import json
from datetime import date
from math import prod
from typing import Any

from sqlalchemy.orm import Session

from crud import analysis_snapshot as snapshot_crud
from crud import daily_price as daily_price_crud
from models.analysis_snapshot import StockBehaviorAnalysisSnapshot
from models.daily_price import DailyPrice
from models.finmind_extra import DividendResult


def dividend_adjustment_factor(
    before_price: Any,
    reference_price: Any,
    after_price: Any,
    stock_and_cash_dividend: Any,
) -> float | None:
    if before_price is None or float(before_price) == 0:
        return None
    before = float(before_price)
    if reference_price is not None:
        factor = float(reference_price) / before
    elif stock_and_cash_dividend is not None:
        factor = (before - float(stock_and_cash_dividend)) / before
    elif after_price is not None:
        factor = float(after_price) / before
    else:
        return None
    return factor if factor > 0 else None


def adjusted_return(base_close: Any, actual_close: Any, factors: list[float]) -> float:
    return float(actual_close) / (float(base_close) * prod(factors)) - 1


def classify_direction(ret: float, deadband: float) -> str:
    if ret > deadband:
        return "up"
    if ret < -deadband:
        return "down"
    return "neutral"


def direction_hit(predicted: str, actual: str) -> bool | None:
    if predicted == "uncertain":
        return None
    return predicted == actual


def get_trading_dates_after(
    db: Session,
    symbol: str,
    as_of: date,
    max_days: int = 40,
) -> list[date]:
    rows = (
        db.query(DailyPrice.date)
        .filter(DailyPrice.symbol == symbol, DailyPrice.date > as_of)
        .order_by(DailyPrice.date)
        .limit(max_days)
        .all()
    )
    return [row[0] for row in rows]


def _get_dividend_events(
    db: Session,
    symbol: str,
    start_exclusive: date,
    end_inclusive: date,
) -> list[DividendResult]:
    return (
        db.query(DividendResult)
        .filter(
            DividendResult.symbol == symbol,
            DividendResult.date > start_exclusive,
            DividendResult.date <= end_inclusive,
        )
        .order_by(DividendResult.date)
        .all()
    )


def get_dividend_factors(
    db: Session,
    symbol: str,
    start_exclusive: date,
    end_inclusive: date,
) -> list[float]:
    return _dividend_factors(
        _get_dividend_events(db, symbol, start_exclusive, end_inclusive)
    )


def _dividend_factors(events: list[DividendResult]) -> list[float]:
    factors: list[float] = []
    for event in events:
        factor = dividend_adjustment_factor(
            event.before_price,
            event.reference_price,
            event.after_price,
            event.stock_and_cash_dividend,
        )
        if factor is not None:
            factors.append(factor)
    return factors


def _load_public_projection(snapshot: StockBehaviorAnalysisSnapshot) -> dict[str, Any] | None:
    try:
        value = json.loads(snapshot.public_projection_json or "")
    except (TypeError, json.JSONDecodeError):
        return None
    return value if isinstance(value, dict) else None


def _to_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def score_snapshot(
    db: Session,
    snapshot: StockBehaviorAnalysisSnapshot,
    *,
    deadband: float = 0.01,
) -> int:
    projection = _load_public_projection(snapshot)
    if projection is None or not isinstance(projection.get("points"), list):
        return 0

    base_close = _to_float(projection.get("base_close"))
    if base_close is None:
        base_price = daily_price_crud.get_latest_price_on_or_before(
            db,
            snapshot.symbol,
            snapshot.as_of_date,
        )
        base_close = _to_float(base_price.close) if base_price is not None else None
    if base_close is None:
        return 0

    trading_dates = get_trading_dates_after(db, snapshot.symbol, snapshot.as_of_date)
    scorable_points: list[tuple[dict[str, Any], int, date]] = []
    for point in projection["points"]:
        if not isinstance(point, dict):
            continue
        try:
            day = int(point.get("day"))
        except (TypeError, ValueError):
            continue
        if 5 <= day <= 40 and len(trading_dates) >= day:
            scorable_points.append((point, day, trading_dates[day - 1]))

    dividend_events = (
        _get_dividend_events(
            db,
            snapshot.symbol,
            snapshot.as_of_date,
            max(target_date for _, _, target_date in scorable_points),
        )
        if scorable_points
        else []
    )
    points_written = 0
    for point, day, target_date in scorable_points:
        target_price = daily_price_crud.get_daily_price(db, snapshot.symbol, target_date)
        actual_close = _to_float(target_price.close) if target_price is not None else None
        if actual_close is None:
            continue

        point_dividend_events = [
            event for event in dividend_events if event.date <= target_date
        ]
        factors = _dividend_factors(point_dividend_events)
        actual_return = adjusted_return(base_close, actual_close, factors)
        actual_direction = classify_direction(actual_return, deadband)
        predicted_direction = str(point.get("direction") or "uncertain")
        predicted_close = _to_float(point.get("predicted_close"))
        snapshot_crud.upsert_projection_score(
            db,
            snapshot_id=snapshot.id,
            day=day,
            target_date=target_date,
            predicted_close=predicted_close,
            predicted_direction=predicted_direction,
            base_close=base_close,
            actual_close=actual_close,
            adjusted_return=actual_return,
            direction_actual=actual_direction,
            direction_hit=direction_hit(predicted_direction, actual_direction),
            abs_pct_error=(
                abs(predicted_close - actual_close) / actual_close
                if predicted_close is not None and actual_close != 0
                else None
            ),
            ex_dividend_between=bool(point_dividend_events),
            deadband=deadband,
        )
        points_written += 1

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    return points_written


def score_pending_snapshots(
    db: Session,
    *,
    symbol: str | None = None,
    since: date | None = None,
    deadband: float = 0.01,
    limit: int = 200,
) -> dict[str, int]:
    snapshots = snapshot_crud.get_unscored_snapshots(
        db,
        symbol=symbol,
        since=since,
        limit=limit,
    )
    points_written = sum(
        score_snapshot(db, snapshot, deadband=deadband) for snapshot in snapshots
    )
    return {"snapshots": len(snapshots), "points_written": points_written}
