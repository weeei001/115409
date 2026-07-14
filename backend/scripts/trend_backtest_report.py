from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path
from statistics import fmean


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from crud.analysis_snapshot import get_latest_backtest_run
from database import Base, SessionLocal, engine
from models.trend_prediction import TrendPredictionScore, TrendPredictionSnapshot
from stock_behavior.backtest_stats import wilson_interval


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
    parser = argparse.ArgumentParser(description="Report trend prediction backtest scores.")
    parser.add_argument("--config-hash")
    parser.add_argument("--symbol")
    parser.add_argument("--since", type=date.fromisoformat)
    parser.add_argument("--until", type=date.fromisoformat)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        config_hash = resolve_config_hash(db, args.config_hash)
        query = (
            db.query(TrendPredictionScore, TrendPredictionSnapshot)
            .join(
                TrendPredictionSnapshot,
                TrendPredictionScore.snapshot_id == TrendPredictionSnapshot.id,
            )
            .filter(
                TrendPredictionSnapshot.run_kind == "backtest",
                TrendPredictionSnapshot.config_hash == config_hash,
                TrendPredictionSnapshot.is_fallback.is_(False),
            )
        )
        if args.symbol:
            query = query.filter(TrendPredictionSnapshot.symbol == args.symbol)
        if args.since:
            query = query.filter(TrendPredictionSnapshot.as_of_date >= args.since)
        if args.until:
            query = query.filter(TrendPredictionSnapshot.as_of_date <= args.until)
        rows = query.all()

        scores = [score for score, _snapshot in rows]
        hits = sum(bool(score.direction_hit) for score in scores)
        n = len(scores)
        hit_rate = hits / n if n else None
        low, high = wilson_interval(hits, n)
        up_count = sum(score.direction_actual == "up" for score in scores)
        mean_error = (
            fmean(float(score.abs_change_pct_error) for score in scores)
            if scores
            else None
        )

        print(f"config_hash: {config_hash}")
        print(
            f"n={n} hit_rate={_percent(hit_rate)} "
            f"wilson_95=[{low:.2%}, {high:.2%}] "
            f"always_up={_percent(up_count / n if n else None)} "
            f"mean_abs_change_pct_error={mean_error if mean_error is not None else '-'}"
        )
        print(f"{'confidence':>10} {'n':>6} {'hit_rate':>10}")
        for confidence in range(1, 6):
            confidence_scores = [
                score
                for score, snapshot in rows
                if snapshot.confidence == confidence
            ]
            confidence_hits = sum(bool(score.direction_hit) for score in confidence_scores)
            confidence_n = len(confidence_scores)
            confidence_rate = confidence_hits / confidence_n if confidence_n else None
            print(
                f"{confidence:>10} {confidence_n:>6} "
                f"{_percent(confidence_rate):>10}"
            )

        snapshot_query = db.query(TrendPredictionSnapshot).filter(
            TrendPredictionSnapshot.run_kind == "backtest",
            TrendPredictionSnapshot.config_hash == config_hash,
        )
        if args.symbol:
            snapshot_query = snapshot_query.filter(TrendPredictionSnapshot.symbol == args.symbol)
        if args.since:
            snapshot_query = snapshot_query.filter(TrendPredictionSnapshot.as_of_date >= args.since)
        if args.until:
            snapshot_query = snapshot_query.filter(TrendPredictionSnapshot.as_of_date <= args.until)
        snapshots = snapshot_query.all()
        fallback_count = sum(bool(snapshot.is_fallback) for snapshot in snapshots)
        fallback_rate = fallback_count / len(snapshots) if snapshots else 0.0
        average_news = (
            fmean(snapshot.news_count for snapshot in snapshots)
            if snapshots
            else 0.0
        )
        print(
            f"snapshots={len(snapshots)} fallbacks={fallback_count} "
            f"fallback_rate={fallback_rate:.2%} avg_news_count={average_news:.2f}"
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
