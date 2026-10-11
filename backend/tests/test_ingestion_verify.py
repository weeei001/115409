import asyncio
import json
from uuid import NAMESPACE_URL, uuid5

import pytest
from sqlalchemy import delete, update

from app.db.models.news_article import NewsArticle
from app.jobs.ingestion import verify
from app.jobs.ingestion.service import chunk_news
from test_ingestion import ingestion_db, _article, _seed, _stored


class ReadOnlyWriter:
    def __init__(self, points):
        self.points = points
        self.calls = []

    async def require_collection(self, create=False):
        assert create is False

    async def _request(self, method, suffix, *, payload):
        assert method == "POST" and suffix in {"/points/count", "/points/scroll"}
        self.calls.append(suffix)
        if suffix == "/points/count":
            return {"result": {"count": len(self.points)}}
        assert payload["with_vector"] is False
        first = payload.get("offset", 0)
        last = first + payload["limit"]
        return {"result": {"points": self.points[first:last],
                           "next_page_offset": last if last < len(self.points) else None}}


def setup_index(factory, settings):
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "verify-v2"})
    _seed(factory, [_article("cnyes", content="private body " * 200),
                    {**_article("excluded"), "source": "ltn"}])
    chunk_news(factory, sources=["cnyes"], index_version=settings.NEWS_INDEX_VERSION,
               embedding_model=settings.EMBED_MODEL)
    points = [{"id": str(uuid5(NAMESPACE_URL, "news_chunks:" + row["chunk_id"])),
               "payload": {**{key: row[key] for key in verify.FIELDS},
                           "embedding_model": settings.EMBED_MODEL,
                           "page_content": row["content_chunk"]}} for row in _stored(factory)]
    return settings, points


def test_verification_reconciles_every_point_and_complete_article(ingestion_db, settings):
    _, factory = ingestion_db
    settings, points = setup_index(factory, settings)
    writer = ReadOnlyWriter(points)
    report = asyncio.run(verify.verify_index(factory, writer, settings, page_size=1))
    assert report["ok"] and report["complete_articles"] == report["eligible_articles"] == 1
    assert report["expected_chunks"] == report["sql_chunks"] == report["vector_points"] == len(points)
    assert report["ltn_points"] == 0 and report["failures"] == {}
    assert writer.calls.count("/points/scroll") == len(points)
    assert "private body" not in json.dumps(report)


def test_verification_reports_title_only_articles_as_excluded(ingestion_db, settings):
    _, factory = ingestion_db
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "verify-v2"})
    _seed(factory, [_article("cnyes", content="indexed article body"),
                    {**_article("title-only", content=""), "source": "cnyes", "content_kind": "title_only"}])
    chunk_news(factory, sources=["cnyes"], index_version=settings.NEWS_INDEX_VERSION,
               embedding_model=settings.EMBED_MODEL)
    points = [{"id": str(uuid5(NAMESPACE_URL, "news_chunks:" + row["chunk_id"])),
               "payload": {**{key: row[key] for key in verify.FIELDS},
                           "embedding_model": settings.EMBED_MODEL,
                           "page_content": row["content_chunk"]}} for row in _stored(factory)]
    report = asyncio.run(verify.verify_index(factory, ReadOnlyWriter(points), settings))
    assert report["ok"] and report["complete_articles"] == report["eligible_articles"] == 1
    assert report["excluded_articles"] == 1
    assert report["excluded_reasons"] == {"empty_article_content": 1}


@pytest.mark.parametrize("mutation,reason", [
    ("missing", "missing_vector_point"), ("payload", "vector_payload_mismatch"),
    ("body", "vector_payload_mismatch"), ("point_id", "vector_payload_mismatch"),
    ("ltn", "unexpected_vector_point"), ("duplicate", "duplicate_vector_point"),
    ("current_article_changed", "unexpected_sql_chunk"), ("missing_sql", "missing_sql_chunk"),
])
def test_verification_rejects_partial_stale_and_wrong_source_indexes(ingestion_db, settings, mutation, reason):
    _, factory = ingestion_db
    settings, points = setup_index(factory, settings)
    if mutation == "missing":
        points.pop()
    elif mutation == "payload":
        points[0]["payload"]["revision"] = "wrong"
    elif mutation == "body":
        points[0]["payload"]["page_content"] = "corrupted"
    elif mutation == "point_id":
        points[0]["id"] = "unexpected-id"
    elif mutation == "duplicate":
        points.append(points[0])
    elif mutation == "ltn":
        points.append({"id": "ltn-id", "payload": {"source": "ltn", "chunk_id": "foreign"}})
    elif mutation == "current_article_changed":
        with factory() as db:
            db.execute(update(NewsArticle).where(NewsArticle.article_id == "cnyes").values(content="correction"))
            db.commit()
    elif mutation == "missing_sql":
        with factory() as db:
            db.execute(delete(verify.news_chunks).where(verify.news_chunks.c.chunk_id == points[0]["payload"]["chunk_id"]))
            db.commit()
    report = asyncio.run(verify.verify_index(factory, ReadOnlyWriter(points), settings))
    assert not report["ok"] and report["failures"][reason] >= 1
    if mutation == "ltn":
        assert report["ltn_points"] == 1


def test_verification_cli_sanitizes_error_and_disposes_engine(settings, monkeypatch, capsys):
    class Engine:
        disposed = False
        def dispose(self):
            self.disposed = True
    engine = Engine()
    monkeypatch.setattr(verify, "get_settings", lambda: settings)
    monkeypatch.setattr(verify, "make_engine", lambda settings: engine)
    monkeypatch.setattr(verify, "make_session_factory", lambda engine: None)
    def failed_client(settings):
        raise RuntimeError("private credentials or SQL body")
    monkeypatch.setattr(verify, "make_http_client", failed_client)
    assert verify.main([]) == 1 and engine.disposed
    report = json.loads(capsys.readouterr().out)
    assert report == {"job": "verify-news-index", "ok": False, "error": "RuntimeError"}
