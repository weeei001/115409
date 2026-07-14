from __future__ import annotations

import argparse
import json
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import fmean
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from crud.analysis_snapshot import get_latest_backtest_run
from database import Base, SessionLocal, engine
from models.analysis_snapshot import StockBehaviorAnalysisSnapshot
from schemas.stock_behavior import SCENARIO_PROJECTION_DAYS
from stock_behavior.backtest_stats import (
    coefficient_of_variation,
    direction_modal_share,
)


def resolve_config_hash(db, config_hash: str | None) -> str:
    if config_hash:
        return config_hash
    latest = get_latest_backtest_run(db)
    if latest is None:
        raise SystemExit("No backtest run found; pass --config-hash.")
    return latest.config_hash


def load_projection_points(value: str | None) -> list[dict[str, Any]]:
    try:
        projection = json.loads(value or "")
    except (TypeError, json.JSONDecodeError):
        return []
    points = projection.get("points") if isinstance(projection, dict) else None
    return [point for point in points if isinstance(point, dict)] if isinstance(points, list) else []


def build_variance_rows(snapshots, min_repeats: int) -> tuple[list[dict[str, Any]], float]:
    grouped = defaultdict(list)
    for snapshot in snapshots:
        grouped[(snapshot.symbol, snapshot.as_of_date)].append(snapshot)

    modal_by_day = defaultdict(list)
    cv_by_day = defaultdict(list)
    for group in grouped.values():
        if len(group) < min_repeats:
            continue
        directions = defaultdict(list)
        prices = defaultdict(list)
        seen_days = set()
        for snapshot in group:
            for point in load_projection_points(snapshot.public_projection_json):
                try:
                    day = int(point.get("day"))
                except (TypeError, ValueError):
                    continue
                seen_days.add(day)
                direction = point.get("direction")
                if isinstance(direction, str):
                    directions[day].append(direction)
                predicted_close = point.get("predicted_close")
                if predicted_close is not None:
                    try:
                        prices[day].append(float(predicted_close))
                    except (TypeError, ValueError):
                        pass
        for day in seen_days:
            modal_by_day[day].append(direction_modal_share(directions[day]))
            cv_by_day[day].append(coefficient_of_variation(prices[day]))

    rows = []
    all_modal_shares = []
    for day in SCENARIO_PROJECTION_DAYS:
        modal_values = modal_by_day[day]
        cv_values = cv_by_day[day]
        all_modal_shares.extend(modal_values)
        rows.append(
            {
                "day": day,
                "modal_share": fmean(modal_values) if modal_values else 0.0,
                "cv": fmean(cv_values) if cv_values else 0.0,
                "groups": len(modal_values),
            }
        )
    return rows, fmean(all_modal_shares) if all_modal_shares else 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report repeated-backtest variance.")
    parser.add_argument("--config-hash")
    parser.add_argument("--symbol")
    parser.add_argument("--since", type=date.fromisoformat)
    parser.add_argument("--min-repeats", type=int, default=2)
    args = parser.parse_args()
    if args.min_repeats < 1:
        parser.error("--min-repeats must be at least 1")
    return args


def main() -> None:
    args = parse_args()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        config_hash = resolve_config_hash(db, args.config_hash)
        query = db.query(StockBehaviorAnalysisSnapshot).filter(
            StockBehaviorAnalysisSnapshot.run_kind == "backtest",
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
            StockBehaviorAnalysisSnapshot.is_fallback.is_(False),
        )
        if args.symbol:
            query = query.filter(StockBehaviorAnalysisSnapshot.symbol == args.symbol)
        if args.since:
            query = query.filter(StockBehaviorAnalysisSnapshot.as_of_date >= args.since)
        rows, overall = build_variance_rows(query.all(), args.min_repeats)

        print(f"config_hash: {config_hash}")
        print(f"{'day':>4} {'modal_share':>12} {'price_cv':>12} {'groups':>8}")
        for row in rows:
            print(
                f"{row['day']:>4} {row['modal_share']:>12.4f} "
                f"{row['cv']:>12.4f} {row['groups']:>8}"
            )
        print(f"overall modal share: {overall:.4f}")
        print("一致率 < 0.8 時建議先降 temperature 再調參")
    finally:
        db.close()


if __name__ == "__main__":
    main()
