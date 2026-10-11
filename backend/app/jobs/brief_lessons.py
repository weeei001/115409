"""Settle due text-brief calls into reviews, and compare briefs written with and without them."""
import argparse
import asyncio
from datetime import date, datetime, timedelta
import json
import logging

from sqlalchemy.exc import IntegrityError

from app.core.errors import AppError
from app.db.models.brief_lesson import BRIEF_LESSON_READY, BriefLesson
from app.features.analysis import repository, track_record as tr
from app.features.analysis.lessons import lesson_scope, select_settlements, write_review
from app.features.retrieval.common import TAIPEI

LOOKBACK_DAYS = 180


def _snapshots(db, symbols: set[str] | None, since: date) -> list[dict]:
    snapshots = tr._latest_live(repository.track_record_snapshots(db, symbol=None, since=since))
    return [item for item in snapshots if symbols is None or item["symbol"] in symbols]


def _evaluate(db, snapshots: list[dict], since: date):
    start = since - timedelta(days=tr.MAX_BASE_GAP_DAYS)
    series = repository.close_series(db, {item["symbol"] for item in snapshots}, start)
    items, _ = tr.evaluate(snapshots, series, repository.benchmark_series(db, start))
    return items


def _load_due(session_factory, symbols: list[str], today: date, days: int):
    since = today - timedelta(days=days)
    with session_factory() as db:
        snapshots = _snapshots(db, set(symbols), since)
        items = _evaluate(db, snapshots, since)
        due = select_settlements(snapshots, items,
                                 repository.lesson_calls(db, {item["symbol"] for item in snapshots}))
        return due, repository.snapshot_responses(db, {item.snapshot_id for item in due})


def _save(session_factory, lesson: BriefLesson) -> bool:
    with session_factory() as db:
        try:
            with db.begin():
                db.add(lesson)
        except IntegrityError:
            return False  # Another run settled the same call first.
    return True


async def settle(session_factory, llm, symbols: list[str], *, limit: int, execute: bool,
                 today: date | None = None, days: int = LOOKBACK_DAYS) -> dict:
    today = today or datetime.now(TAIPEI).date()
    due, responses = await asyncio.to_thread(_load_due, session_factory, symbols, today, days)
    report = {"due": len(due), "selected": min(len(due), limit), "ready": 0, "rejected": 0,
              "duplicate": 0, "failed": 0}
    for item in due[:limit]:
        if not execute:
            print(f"symbol={item.symbol} as_of={item.as_of_date} horizon={item.horizon} "
                  f"resolved_on={item.resolved_on} result={item.result} action=would_review", flush=True)
            continue
        try:
            lesson = await write_review(llm, item, responses.get(item.snapshot_id))
        except AppError as exc:
            report["failed"] += 1
            logging.getLogger(__name__).error("Review failed for %s %s (%s)", item.symbol, item.as_of_date,
                                              type(exc).__name__)
            continue
        if not await asyncio.to_thread(_save, session_factory, lesson):
            report["duplicate"] += 1
        else:
            report["ready" if lesson.status == BRIEF_LESSON_READY else "rejected"] += 1
    return report


def compare(session_factory, symbols: list[str] | None, today: date, days: int) -> dict:
    """Hit rates of briefs that read past reviews versus all the others in the window, per horizon.

    The others include stocks without reviews enabled and briefs from before the feature, so the groups
    differ in stocks and in period as well; the note in the result says so.
    """
    since = today - timedelta(days=days)
    with session_factory() as db:
        snapshots = _snapshots(db, set(symbols) if symbols else None, since)
        items = _evaluate(db, snapshots, since)
    groups = {"with_reviews": [], "without_reviews": []}
    for snapshot, item in zip(snapshots, items):
        used = str(snapshot.get("past_review_count") or "0") != "0"  # MySQL returns JSON numbers as text.
        groups["with_reviews" if used else "without_reviews"].append(item)
    return {"window_start": since.isoformat(), **{name: {
        "briefs": len(members),
        "horizons": [horizon.model_dump(include={"horizon", "directional_calls", "hit_rate", "up_baseline_rate",
                                                 "relative_calls", "relative_hit_rate"})
                     for horizon in tr.summarize(members)],
    } for name, members in groups.items()},
        "note": ("沒讀過檢討的一組也包含未啟用的股票與功能上線前的簡報，兩組的股票與時期都不同，"
                 "差異不全是檢討造成的；樣本少於數十次前不要下結論。")}


def resolve_symbols(settings, session_factory, requested: str | None) -> list[str]:
    if requested:
        return list(dict.fromkeys(item.strip().upper() for item in requested.split(",") if item.strip()))
    configured = lesson_scope(settings)
    if "*" not in configured:
        return configured
    from app.jobs.warmup import stock_info_symbols
    return stock_info_symbols(session_factory)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.jobs brief-lessons", description=(
        "Write short reviews of text-brief calls whose horizon has traded. Without --execute it only lists them."))
    parser.add_argument("--symbols", help="Default: TEXT_BRIEF_LESSONS_SYMBOLS")
    parser.add_argument("--limit", type=int, help="Maximum reviews (LLM calls) this run; default JOBS_LESSONS_LIMIT")
    parser.add_argument("--days", type=int, default=LOOKBACK_DAYS, help="Analysis dates to consider, counted back from today")
    parser.add_argument("--execute", action="store_true", help="Call the model and save the reviews")
    parser.add_argument("--compare", action="store_true",
                        help="Print hit rates of briefs written with and without reviews instead of settling")
    args = parser.parse_args(argv)
    if args.days < 1 or (args.limit is not None and args.limit < 0):
        parser.error("--days must be positive and --limit nonnegative")
    from app.clients.llm import LlmClient
    from app.core.config import get_settings
    from app.core.http import make_http_client
    from app.db.engine import make_engine, make_session_factory

    settings = get_settings()
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)
    today = datetime.now(TAIPEI).date()
    try:
        # The worker owns this additive table creation; API requests never mutate schema.
        BriefLesson.__table__.create(engine, checkfirst=True)
        if args.compare:
            print(json.dumps(compare(session_factory, args.symbols and resolve_symbols(settings, session_factory, args.symbols),
                                     today, args.days), ensure_ascii=False, indent=2))
            return 0
        symbols = resolve_symbols(settings, session_factory, args.symbols)
        if not symbols:
            print("job=brief-lessons skipped=disabled", flush=True)
            return 0

        async def run():
            async with make_http_client(settings) as http:
                return await settle(session_factory, LlmClient(settings, http), symbols,
                                    limit=settings.JOBS_LESSONS_LIMIT if args.limit is None else args.limit,
                                    execute=args.execute, today=today, days=args.days)
        report = asyncio.run(run())
        print(json.dumps(report, sort_keys=True), flush=True)
        return 1 if report["failed"] else 0
    finally:
        engine.dispose()
