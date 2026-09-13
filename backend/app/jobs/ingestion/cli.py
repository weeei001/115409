"""CLI entry points for versioned news ingestion; never invoked by the web API."""
import argparse
import asyncio
from contextlib import nullcontext
from datetime import date
import json

import httpx

from app.core.config import get_settings
from app.db.engine import make_engine, make_session_factory
from app.jobs.locking import worker_lock
from .service import chunk_news, failure_reason, vectorize_news


MODES = ("chunk-news", "vectorize-news", "news-ingest")


def main(mode: str, argv: list[str] | None = None) -> int:
    if mode not in MODES:
        raise ValueError("Unknown ingestion job")
    parser = argparse.ArgumentParser(prog=f"python -m app.jobs {mode}", description=(
        "Read counts source articles. Chunking written counts committed articles; vectorization "
        "written counts confirmed new points. Dry-run reports planned work without external vector calls."
    ))
    parser.add_argument("--symbols", default="", help="Comma-separated stock IDs; omitted means all stocks")
    parser.add_argument("--start", type=date.fromisoformat)
    parser.add_argument("--end", type=date.fromisoformat)
    parser.add_argument("--limit", type=int, help="Maximum source articles to inspect per stage")
    parser.add_argument("--batch-size", type=int, default=50)
    parser.add_argument("--index-version", help="Explicit target index version")
    parser.add_argument("--dry-run", action="store_true", help="Read MySQL only; do not write or call embedding/Qdrant")
    if mode != "chunk-news":
        parser.add_argument("--collection", help="Explicit target Qdrant collection")
        parser.add_argument("--create-collection", action="store_true", help="Create a missing collection; never replace one")
        parser.add_argument("--skip-stale-cleanup", action="store_true",
                            help="Skip old revision cleanup when building a fresh collection")
    args = parser.parse_args(argv)
    if args.start and args.end and args.start > args.end:
        parser.error("--start must be on or before --end")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if not 1 <= args.batch_size <= 1000:
        parser.error("--batch-size must be between 1 and 1000")
    if args.index_version is not None and (not args.index_version.strip() or len(args.index_version) > 80):
        parser.error("--index-version must contain 1 to 80 characters")
    symbols = list(dict.fromkeys(symbol.strip().upper() for symbol in args.symbols.split(",") if symbol.strip()))
    if args.symbols and not symbols:
        parser.error("--symbols must contain at least one symbol")
    settings = get_settings()
    overrides = {}
    if args.index_version is not None:
        overrides["NEWS_INDEX_VERSION"] = args.index_version
    if getattr(args, "collection", None):
        overrides["QDRANT_COLLECTION"] = args.collection
    settings = settings.model_copy(update=overrides)
    version = settings.NEWS_INDEX_VERSION or "news-v2"
    if mode != "chunk-news" and not args.dry_run:
        if not settings.NEWS_INDEX_VERSION or settings.QDRANT_COLLECTION == "news_chunks":
            parser.error("Set an explicit index version and a new collection before vectorization")
    options = dict(symbols=symbols, start=args.start, end=args.end, limit=args.limit,
                   page_size=args.batch_size, dry_run=args.dry_run, index_version=version)
    engine = make_engine(settings)
    session_factory = make_session_factory(engine)
    reports = []
    try:
        # All writable ingestion commands share the existing process lock.
        with nullcontext() if args.dry_run else worker_lock("news-ingestion"):
            if mode in {"chunk-news", "news-ingest"}:
                reports.append(chunk_news(session_factory, max_chars=settings.NEWS_CHUNK_MAX_CHARS,
                    overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS, embedding_model=settings.EMBED_MODEL, **options))
                print(json.dumps(reports[-1].as_dict(), ensure_ascii=False))
                if reports[-1].failed:
                    return 1
            if mode in {"vectorize-news", "news-ingest"}:
                async def vectorize():
                    from app.clients.vector_writer import VectorWriter
                    async with httpx.AsyncClient() as http:
                        return await vectorize_news(session_factory, VectorWriter(http, settings),
                                                     create_collection=args.create_collection,
                                                     cleanup_stale=not args.skip_stale_cleanup, **options)
                reports.append(asyncio.run(vectorize()))
                print(json.dumps(reports[-1].as_dict(), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"job": mode, "failed": 1, "error": failure_reason(exc)}))
        return 1
    finally:
        engine.dispose()
    return 1 if any(report.failed for report in reports) else 0


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2 or sys.argv[1] not in MODES:
        raise SystemExit("Usage: python -m app.jobs.ingestion.cli {chunk-news|vectorize-news|news-ingest} [options]")
    raise SystemExit(main(sys.argv[1], sys.argv[2:]))

