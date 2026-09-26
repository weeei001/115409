import argparse
import asyncio
import json
import math
from pathlib import Path
import random

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings, state_directory
from app.core.errors import AppError
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.db.models.news_article import NewsArticle
from app.features.news.sentiment import company_catalog, extract_candidate_stocks
from app.jobs.locking import JobAlreadyRunning, worker_lock
from .runner import SentimentBatchRunner


def generate_manifest(db, *, stocks: list[str], limit=100, seed=42, dev_split=20):
    catalog = company_catalog()
    stocks = list(dict.fromkeys(stocks))
    if not stocks or any(symbol not in catalog for symbol in stocks):
        raise ValueError("--stocks must contain listed stock symbols")
    if limit < 1:
        raise ValueError("--limit must be positive")
    articles = db.scalars(select(NewsArticle).where(NewsArticle.content.is_not(None))
                         .order_by(NewsArticle.pub_time.desc(), NewsArticle.article_id))
    by_stock, seen, unique_pairs = {symbol: [] for symbol in stocks}, set(), []
    for article in articles:
        for symbol in extract_candidate_stocks(article.stock_id, article.tags, article.title, article.content, catalog):
            if symbol not in by_stock or (article.article_id, symbol) in seen:
                continue
            seen.add((article.article_id, symbol))
            item = {"article_id": article.article_id, "symbol": symbol,
                "target_stock_name": catalog[symbol]["name"], "date": str(article.pub_time)[:10] if article.pub_time else "",
                "title": article.title or "", "url": article.url or "", "source": article.source or ""}
            by_stock[symbol].append(item)
            unique_pairs.append(item)
    rng, sampled = random.Random(seed), []
    per_stock = max(1, limit // len(stocks))
    for pairs in by_stock.values():
        rng.shuffle(pairs)
        sampled.extend(pairs[:per_stock])
    selected = {(item["article_id"], item["symbol"]) for item in sampled}
    remaining = [item for item in unique_pairs if (item["article_id"], item["symbol"]) not in selected]
    rng.shuffle(remaining)
    sampled.extend(remaining[:max(0, limit - len(sampled))])
    rng.shuffle(sampled)
    return [{**item, "split": "dev" if index < dev_split else "test"} for index, item in enumerate(sampled[:limit])]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone news sentiment batch; preview unless --execute is specified")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest")
    source.add_argument("--generate-manifest")
    source.add_argument("--incremental", action="store_true",
                        help="Select new or changed article/stock inputs; use --manifest to retry unchanged failures")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--max-cost-usd", type=float, default=0.50)
    parser.add_argument("--model", help="Override the shared LLM_MODEL setting for this invocation")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--stocks", help="Comma-separated listed symbols; default is all listed companies")
    parser.add_argument("--backfill-days", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--work-dir", type=Path, default=state_directory())
    args = parser.parse_args(argv)
    if args.limit < 1 or args.backfill_days < 1 or not math.isfinite(args.max_cost_usd) or args.max_cost_usd < 0:
        parser.error("--limit must be positive and --max-cost-usd must be finite and nonnegative")
    try:
        items = None
        if args.manifest:
            items = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
            if not isinstance(items, list):
                raise ValueError("Manifest must be a JSON array")
        settings = get_settings()
        if args.model:
            settings = settings.model_copy(update={"LLM_MODEL": args.model})
        catalog = company_catalog()
        if not catalog:
            raise ValueError("Listed-company catalog is unavailable; refresh official catalog first")
        stocks = [symbol.strip() for symbol in args.stocks.split(",") if symbol.strip()] if args.stocks else None
        if stocks is not None and (not stocks or any(symbol not in catalog for symbol in stocks)):
            raise ValueError("--stocks must contain listed stock symbols")
        with worker_lock("sentiment", args.work_dir):
            engine = make_engine(settings)
            try:
                with make_session_factory(engine)() as db:
                    if args.generate_manifest:
                        manifest = generate_manifest(db, stocks=stocks or list(catalog), limit=args.limit, seed=args.seed)
                        output = Path(args.generate_manifest)
                        output.parent.mkdir(parents=True, exist_ok=True)
                        output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
                        print(f"manifest={output} pairs={len(manifest)}")
                        return 0

                    async def run():
                        async with make_http_client(settings) as http:
                            runner = SentimentBatchRunner(db_session=db, settings=settings, http=http,
                                max_cost_usd=args.max_cost_usd, limit=args.limit, execute=args.execute,
                                work_dir=args.work_dir)
                            if args.incremental:
                                from datetime import datetime, timedelta
                                from app.features.news.sentiment import TAIPEI_TZ
                                state = args.work_dir / "sentiment_backfill_start.json"
                                if state.exists():
                                    checkpoint = json.loads(state.read_text(encoding="utf-8"))
                                    started = datetime.fromisoformat(checkpoint["started"])
                                    days = checkpoint["days"]
                                else:
                                    started = datetime.now(TAIPEI_TZ).replace(tzinfo=None)
                                    days = args.backfill_days
                                    if args.execute:
                                        args.work_dir.mkdir(parents=True, exist_ok=True)
                                        state.write_text(json.dumps({"started": started.isoformat(),
                                            "days": days}), encoding="utf-8")
                                if started.tzinfo is not None or not isinstance(days, int) or days < 1:
                                    raise ValueError("Invalid sentiment backfill checkpoint")
                                since = (started - timedelta(days=days)).replace(tzinfo=TAIPEI_TZ)
                                pending = runner.incremental_manifest(stocks, since=since, new_since=started)
                            else:
                                pending = items
                            return await runner.run_manifest(pending)
                    summary = asyncio.run(run())
                    print(json.dumps(summary, ensure_ascii=False, indent=2))
                    return 1 if summary["failed"] or summary["stopped_reason"] else 0
            finally:
                engine.dispose()
    except (OSError, ValueError, JobAlreadyRunning, AppError, SQLAlchemyError) as exc:
        print(f"sentiment-batch failed: {type(exc).__name__}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
