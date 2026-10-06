"""Standalone, preview-first event impact worker."""
import argparse
import asyncio
from datetime import date, datetime, time, timedelta
import json
import math
from pathlib import Path

from app.core.config import get_settings, state_directory
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.features.market.company_catalog import load_catalog
from app.features.news.sentiment import TAIPEI_TZ
from app.jobs.diagnostics import report_failure
from app.jobs.locking import worker_lock
from .migrate import migrate_news_impact
from .runner import ImpactBatchRunner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze article-level news events; preview unless --execute")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--limit", type=int, default=100)
    window = parser.add_mutually_exclusive_group()
    window.add_argument("--backfill-days", type=int, default=30)
    window.add_argument("--since", type=date.fromisoformat,
                        help="Fixed Taiwan-local publication start date; overrides the default 30-day window")
    parser.add_argument("--max-cost-usd", type=float, default=0.50)
    parser.add_argument("--model")
    parser.add_argument("--work-dir", type=Path, default=state_directory())
    args = parser.parse_args(argv)
    if args.limit < 1 or args.backfill_days < 1 or not math.isfinite(args.max_cost_usd) or args.max_cost_usd < 0:
        parser.error("Invalid limit, backfill window or budget")
    phase = "settings"
    try:
        settings = get_settings()
        if args.model:
            settings = settings.model_copy(update={"LLM_MODEL": args.model})
        phase = "catalog"
        catalog = load_catalog()
        if not catalog:
            raise ValueError("Official company catalog is unavailable")
        phase = "lock"
        with worker_lock("news-impact", args.work_dir):
            phase = "database"
            engine = make_engine(settings)
            try:
                if args.execute:
                    phase = "schema"
                    migrate_news_impact(engine)
                phase = "database"
                with make_session_factory(engine)() as db:
                    async def run():
                        nonlocal phase
                        phase = "http"
                        async with make_http_client(settings) as http:
                            phase = "analysis"
                            runner = ImpactBatchRunner(db_session=db, settings=settings, catalog=catalog, http=http,
                                limit=args.limit, max_cost_usd=args.max_cost_usd,
                                execute=args.execute, work_dir=args.work_dir)
                            since = (datetime.combine(args.since, time.min) if args.since else
                                     datetime.now(TAIPEI_TZ).replace(tzinfo=None) - timedelta(days=args.backfill_days))
                            return await runner.run(since=since)
                    summary = asyncio.run(run())
                    print(json.dumps(summary, ensure_ascii=False, indent=2))
                    if summary["stopped_reason"] or summary["failed"]:
                        report_failure("analysis", reason=summary["stopped_reason"] or "article_failures",
                            failure_reasons=summary.get("failure_reasons"))
                        return 1
                    return 0
            finally:
                engine.dispose()
    except Exception as exc:
        diagnostic = report_failure(phase, error=exc,
            reason="catalog_unavailable" if phase == "catalog" else "worker_exception")
        print(f"news-impact-batch failed: {diagnostic['error_type']} phase={phase} reason={diagnostic['reason']}")
        return 1
