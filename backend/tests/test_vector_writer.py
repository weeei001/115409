import asyncio
from datetime import datetime, timezone
import json
from uuid import NAMESPACE_URL, uuid5

import httpx
import pytest

from app.clients.vector_writer import VectorWriter
from app.core.errors import AppError
from app.core.config import news_index_fingerprint
from test_vector import configured


def chunk(key="new_0", **updates):
    return dict(chunk_id=key, article_id="new", stock_id="2330", source="test",
                pub_time="2026-01-02 10:00:00", title="Title", url=None, tags=None,
                stock_ids=["2330"], chunk_index=0, char_start=0, char_end=8,
                content_hash="a" * 64, revision="b" * 64, index_version="news-v1",
                index_fingerprint=news_index_fingerprint(model="test-embedding-model"), token_count=None,
                content_chunk="Document", **updates)


def ok(result):
    return httpx.Response(200, json={"status": "ok", "result": result})


def collection(size=2):
    return ok({"config": {"params": {"vectors": {"size": size, "distance": "Cosine"}}}})


def run(settings, handler, operation, *, incompatible_points=0):
    async def execute():
        config = configured(settings, NEWS_INDEX_VERSION="news-v1", QDRANT_COLLECTION="news_chunks_v1")
        def transport(request):
            if request.url.path.endswith("/count"):
                body = json.loads(request.content)
                assert body == {"filter": {"must_not": [{"must": [
                    {"key": "index_version", "match": {"value": "news-v1"}},
                    {"key": "embedding_model", "match": {"value": config.EMBED_MODEL}},
                    {"key": "index_fingerprint", "match": {"value": config.news_index_fingerprint}},
                ]}]}, "exact": True}
                return ok({"count": incompatible_points})
            return handler(request)
        async with httpx.AsyncClient(transport=httpx.MockTransport(transport)) as http:
            return await operation(VectorWriter(http, config))
    return asyncio.run(execute())


def test_document_embeddings_use_passage_and_restore_provider_index_order(settings):
    def handler(request):
        assert request.url.host == "embedding.test"
        assert request.headers["Authorization"] == "Bearer test-embedding-key"
        body = json.loads(request.content)
        assert body["input_type"] == "passage" and body["input"] == ["first", "second"]
        return httpx.Response(200, json={"data": [
            {"index": 1, "embedding": [3, 4]}, {"index": 0, "embedding": [1, 2]}]})
    assert run(settings, handler, lambda writer: writer.embed_documents(["first", "second"])) == [[1., 2.], [3., 4.]]


@pytest.mark.parametrize("data", [
    [{"index": 0, "embedding": [1, 2]}],
    [{"index": 0, "embedding": [1, 2]}, {"index": 0, "embedding": [3, 4]}],
    [{"embedding": [1, 2]}, {"embedding": [3, 4]}],
    [{"index": -1, "embedding": [1, 2]}, {"index": 1, "embedding": [3, 4]}],
    [{"index": True, "embedding": [1, 2]}, {"index": 0, "embedding": [3, 4]}],
    [{"index": 0, "embedding": [1, 2]}, {"index": 1, "embedding": [3]}],
])
def test_invalid_batch_embeddings_are_not_assigned_to_the_wrong_documents(settings, data):
    with pytest.raises(AppError, match="Invalid embedding response"):
        run(settings, lambda request: httpx.Response(200, json={"data": data}),
            lambda writer: writer.embed_documents(["first", "second"]))


def test_existing_legacy_points_paginate_by_chunk_id_and_new_points_keep_payload(settings):
    calls, pages = [], 0
    def handler(request):
        nonlocal pages
        calls.append(request)
        assert request.headers["api-key"] == "test-vector-key"
        assert "authorization" not in request.headers
        if request.method == "GET":
            return collection()
        body = json.loads(request.content)
        if request.url.path.endswith("/scroll"):
            assert body["filter"]["must"] == [{"key": "chunk_id", "match": {"any": ["new_0", "old_0", "old_1"]}}]
            pages += 1
            if pages == 1:
                assert "offset" not in body
                return ok({"points": [{"id": "legacy-random-uuid", "payload": {"chunk_id": "old_0"}}], "next_page_offset": "next-uuid"})
            assert body["offset"] == "next-uuid"
            return ok({"points": [{"id": "another-legacy-uuid", "payload": {"chunk_id": "old_1"}}], "next_page_offset": None})
        assert request.method == "PUT" and request.url.params["wait"] == "true"
        assert body == {"points": [{"id": str(uuid5(NAMESPACE_URL, "news_chunks:new_0")),
            "vector": [1., 2.], "payload": {"chunk_id": "new_0", "stock_id": "2330", "source": "test",
            "pub_time": "2026-01-02 10:00:00", "title": "Title", "url": None, "tags": None,
            "article_id": "new", "chunk_index": 0, "stock_ids": ["2330"],
            "char_start": 0, "char_end": 8, "content_hash": "a" * 64, "revision": "b" * 64,
            "index_version": "news-v1", "index_fingerprint": news_index_fingerprint(model="test-embedding-model"),
            "embedding_model": "test-embedding-model", "token_count": None,
            "page_content": "Document", "pub_ts": datetime(2026, 1, 2, 2, tzinfo=timezone.utc).timestamp()}}]}
        return ok({"status": "completed"})
    assert run(settings, handler, lambda writer: writer.upsert_chunks(
        [chunk("old_0"), chunk("new_0"), chunk("old_1")], [[1., 2.]] * 3)) == 1
    assert pages == 2 and len(calls) == 4


@pytest.mark.parametrize("case,status", [("missing", 503), ("upstream", 503), ("malformed", 503), ("timeout", 504), ("dimensions", 409)])
def test_read_failures_or_existing_dimension_mismatch_never_create_or_write(settings, case, status):
    calls = []
    def handler(request):
        calls.append(request.method)
        if case == "missing":
            return httpx.Response(404)
        if case == "upstream":
            return httpx.Response(503, text="private-token")
        if case == "malformed":
            return httpx.Response(200, text="private-token")
        if case == "timeout":
            raise httpx.ReadTimeout("private-token")
        return collection(size=3)
    with pytest.raises(AppError) as error:
        run(settings, handler, lambda writer: writer.upsert_chunks([chunk()], [[1., 2.]]))
    assert error.value.status_code == status and "private-token" not in str(error.value.detail)
    assert calls == ["GET"]


def test_collection_creation_requires_explicit_opt_in_and_known_document_dimension(settings):
    calls = []
    def handler(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(404)
        body = json.loads(request.content)
        if request.url.path.endswith("/news_chunks_v1"):
            assert body == {"vectors": {"size": 2, "distance": "Cosine"}}
            return ok(True)
        if request.url.path.endswith("/index"):
            assert request.url.params["wait"] == "true"
            return ok({"status": "completed"})
        if request.url.path.endswith("/scroll"):
            return ok({"points": []})
        assert request.url.params["wait"] == "true"
        return ok({"status": "completed"})
    async def operation(writer):
        await writer.require_collection(create=True)
        assert [request.method for request in calls] == ["GET"]
        return await writer.upsert_chunks([chunk()], [[1., 2.]])
    assert run(settings, handler, operation) == 1
    assert [json.loads(request.content)["field_name"] for request in calls if request.url.path.endswith("/index")] == [
        "pub_ts", "chunk_id", "stock_id", "stock_ids", "article_id", "index_version", "index_fingerprint", "embedding_model"]


@pytest.mark.parametrize("result", [{"status": "acknowledged"}, None, False])
def test_unconfirmed_upsert_is_not_reported_successful(settings, result):
    def handler(request):
        if request.method == "GET":
            return collection()
        if request.url.path.endswith("/scroll"):
            return ok({"points": []})
        return ok(result)
    with pytest.raises(AppError, match="not confirmed completed"):
        run(settings, handler, lambda writer: writer.upsert_chunks([chunk()], [[1., 2.]]))


def test_repeated_scroll_cursor_cannot_loop_forever(settings):
    calls = []
    def handler(request):
        calls.append(request)
        return ok({"points": [], "next_page_offset": "same"})
    with pytest.raises(AppError, match="Invalid vector database scroll response"):
        run(settings, handler, lambda writer: writer.existing_chunk_ids(["x"]))
    assert len(calls) == 2


def test_same_dimension_different_pipeline_is_rejected_before_embedding(settings):
    calls = []
    def handler(request):
        calls.append(request.method)
        return collection()
    with pytest.raises(AppError, match="different model or indexing configuration"):
        run(settings, handler, lambda writer: writer.require_collection(), incompatible_points=1)
    assert calls == ["GET"]


def test_stale_cleanup_waits_for_complete_replacement_and_is_article_scoped(settings):
    deleted = []
    def handler(request):
        if request.url.path.endswith("/scroll"):
            return ok({"points": [{"payload": {"chunk_id": "current_0"}}]})
        assert request.url.path.endswith("/delete") and request.url.params["wait"] == "true"
        deleted.append(json.loads(request.content))
        return ok({"status": "completed"})
    with pytest.raises(AppError, match="incomplete"):
        run(settings, handler, lambda writer: writer.delete_stale_article_chunks("article", "news-v1", ["current_0", "current_1"]))
    assert not deleted
    run(settings, handler, lambda writer: writer.delete_stale_article_chunks("article", "news-v1", ["current_0"]))
    assert deleted == [{"filter": {"must": [
        {"key": "article_id", "match": {"value": "article"}},
        {"key": "index_version", "match": {"value": "news-v1"}},
    ], "must_not": [{"key": "chunk_id", "match": {"any": ["current_0"]}}]}}]


def test_legacy_collection_cannot_be_used_for_v2_writes(settings):
    async def execute():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: pytest.fail("Unexpected HTTP"))) as http:
            await VectorWriter(http, configured(settings)).require_collection(create=True)
    with pytest.raises(AppError, match="explicit index version and a new collection"):
        asyncio.run(execute())


def test_impact_sync_reads_and_updates_payload_without_vectors(settings):
    calls = []
    point_id = str(uuid5(NAMESPACE_URL, "news_chunks:chunk-1"))
    def handler(request):
        calls.append(request)
        body = json.loads(request.content)
        if request.url.path.endswith("/points"):
            assert body == {"ids": [point_id], "with_payload": True, "with_vector": False}
            return ok([{"id": point_id, "payload": {"chunk_id": "chunk-1"}}])
        assert request.url.path.endswith("/payload") and request.url.params["wait"] == "true"
        assert body == {"points": [point_id], "payload": {"impact_scopes": ["market"]}}
        return ok({"status": "completed"})
    async def operation(writer):
        points = await writer.chunk_payloads(["chunk-1"])
        await writer.set_chunk_payload(points["chunk-1"]["id"], {"impact_scopes": ["market"]})
        return points
    assert run(settings, handler, operation) == {
        "chunk-1": {"id": point_id, "payload": {"chunk_id": "chunk-1"}}}
    assert [request.url.path.rsplit("/", 1)[-1] for request in calls] == ["points", "payload"]


def test_impact_sync_isolates_unreadable_qdrant_point(settings):
    good_id = str(uuid5(NAMESPACE_URL, "news_chunks:good"))
    bad_id = str(uuid5(NAMESPACE_URL, "news_chunks:bad"))

    def handler(request):
        ids = json.loads(request.content)["ids"]
        if bad_id in ids:
            return httpx.Response(500, json={"status": {"error": "OffsetZero"}})
        return ok([{"id": good_id, "payload": {"chunk_id": "good"}}])

    async def operation(writer):
        points = await writer.chunk_payloads(["good", "bad"])
        assert writer.unavailable_chunk_ids == {"bad"}
        return points

    assert run(settings, handler, operation) == {
        "good": {"id": good_id, "payload": {"chunk_id": "good"}}}
