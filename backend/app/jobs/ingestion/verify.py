"""Read-only reconciliation of current source articles, SQL chunks and Qdrant."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
import hashlib
import json
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import select

from app.clients.vector_writer import VectorWriter
from app.core.config import get_settings
from app.core.http import make_http_client
from app.db.engine import make_engine, make_session_factory
from app.db.models.news_chunk import news_chunks
from app.features.retrieval.chunking import article_chunks
from app.features.retrieval.common import parse_timestamp
from . import repository
from .service import _in_scope


FIELDS = ("article_id", "chunk_id", "content_hash", "revision", "index_version", "index_fingerprint", "source")


def _digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


async def verify_index(session_factory, writer, settings, *, sources=("cnyes",), page_size=100):
    """Scan every point, including points outside the selected source/model filter."""
    if not sources or not 1 <= page_size <= 1000 or not settings.NEWS_INDEX_VERSION:
        raise ValueError("Explicit sources, index version and a valid page size are required")
    report = {"job": "verify-news-index", "read_only": True, "sources": list(sources),
              "index_version": settings.NEWS_INDEX_VERSION, "model": settings.EMBED_MODEL,
              "eligible_articles": 0, "excluded_articles": 0, "expected_chunks": 0,
              "sql_chunks": 0, "vector_points": 0, "complete_articles": 0,
              "ltn_points": 0, "excluded_reasons": {}, "failures": {}, "samples": []}
    failures = Counter()
    def fail(reason, identifier=""):
        failures[reason] += 1
        if len(report["samples"]) < 20:
            report["samples"].append({"reason": reason, "identifier": str(identifier)[:80]})

    expected, article_sizes = {}, Counter()
    after = ""
    while True:
        with session_factory() as db:
            page = repository.pending_articles(db, after=after, page_size=page_size,
                sources=sources, index_version=settings.NEWS_INDEX_VERSION)
        if not page:
            break
        for article in page:
            after = article["article_id"]
            if not _in_scope(article, None, None):
                report["excluded_articles"] += 1
                continue
            if parse_timestamp(article.get("pub_time")) is None:
                fail("invalid_article_publication_time", after)
                continue
            chunks = article_chunks(article, index_version=settings.NEWS_INDEX_VERSION,
                max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
                embedding_model=settings.EMBED_MODEL)
            if not chunks:
                if article.get("_stored_revision"):
                    fail("empty_content_with_preserved_revision", after)
                else:
                    report["excluded_articles"] += 1
                    report["excluded_reasons"]["empty_article_content"] = (
                        report["excluded_reasons"].get("empty_article_content", 0) + 1)
                continue
            report["eligible_articles"] += 1
            for chunk in chunks:
                expected[chunk["chunk_id"]] = {**{key: chunk[key] for key in FIELDS},
                    "body_digest": _digest(chunk["content_chunk"])}
                article_sizes[after] += 1
    report["expected_chunks"] = len(expected)
    if not expected:
        fail("empty_expected_index")

    sql_valid, sql_seen = set(), set()
    with session_factory() as db:
        rows = db.execute(select(news_chunks).where(
            news_chunks.c.index_version == settings.NEWS_INDEX_VERSION)).mappings()
        for row in rows:
            report["sql_chunks"] += 1
            key = row["chunk_id"]
            sql_seen.add(key)
            wanted = expected.get(key)
            if wanted is None:
                fail("unexpected_sql_chunk", key)
            elif (any(row[field] != wanted[field] for field in FIELDS)
                  or _digest(row["content_chunk"] or "") != wanted["body_digest"]):
                fail("sql_payload_mismatch", key)
            else:
                sql_valid.add(key)
    for key in expected.keys() - sql_seen:
        fail("missing_sql_chunk", key)

    # These methods only GET collection info or POST read-only count/scroll queries.
    await writer.require_collection(create=False)
    result = await writer._request("POST", "/points/count", payload={"exact": True})
    count = result.get("result", {}).get("count")
    if type(count) is not int or count < 0:
        raise ValueError("Invalid collection count")
    seen, point_ids, vector_valid, cursors = set(), set(), set(), set()
    offset = None
    while True:
        query = {"limit": page_size, "with_payload": [*FIELDS, "embedding_model", "page_content"],
                 "with_vector": False}
        if offset is not None:
            query["offset"] = offset
        response = await writer._request("POST", "/points/scroll", payload=query)
        result = response.get("result")
        if not isinstance(result, dict) or not isinstance(result.get("points"), list):
            raise ValueError("Invalid collection scroll response")
        for point in result["points"]:
            report["vector_points"] += 1
            payload = point.get("payload") or {}
            key = payload.get("chunk_id")
            point_id = point.get("id")
            if payload.get("source") == "ltn":
                report["ltn_points"] += 1
            if point_id in point_ids or key in seen:
                fail("duplicate_vector_point", key)
            point_ids.add(point_id)
            seen.add(key)
            wanted = expected.get(key)
            if wanted is None:
                fail("unexpected_vector_point", key)
            elif (point_id != str(uuid5(NAMESPACE_URL, "news_chunks:" + key))
                  or payload.get("embedding_model") != settings.EMBED_MODEL
                  or any(payload.get(field) != wanted[field] for field in FIELDS)
                  or _digest(payload.get("page_content") or "") != wanted["body_digest"]):
                fail("vector_payload_mismatch", key)
            else:
                vector_valid.add(key)
        offset = result.get("next_page_offset")
        if offset is None:
            break
        if not isinstance(offset, (int, str)) or isinstance(offset, bool) or offset in cursors:
            raise ValueError("Invalid collection scroll cursor")
        cursors.add(offset)
    for key in expected.keys() - seen:
        fail("missing_vector_point", key)
    if report["vector_points"] != count:
        fail("collection_count_changed_during_scan")
    complete = Counter(expected[key]["article_id"] for key in sql_valid & vector_valid)
    for article_id, size in article_sizes.items():
        if complete[article_id] == size:
            report["complete_articles"] += 1
        else:
            fail("incomplete_article", article_id)
    report["failures"] = dict(failures)
    report["ok"] = not failures
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", default="cnyes")
    parser.add_argument("--index-version")
    parser.add_argument("--collection")
    parser.add_argument("--page-size", type=int, default=100)
    args = parser.parse_args(argv)
    sources = tuple(dict.fromkeys(item.strip() for item in args.sources.split(",") if item.strip()))
    if not sources or not 1 <= args.page_size <= 1000:
        parser.error("Nonempty sources and page-size between 1 and 1000 are required")
    engine = None
    try:
        settings = get_settings().model_copy(update={key: value for key, value in {
            "NEWS_INDEX_VERSION": args.index_version, "QDRANT_COLLECTION": args.collection}.items() if value})
        engine = make_engine(settings)
        factory = make_session_factory(engine)
        async def run():
            async with make_http_client(settings) as http:
                return await verify_index(factory, VectorWriter(http, settings), settings,
                                          sources=sources, page_size=args.page_size)
        report = asyncio.run(run())
        print(json.dumps(report, sort_keys=True))
        return 0 if report["ok"] else 1
    except Exception as exc:
        print(json.dumps({"job": "verify-news-index", "ok": False, "error": type(exc).__name__}))
        return 1
    finally:
        if engine is not None:
            engine.dispose()


if __name__ == "__main__":
    raise SystemExit(main())
