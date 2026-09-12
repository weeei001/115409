import argparse
import asyncio
import json
import math
from pathlib import Path
import random

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings
from app.core.errors import AppError
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.db.models.news_article import NewsArticle
from app.features.news.sentiment import TARGET_STOCKS
from app.jobs.locking import JobAlreadyRunning, worker_lock
from .rules import extract_candidate_stocks
from .runner import SentimentBatchRunner


def generate_manifest(db, *, stocks: list[str], limit=100, seed=42, dev_split=20):
    stocks = list(dict.fromkeys(stocks))
    if not stocks or any(symbol not in TARGET_STOCKS for symbol in stocks):
        raise ValueError("--stocks must contain supported stock symbols")
    if limit < 1:
        raise ValueError("--limit must be positive")
    articles = db.scalars(select(NewsArticle).where(NewsArticle.content.is_not(None))
                         .order_by(NewsArticle.pub_time.desc(), NewsArticle.article_id))
    by_stock, seen, unique_pairs = {symbol: [] for symbol in stocks}, set(), []
    for article in articles:
        for symbol in extract_candidate_stocks(article.stock_id, article.tags):
            if symbol not in by_stock or (article.article_id, symbol) in seen:
                continue
            seen.add((article.article_id, symbol))
            item = {"article_id": article.article_id, "symbol": symbol,
                "target_stock_name": TARGET_STOCKS[symbol], "date": str(article.pub_time)[:10] if article.pub_time else "",
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
    parser.add_argument("--stocks", default=",".join(TARGET_STOCKS))
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--work-dir", type=Path, default=Path(__file__).resolve().parents[3] / ".state")
    args = parser.parse_args(argv)
    if args.limit < 1 or not math.isfinite(args.max_cost_usd) or args.max_cost_usd < 0:
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
        stocks = [symbol.strip() for symbol in args.stocks.split(",") if symbol.strip()]
        if (args.generate_manifest or args.incremental) and (not stocks or any(symbol not in TARGET_STOCKS for symbol in stocks)):
            raise ValueError("--stocks must contain supported stock symbols")
        with worker_lock("sentiment", args.work_dir):
            engine = make_engine(settings)
            try:
                with make_session_factory(engine)() as db:
                    if args.generate_manifest:
                        manifest = generate_manifest(db, stocks=stocks, limit=args.limit, seed=args.seed)
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
                            return await runner.run_manifest(runner.incremental_manifest(stocks) if args.incremental else items)
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
