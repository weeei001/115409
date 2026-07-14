from __future__ import annotations

import argparse
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from statistics import fmean


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from crud.analysis_snapshot import get_latest_backtest_run
from database import Base, SessionLocal, engine
from models.analysis_snapshot import (
    StockBehaviorAnalysisSnapshot,
    StockBehaviorProjectionScore,
)
from schemas.stock_behavior import SCENARIO_PROJECTION_DAYS
from stock_behavior.backtest_stats import mean_abs_pct_error, skill_score, wilson_interval


def resolve_config_hash(db, config_hash: str | None) -> str:
    if config_hash:
        return config_hash
    latest = get_latest_backtest_run(db)
    if latest is None:
        raise SystemExit("No backtest run found; pass --config-hash.")
    return latest.config_hash


def _percent(value: float | None) -> str:
    return "-" if value is None else f"{value:.2%}"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Report stock behavior backtest scores.")
    parser.add_argument("--config-hash")
    parser.add_argument("--symbol")
    parser.add_argument("--since", type=date.fromisoformat)
    parser.add_argument("--until", type=date.fromisoformat)
    parser.add_argument("--exclude-ex-dividend", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        config_hash = resolve_config_hash(db, args.config_hash)
        query = (
            db.query(StockBehaviorProjectionScore, StockBehaviorAnalysisSnapshot)
            .join(
                StockBehaviorAnalysisSnapshot,
                StockBehaviorProjectionScore.snapshot_id == StockBehaviorAnalysisSnapshot.id,
            )
            .filter(
                StockBehaviorAnalysisSnapshot.run_kind == "backtest",
                StockBehaviorAnalysisSnapshot.config_hash == config_hash,
                StockBehaviorAnalysisSnapshot.is_fallback.is_(False),
            )
        )
        if args.symbol:
            query = query.filter(StockBehaviorAnalysisSnapshot.symbol == args.symbol)
        if args.since:
            query = query.filter(StockBehaviorAnalysisSnapshot.as_of_date >= args.since)
        if args.until:
            query = query.filter(StockBehaviorAnalysisSnapshot.as_of_date <= args.until)
        grouped = {day: [] for day in SCENARIO_PROJECTION_DAYS}
        for score, snapshot in query.all():
            if score.day in grouped:
                grouped[score.day].append(score)

        print(f"config_hash: {config_hash}")
        print(
            f"{'day':>4} {'n':>6} {'hit':>8} {'95% CI':>17} "
            f"{'up/base':>8} {'down':>8} {'neutral':>8} "
            f"{'model MAPE':>12} {'RW MAPE':>10} {'skill':>9}"
        )
        for day, scores in grouped.items():
            scorable = [score for score in scores if score.direction_hit is not None]
            hits = sum(bool(score.direction_hit) for score in scorable)
            hit_rate = hits / len(scorable) if scorable else None
            low, high = wilson_interval(hits, len(scorable))
            directions = Counter(score.direction_actual for score in scores)
            n = len(scores)
            mape_scores = [
                score
                for score in scores
                if score.abs_pct_error is not None
                and (not args.exclude_ex_dividend or not score.ex_dividend_between)
            ]
            model_mape = (
                fmean(float(score.abs_pct_error) for score in mape_scores)
                if mape_scores
                else None
            )
            rw_mape = mean_abs_pct_error(
                [
                    (float(score.base_close), float(score.actual_close))
                    for score in scores
                    if score.base_close is not None
                    and score.actual_close is not None
                    and (not args.exclude_ex_dividend or not score.ex_dividend_between)
                ]
            )
            print(
                f"{day:>4} {n:>6} {_percent(hit_rate):>8} "
                f"{f'[{low:.2%}, {high:.2%}]':>17} "
                f"{_percent(directions['up'] / n if n else 0.0):>8} "
                f"{_percent(directions['down'] / n if n else 0.0):>8} "
                f"{_percent(directions['neutral'] / n if n else 0.0):>8} "
                f"{_percent(model_mape):>12} {_percent(rw_mape):>10} "
                f"{_percent(skill_score(model_mape, rw_mape)):>9}"
            )

        snapshot_query = db.query(StockBehaviorAnalysisSnapshot).filter(
            StockBehaviorAnalysisSnapshot.run_kind == "backtest",
            StockBehaviorAnalysisSnapshot.config_hash == config_hash,
        )
        if args.symbol:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.symbol == args.symbol)
        if args.since:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.as_of_date >= args.since)
        if args.until:
            snapshot_query = snapshot_query.filter(StockBehaviorAnalysisSnapshot.as_of_date <= args.until)
        snapshots = snapshot_query.all()
        fallback_count = sum(bool(snapshot.is_fallback) for snapshot in snapshots)
        fallback_rate = fallback_count / len(snapshots) if snapshots else 0.0
        print(
            f"snapshots={len(snapshots)} fallbacks={fallback_count} "
            f"fallback_rate={fallback_rate:.2%}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
