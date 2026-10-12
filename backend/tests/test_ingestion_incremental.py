"""Incremental indexing skips completed work and resumes interrupted publication."""
import asyncio

import httpx
import pytest
from sqlalchemy import create_engine, delete, insert, select, text, update
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import chunk_metadata, news_chunk_state, news_chunks, news_vector_state
from app.clients.vector_writer import VectorWriter
from app.core.config import Settings
from app.jobs.ingestion import repository
from app.jobs.ingestion.service import chunk_news, vectorize_news


@pytest.fixture
def factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    NewsArticle.__table__.create(engine)
    chunk_metadata.create_all(engine)
    yield sessionmaker(engine, expire_on_commit=False)
    engine.dispose()


def seed(factory, *identifiers):
    with factory.begin() as db:
        db.execute(insert(NewsArticle), [{
            "article_id": identifier, "source": "cnyes", "stock_id": "2330",
            "pub_time": "2026-10-12T10:00:00+08:00", "title": f"Article {identifier}",
            "content": "A complete news article.", "url": f"https://news.test/{identifier}",
            "tags": "2330",
        } for identifier in identifiers])


def rows(factory, table):
    with factory() as db:
        return list(db.execute(select(table)).mappings())


class RecordingWriter:
    def __init__(self):
        self.points = {}
        self.calls = []
        self.fail_cleanup = set()
        self.fail_embedding = False
        self.on_cleanup = None

    async def require_collection(self, create=False):
        self.calls.append(("collection", create))

    async def existing_chunk_ids(self, identifiers):
        self.calls.append(("existing", tuple(identifiers)))
        return set(identifiers).intersection(self.points)

    async def embed_documents(self, documents):
        self.calls.append(("embed", tuple(documents)))
        if self.fail_embedding:
            raise RuntimeError("embedding unavailable")
        return [[1.0, 0.0] for _ in documents]

    async def upsert_chunks(self, chunks, vectors):
        assert len(chunks) == len(vectors)
        self.calls.append(("upsert", tuple(chunk["chunk_id"] for chunk in chunks)))
        self.points.update({chunk["chunk_id"]: dict(chunk) for chunk in chunks})

    async def delete_stale_article_chunks(self, article_id, index_version, identifiers):
        self.calls.append(("cleanup", article_id))
        if article_id in self.fail_cleanup:
            raise RuntimeError("cleanup unavailable")
        if self.on_cleanup:
            callback, self.on_cleanup = self.on_cleanup, None
            callback()
        self.points = {key: point for key, point in self.points.items()
                       if point["article_id"] != article_id or point["index_version"] != index_version
                       or key in identifiers}


def vectorize(factory, writer, **options):
    return asyncio.run(vectorize_news(factory, writer, retry_delay=0,
                                     **{"target_key": "destination-a", **options}))


def test_second_run_skips_all_completed_articles_without_vector_requests(factory):
    seed(factory, "a", "b")
    writer = RecordingWriter()
    assert chunk_news(factory).written == 2
    assert vectorize(factory, writer).written == 2
    writer.calls.clear()
    assert chunk_news(factory).read == 0
    assert vectorize(factory, writer).read == 0
    assert writer.calls == [("collection", False)]


@pytest.mark.parametrize("change", [{"content": "Corrected article body."}, {"tags": "2330,2317"},
                                    {"url": "https://news.test/corrected"}, {"title": "Corrected title"}])
def test_new_and_core_modified_articles_are_only_pending_work(factory, change):
    seed(factory, "a", "b")
    writer = RecordingWriter()
    chunk_news(factory)
    vectorize(factory, writer)
    original_ids = set(writer.points)
    with factory.begin() as db:
        db.execute(update(NewsArticle).where(NewsArticle.article_id == "b").values(**change))
    seed(factory, "c")
    assert (result := chunk_news(factory)).read == result.written == 2
    writer.calls.clear()
    assert (result := vectorize(factory, writer)).read == result.written == 2
    assert [value for kind, value in writer.calls if kind == "cleanup"] == ["b", "c"]
    assert len(original_ids.intersection(writer.points)) == 1
    assert len(writer.points) == 3


def test_orm_metadata_update_invalidates_source_checkpoint(factory):
    seed(factory, "a")
    chunk_news(factory)
    with factory.begin() as db:
        article = db.get(NewsArticle, "a")
        old_revision = article.ingestion_revision
        article.tags = "2330,2317"
    with factory() as db:
        assert db.get(NewsArticle, "a").ingestion_revision != old_revision
    assert chunk_news(factory).written == 1
    assert rows(factory, news_chunks)[0]["tags"] == "2330,2317"


def test_cleanup_failure_keeps_only_unfinished_article_pending(factory):
    seed(factory, "a", "b")
    chunk_news(factory)
    writer = RecordingWriter()
    writer.fail_cleanup.add("b")
    result = vectorize(factory, writer)
    assert (result.written, result.failed, result.retries) == (1, 1, 2)
    assert [row["article_id"] for row in rows(factory, news_vector_state)] == ["a"]
    assert [value for kind, value in writer.calls if kind == "cleanup"].count("a") == 1
    writer.fail_cleanup.clear()
    writer.calls.clear()
    result = vectorize(factory, writer)
    assert (result.read, result.written, result.skipped, result.failed) == (1, 0, 1, 0)
    assert ("cleanup", "b") in writer.calls
    assert not any(kind == "embed" for kind, _ in writer.calls)
    assert vectorize(factory, writer).read == 0


def test_full_scan_repairs_missing_vector_and_failed_audit_remains_pending(factory):
    seed(factory, "a")
    chunk_news(factory)
    writer = RecordingWriter()
    vectorize(factory, writer)
    writer.points.clear()
    assert vectorize(factory, writer).read == 0
    assert (result := vectorize(factory, writer, full_scan=True)).read == result.written == 1
    writer.points.clear()
    writer.fail_embedding = True
    assert vectorize(factory, writer, full_scan=True).failed == 1
    assert rows(factory, news_vector_state) == []
    writer.fail_embedding = False
    assert (result := vectorize(factory, writer)).read == result.written == 1


def test_publication_checkpoints_are_isolated_by_destination(factory):
    seed(factory, "a")
    chunk_news(factory)
    first, second = RecordingWriter(), RecordingWriter()
    assert vectorize(factory, first, target_key="server-a/collection-a").written == 1
    assert vectorize(factory, second, target_key="server-a/collection-b").written == 1
    assert vectorize(factory, first, target_key="server-a/collection-a").read == 0
    assert len(rows(factory, news_vector_state)) == 2


def test_dry_run_never_writes_checkpoints_or_calls_vector_service(factory):
    seed(factory, "a")
    assert chunk_news(factory, dry_run=True).planned == 1
    assert rows(factory, news_chunk_state) == rows(factory, news_chunks) == []
    chunk_news(factory)
    writer = RecordingWriter()
    assert vectorize(factory, writer, dry_run=True).planned == 1
    assert rows(factory, news_vector_state) == []
    assert writer.calls == []
    vectorize(factory, writer)
    checkpoints = rows(factory, news_vector_state)
    writer.calls.clear()
    assert vectorize(factory, writer, dry_run=True, full_scan=True).read == 1
    assert rows(factory, news_vector_state) == checkpoints
    assert writer.calls == []


def test_legacy_null_revision_bootstraps_once_then_tracks_updates(factory):
    seed(factory, "a")
    with factory.begin() as db:
        db.execute(text("UPDATE news_articles SET ingestion_revision = NULL"))
    assert chunk_news(factory).written == 1
    assert rows(factory, news_chunk_state)[0]["source_revision"] is None
    assert chunk_news(factory).read == 0
    with factory.begin() as db:
        db.execute(update(NewsArticle).values(content="Updated legacy article."))
    assert chunk_news(factory).written == 1
    assert rows(factory, news_chunk_state)[0]["source_revision"] is not None


def test_source_update_during_vector_publication_is_processed_next_run(factory):
    seed(factory, "a")
    chunk_news(factory)
    old_revision = rows(factory, news_chunks)[0]["revision"]
    writer = RecordingWriter()

    def change_source():
        with factory.begin() as db:
            db.execute(update(NewsArticle).values(content="Correction while vectors publish."))

    writer.on_cleanup = change_source
    assert vectorize(factory, writer).written == 1
    assert rows(factory, news_vector_state)[0]["revision"] == old_revision
    assert chunk_news(factory).written == 1
    assert vectorize(factory, writer).written == 1
    assert rows(factory, news_vector_state)[0]["revision"] != old_revision
    assert len(writer.points) == 1


def test_missing_chunks_and_skipped_cleanup_remain_recoverable(factory):
    seed(factory, "a")
    chunk_news(factory)
    with factory.begin() as db:
        db.execute(delete(news_chunks))
    assert chunk_news(factory).written == 1
    writer = RecordingWriter()
    assert vectorize(factory, writer, cleanup_stale=False).written == 1
    assert rows(factory, news_vector_state) == []
    assert vectorize(factory, writer).read == 1
    assert vectorize(factory, writer).read == 0


def test_full_scan_detects_raw_sql_source_update_without_revision_change(factory):
    seed(factory, "a")
    chunk_news(factory)
    previous = rows(factory, news_chunk_state)[0]["source_revision"]
    with factory.begin() as db:
        db.execute(text("UPDATE news_articles SET content = 'External source correction.'"))
    assert rows(factory, NewsArticle.__table__)[0]["ingestion_revision"] == previous
    assert chunk_news(factory).read == 0
    assert chunk_news(factory, full_scan=True).written == 1
    assert rows(factory, news_chunks)[0]["content_chunk"] == "External source correction."
    assert chunk_news(factory).read == 0


def test_failed_chunk_audit_removes_checkpoint_and_retries_incrementally(factory, monkeypatch):
    seed(factory, "a")
    chunk_news(factory)
    old_chunks = rows(factory, news_chunks)
    with factory.begin() as db:
        db.execute(text("UPDATE news_articles SET content = 'Correction from external writer.'"))
    original = repository.insert_article_chunks

    def fail_after_insert(db, chunks):
        original(db, chunks)
        raise RuntimeError("storage interruption")

    monkeypatch.setattr(repository, "insert_article_chunks", fail_after_insert)
    assert chunk_news(factory, full_scan=True).failed == 1
    assert rows(factory, news_chunks) == old_chunks
    assert rows(factory, news_chunk_state) == []
    monkeypatch.setattr(repository, "insert_article_chunks", original)
    assert chunk_news(factory).written == 1
    assert rows(factory, news_chunks)[0]["content_chunk"] == "Correction from external writer."


def test_partial_chunk_loss_is_repaired_without_source_revision_change(factory):
    seed(factory, "a")
    with factory.begin() as db:
        db.execute(update(NewsArticle).values(content="x" * 1900))
    assert chunk_news(factory).chunks == 3
    expected = {row["chunk_id"] for row in rows(factory, news_chunks)}
    with factory.begin() as db:
        db.execute(delete(news_chunks).where(news_chunks.c.chunk_index == 1))
    assert len(rows(factory, news_chunks)) == 2
    result = chunk_news(factory)
    assert (result.read, result.written, result.chunks) == (1, 1, 3)
    assert {row["chunk_id"] for row in rows(factory, news_chunks)} == expected
    assert chunk_news(factory).read == 0


def test_missing_collection_invalidates_previous_publication_before_rebuild(factory):
    seed(factory, "a")
    chunk_news(factory)
    writer = RecordingWriter()
    vectorize(factory, writer)
    writer.points.clear()
    writer._missing = True
    writer.fail_embedding = True
    assert vectorize(factory, writer, create_collection=True).failed == 1
    assert rows(factory, news_vector_state) == []
    writer.fail_embedding = False
    assert vectorize(factory, writer, create_collection=True).written == 1
    writer._missing = False
    assert vectorize(factory, writer).read == 0


def test_legacy_vectors_bootstrap_checkpoint_without_embedding(factory):
    seed(factory, "a")
    chunk_news(factory)
    writer = RecordingWriter()
    vectorize(factory, writer)
    with factory.begin() as db:
        db.execute(delete(news_vector_state))
    writer.calls.clear()
    result = vectorize(factory, writer)
    assert (result.read, result.written, result.skipped) == (1, 0, 1)
    assert not any(kind in {"embed", "upsert"} for kind, _ in writer.calls)
    assert ("cleanup", "a") in writer.calls
    assert vectorize(factory, writer).read == 0


def test_real_writer_automatically_scopes_checkpoint_to_endpoint_and_collection(factory):
    seed(factory, "a")
    chunk_news(factory)
    chunk_id = rows(factory, news_chunks)[0]["chunk_id"]
    requests = []

    def respond(request):
        requests.append((str(request.url), request.method))
        if request.method == "GET":
            result = {"config": {"params": {"vectors": {"size": 2, "distance": "Cosine"}}}}
        elif request.url.path.endswith("/points/count"):
            result = {"count": 0}
        elif request.url.path.endswith("/points/scroll"):
            result = {"points": [{"payload": {"chunk_id": chunk_id}}], "next_page_offset": None}
        elif request.url.path.endswith("/points/delete"):
            result = {"status": "completed"}
        else:
            raise AssertionError(f"Unexpected vector or embedding request: {request.method} {request.url}")
        return httpx.Response(200, json={"status": "ok", "result": result})

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as http:
            destinations = [("https://vectors-a.test", "news_a_dev"),
                            ("https://vectors-a.test", "news_b_dev"),
                            ("https://vectors-b.test", "news_a_dev")]
            writers = [VectorWriter(http, Settings(_env_file=None, QDRANT_URL=url,
                QDRANT_COLLECTION=collection, NEWS_INDEX_VERSION="news-v1",
                EMBED_API_URL="https://embed.test", EMBED_API_KEY="test-only", EMBED_TRUNCATE="NONE"))
                for url, collection in destinations]
            assert len({writer.index_target_key for writer in writers}) == 3
            for writer in writers:
                report = await vectorize_news(factory, writer, retry_delay=0)
                assert (report.read, report.written, report.skipped, report.failed) == (1, 0, 1, 0)
            assert {row["target_key"] for row in rows(factory, news_vector_state)} == {
                writer.index_target_key for writer in writers}
            requests.clear()
            assert (await vectorize_news(factory, writers[0], retry_delay=0)).read == 0
            assert all("/points/scroll" not in url and "/points/delete" not in url for url, _ in requests)

    asyncio.run(exercise())
