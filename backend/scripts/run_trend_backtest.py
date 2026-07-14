from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import date, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from backtest.prediction_core_bridge import StrategyConfig
from backtest.trend_backtest import (
    build_trend_config,
    make_openai_client,
    run_trend_point,
)
from config import get_settings
from crud.analysis_snapshot import create_backtest_run, finalize_backtest_run
from crud.trend_prediction import count_snapshots
from database import Base, SessionLocal, engine
from scripts.run_backtest import (
    DEFAULT_SYMBOLS,
    build_backtest_grid,
    parse_symbols,
    print_plan,
)
from stock_behavior.orchestrator import compute_config_hash


DEFAULT_MODEL = StrategyConfig(name="default").model_name


def plan_trend_grid(
    db: Session,
    *,
    grid: dict[str, list[date]],
    config_hash: str,
    repeats: int,
) -> dict[str, Any]:
    pending: list[tuple[str, date, int]] = []
    skipped = 0
    for symbol, dates in grid.items():
        for as_of in dates:
            existing = count_snapshots(
                db,
                symbol=symbol,
                as_of_date=as_of,
                config_hash=config_hash,
                run_kind="backtest",
            )
            if existing >= repeats:
                skipped += 1
                continue
            pending.extend(
                (symbol, as_of, attempt)
                for attempt in range(existing + 1, repeats + 1)
            )
    return {"pending": pending, "skipped": skipped}


def prepare_trend_backtest(db: Session, args: argparse.Namespace) -> dict[str, Any]:
    symbols = parse_symbols(args.symbols)
    strategy = StrategyConfig(
        name=args.strategy_name,
        news_window_days=args.news_window_days,
        news_limit=args.news_limit,
        model_name=args.model,
    )
    config = build_trend_config(
        strategy,
        horizon_days=args.horizon_days,
        price_window_days=30,
    )
    config_hash = compute_config_hash(config)
    grid = build_backtest_grid(
        db,
        symbols=symbols,
        date_start=args.start,
        date_end=args.end,
        freq=args.freq,
    )
    plan = plan_trend_grid(
        db,
        grid=grid,
        config_hash=config_hash,
        repeats=args.repeats,
    )
    return {
        "symbols": symbols,
        "strategy": strategy,
        "config": config,
        "config_hash": config_hash,
        "grid": grid,
        **plan,
    }


async def run_backtest(
    db: Session,
    settings: Any,
    args: argparse.Namespace,
) -> dict[str, Any]:
    prepared = prepare_trend_backtest(db, args)
    print_plan(prepared)
    if args.dry_run:
        return prepared

    pending = prepared["pending"]
    run = create_backtest_run(
        db,
        config_hash=prepared["config_hash"],
        config_json=json.dumps(prepared["config"], ensure_ascii=False, sort_keys=True),
        symbols=",".join(prepared["symbols"]),
        date_start=args.start,
        date_end=args.end,
        freq=args.freq,
        repeats=args.repeats,
        planned_points=len(pending),
        skipped_points=prepared["skipped"],
        note=args.note or "trend",
    )
    completed = 0
    failed = 0
    consecutive_failures = 0
    processed = 0
    status = "completed"

    try:
        openai_client = make_openai_client(settings)
        for symbol, as_of, attempt in pending:
            if args.max_points and processed >= args.max_points:
                break
            processed += 1
            try:
                snapshot = await run_trend_point(
                    db,
                    settings,
                    openai_client,
                    symbol=symbol,
                    as_of=as_of,
                    strategy=prepared["strategy"],
                    horizon_days=args.horizon_days,
                )
                if snapshot is None:
                    raise RuntimeError("price_records 不足")
                completed += 1
                consecutive_failures = 0
                result = "completed"
            except Exception as exc:
                db.rollback()
                failed += 1
                consecutive_failures += 1
                result = f"failed error={exc}"

            print(
                f"symbol={symbol} as_of={as_of.isoformat()} "
                f"attempt={attempt} result={result}"
            )
            await asyncio.sleep(args.sleep_seconds)
            if consecutive_failures >= args.max_failures:
                status = "aborted"
                break
    except BaseException:
        status = "aborted"
        raise
    finally:
        finalize_backtest_run(
            db,
            run.id,
            status=status,
            completed_points=completed,
            skipped_points=prepared["skipped"],
            failed_points=failed,
            finished_at=datetime.now(),
        )

    result = {
        "run_id": run.id,
        "status": status,
        "completed_points": completed,
        "skipped_points": prepared["skipped"],
        "failed_points": failed,
    }
    print(result)
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run trend prediction backtests.")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--freq", choices=("weekly", "daily"), default="weekly")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--sleep-seconds", type=float, default=2.0)
    parser.add_argument("--max-points", type=int, default=0)
    parser.add_argument("--max-failures", type=int, default=5)
    parser.add_argument("--note")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--strategy-name", default="backtest_default")
    parser.add_argument("--news-window-days", type=int, default=30)
    parser.add_argument("--news-limit", type=int, default=20)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--horizon-days", type=int, default=20)
    args = parser.parse_args()
    if not parse_symbols(args.symbols):
        parser.error("--symbols must contain at least one symbol")
    if args.start > args.end:
        parser.error("--start must be on or before --end")
    if min(args.repeats, args.max_failures, args.news_window_days, args.news_limit, args.horizon_days) < 1:
        parser.error("repeat, failure, news, and horizon values must be at least 1")
    if args.sleep_seconds < 0 or args.max_points < 0:
        parser.error("--sleep-seconds and --max-points cannot be negative")
    return args


def main() -> None:
    args = parse_args()
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        asyncio.run(run_backtest(db, get_settings(), args))
    finally:
        db.close()


if __name__ == "__main__":
    main()
