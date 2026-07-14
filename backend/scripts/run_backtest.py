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

from config import get_settings
from crud.analysis_snapshot import (
    count_snapshots,
    create_backtest_run,
    finalize_backtest_run,
)
from database import Base, SessionLocal, engine
from models.daily_price import DailyPrice
from schemas.stock_behavior import StockBehaviorAiRequest, StockBehaviorRagRequest
from stock_behavior.backtest_stats import select_weekly_dates
from stock_behavior.llm import StockBehaviorLlmService
from stock_behavior.orchestrator import (
    StockBehaviorOrchestrator,
    build_analysis_config,
    compute_config_hash,
)


DEFAULT_SYMBOLS = "2330,2317,2454,2881,2408,2615"


def parse_symbols(value: str) -> list[str]:
    return list(dict.fromkeys(symbol.strip().upper() for symbol in value.split(",") if symbol.strip()))


def get_grid_dates(
    db: Session,
    *,
    symbol: str,
    date_start: date,
    date_end: date,
) -> list[date]:
    rows = (
        db.query(DailyPrice.date)
        .filter(
            DailyPrice.symbol == symbol,
            DailyPrice.date >= date_start,
            DailyPrice.date <= date_end,
        )
        .order_by(DailyPrice.date)
        .all()
    )
    return [row[0] for row in rows]


def build_backtest_grid(
    db: Session,
    *,
    symbols: list[str],
    date_start: date,
    date_end: date,
    freq: str,
) -> dict[str, list[date]]:
    grid: dict[str, list[date]] = {}
    today = date.today()
    for symbol in symbols:
        dates = get_grid_dates(
            db,
            symbol=symbol,
            date_start=date_start,
            date_end=date_end,
        )
        # as_of 為今日時快照會標為 live，resume 無法辨識；回測網格只取今日之前
        dates = [value for value in dates if value < today]
        grid[symbol] = select_weekly_dates(dates) if freq == "weekly" else dates
    return grid


def plan_backtest_grid(
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


def prepare_backtest(db: Session, settings: Any, args: argparse.Namespace) -> dict[str, Any]:
    symbols = parse_symbols(args.symbols)
    model_name = StockBehaviorLlmService(settings).model_name
    config = build_analysis_config(settings, model_name)
    config_hash = compute_config_hash(config)
    grid = build_backtest_grid(
        db,
        symbols=symbols,
        date_start=args.start,
        date_end=args.end,
        freq=args.freq,
    )
    plan = plan_backtest_grid(
        db,
        grid=grid,
        config_hash=config_hash,
        repeats=args.repeats,
    )
    return {
        "symbols": symbols,
        "config": config,
        "config_hash": config_hash,
        "grid": grid,
        **plan,
    }


def print_plan(prepared: dict[str, Any]) -> None:
    print(f"config_hash: {prepared['config_hash']}")
    for symbol, dates in prepared["grid"].items():
        print(f"{symbol}: grid_points={len(dates)}")
    print(
        f"pending={len(prepared['pending'])} "
        f"skipped={prepared['skipped']}"
    )


async def run_backtest(
    db: Session,
    settings: Any,
    args: argparse.Namespace,
) -> dict[str, Any]:
    prepared = prepare_backtest(db, settings, args)
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
        note=args.note,
    )
    orchestrator = StockBehaviorOrchestrator(db=db, settings=settings)
    completed = 0
    failed = 0
    consecutive_failures = 0
    processed = 0
    status = "completed"

    try:
        for symbol, as_of, attempt in pending:
            if args.max_points and processed >= args.max_points:
                break
            processed += 1
            try:
                rag = await orchestrator.collect_rag_news(
                    StockBehaviorRagRequest(symbols=[symbol], as_of_date=as_of)
                )
                await orchestrator.generate_llm_analysis(
                    StockBehaviorAiRequest(
                        symbol=symbol,
                        as_of_date=as_of,
                        news_sources=[item.model_dump(mode="python") for item in rag.news_sources],
                        fallback_mode=rag.fallback_mode,
                        raw_answer=rag.raw_answer,
                    )
                )
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
    parser = argparse.ArgumentParser(description="Run stock behavior backtests.")
    parser.add_argument("--symbols", default=DEFAULT_SYMBOLS)
    parser.add_argument("--start", required=True, type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat, default=date.today())
    parser.add_argument("--freq", choices=("weekly", "daily"), default="weekly")
    parser.add_argument("--repeats", type=int, default=1)
    parser.add_argument("--sleep-seconds", type=float, default=3.0)
    parser.add_argument("--max-points", type=int, default=0)
    parser.add_argument("--max-failures", type=int, default=5)
    parser.add_argument("--note")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not parse_symbols(args.symbols):
        parser.error("--symbols must contain at least one symbol")
    if args.start > args.end:
        parser.error("--start must be on or before --end")
    if args.repeats < 1 or args.max_failures < 1:
        parser.error("--repeats and --max-failures must be at least 1")
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
