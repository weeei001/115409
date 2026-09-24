"""Synchronize current event labels into existing news vectors without embedding."""
from __future__ import annotations

import argparse
import asyncio
from collections import defaultdict
from contextlib import nullcontext
from datetime import datetime, timedelta
import json

import httpx
from sqlalchemy import select

from app.clients.vector_writer import VectorWriter
from app.core.config import get_settings
from app.db.engine import make_engine, make_session_factory
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.market.company_catalog import load_catalog
from app.features.news.impact import config_hash
from app.features.retrieval.impact_metadata import (
    IMPACT_PAYLOAD_KEYS, current_analysis, current_chunk_ids, impact_payload,
)
from app.features.retrieval.common import TAIPEI
from app.jobs.ingestion.repository import chunk_page
from app.jobs.locking import worker_lock
from .migrate import migrate_news_impact


async def sync_impact_payloads(session_factory, writer, settings, *, backfill_days=30,
                               limit=None, page_size=50, execute=False) -> dict:
    if backfill_days < 1 or (limit is not None and limit < 1) or not 1 <= page_size <= 1000:
        raise ValueError("Invalid sync window or batch size")
    catalog = load_catalog()
    if not catalog:
        raise ValueError("Official company catalog is unavailable")
    expected_config = config_hash(settings, catalog)
    report = {"job": "news-impact-sync", "dry_run": not execute, "read": 0,
              "eligible_chunks": 0, "updated": 0, "unchanged": 0, "missing_vectors": 0,
              "unavailable_vectors": 0, "stale_chunks": 0}
    if execute:
        await writer.require_collection()
    after = ""
    while limit is None or report["read"] < limit:
        size = min(page_size, limit - report["read"]) if limit is not None else page_size
        with session_factory() as db:
            chunks = chunk_page(db, after=after, page_size=size,
                                start=datetime.now(TAIPEI).date() - timedelta(days=backfill_days),
                                index_version=settings.NEWS_INDEX_VERSION)
            if not chunks:
                break
            article_ids = list(dict.fromkeys(chunk["article_id"] for chunk in chunks))
            articles = {row.article_id: row for row in db.scalars(select(NewsArticle).where(
                NewsArticle.article_id.in_(article_ids)))}
            analyses = {row.article_id: row for row in db.scalars(select(NewsEventAnalysis).where(
                NewsEventAnalysis.article_id.in_(article_ids)))}
            impacts_by_article = defaultdict(list)
            for impact in db.scalars(select(NewsEventImpact).where(NewsEventImpact.article_id.in_(article_ids))):
                impacts_by_article[impact.article_id].append(impact)
            chunks_by_article = defaultdict(list)
            for chunk in chunks:
                chunks_by_article[chunk["article_id"]].append(chunk)
            current = []
            for article_id in article_ids:
                report["read"] += 1
                after = article_id
                article = articles.get(article_id)
                if article is None:
                    continue
                valid_ids = current_chunk_ids(article, settings)
                analysis = analyses.get(article_id)
                if not current_analysis(article, analysis, expected_config):
                    analysis = None
                for chunk in chunks_by_article[article_id]:
                    if chunk["chunk_id"] not in valid_ids:
                        report["stale_chunks"] += 1
                        continue
                    report["eligible_chunks"] += 1
                    current.append((chunk, impact_payload(chunk, analysis,
                        impacts_by_article[article_id] if analysis else [])))
        if not execute or not current:
            continue
        existing = await writer.chunk_payloads([chunk["chunk_id"] for chunk, _ in current])
        for chunk, metadata in current:
            point = existing.get(chunk["chunk_id"])
            if point is None:
                if chunk["chunk_id"] in getattr(writer, "unavailable_chunk_ids", ()):
                    report["unavailable_vectors"] += 1
                else:
                    report["missing_vectors"] += 1
                continue
            if (point["payload"].get("revision") != chunk["revision"]
                    or point["payload"].get("content_hash") != chunk["content_hash"]):
                report["stale_chunks"] += 1
                continue
            if all(point["payload"].get(key) == metadata[key] for key in IMPACT_PAYLOAD_KEYS):
                report["unchanged"] += 1
                continue
            await writer.set_chunk_payload(point["id"], metadata)
            report["updated"] += 1
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync news event metadata to Qdrant; preview unless --execute")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--backfill-days", type=int, default=30)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--batch-size", type=int, default=50)
    args = parser.parse_args(argv)
    settings = get_settings()
    if not settings.NEWS_INDEX_VERSION or settings.QDRANT_COLLECTION == "news_chunks":
        parser.error("Set a versioned news index and collection")
    engine = make_engine(settings)
    try:
        with worker_lock("news-ingestion") if args.execute else nullcontext():
            if args.execute:
                migrate_news_impact(engine)
            async def run():
                async with httpx.AsyncClient() as http:
                    return await sync_impact_payloads(make_session_factory(engine),
                        VectorWriter(http, settings), settings, backfill_days=args.backfill_days,
                        limit=args.limit, page_size=args.batch_size, execute=args.execute)
            print(json.dumps(asyncio.run(run()), ensure_ascii=False))
            return 0
    except Exception as exc:
        print(json.dumps({"job": "news-impact-sync", "error": type(exc).__name__}))
        return 1
    finally:
        engine.dispose()
if __name__ == "__main__":
    raise SystemExit(main())
