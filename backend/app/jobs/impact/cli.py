"""Standalone, preview-first event impact worker."""
import argparse
import asyncio
from datetime import datetime, timedelta
import json
import math
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.features.market.company_catalog import load_catalog
from app.features.news.sentiment import TAIPEI_TZ
from app.jobs.locking import JobAlreadyRunning, worker_lock
from .migrate import migrate_news_impact
from .runner import ImpactBatchRunner


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Analyze article-level news events; preview unless --execute")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--backfill-days", type=int, default=30)
    parser.add_argument("--max-cost-usd", type=float, default=0.50)
    parser.add_argument("--model")
    parser.add_argument("--work-dir", type=Path, default=Path(__file__).resolve().parents[3] / ".state")
    args = parser.parse_args(argv)
    if args.limit < 1 or args.backfill_days < 1 or not math.isfinite(args.max_cost_usd) or args.max_cost_usd < 0:
        parser.error("Invalid limit, backfill window or budget")
    try:
        settings = get_settings()
        if args.model:
            settings = settings.model_copy(update={"LLM_MODEL": args.model})
        catalog = load_catalog()
        if not catalog:
            raise ValueError("Official company catalog is unavailable")
        with worker_lock("news-impact", args.work_dir):
            engine = make_engine(settings)
            try:
                if args.execute:
                    migrate_news_impact(engine)
                with make_session_factory(engine)() as db:
                    async def run():
                        async with make_http_client(settings) as http:
                            runner = ImpactBatchRunner(db_session=db, settings=settings, catalog=catalog, http=http,
                                limit=args.limit, max_cost_usd=args.max_cost_usd,
                                execute=args.execute, work_dir=args.work_dir)
                            since = datetime.now(TAIPEI_TZ).replace(tzinfo=None) - timedelta(days=args.backfill_days)
                            return await runner.run(since=since)
                    summary = asyncio.run(run())
                    print(json.dumps(summary, ensure_ascii=False, indent=2))
                    return 1 if summary["stopped_reason"] else 0
            finally:
                engine.dispose()
    except (OSError, ValueError, JobAlreadyRunning, AppError, SQLAlchemyError) as exc:
        print(f"news-impact-batch failed: {type(exc).__name__}")
        return 1
