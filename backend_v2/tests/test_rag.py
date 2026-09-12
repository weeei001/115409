import asyncio
import json
from datetime import date, datetime, timedelta, timezone

import httpx
import pytest

from app.clients.rag import RagClient, _is_on_or_before_as_of


def test_taipei_asof_preserves_subseconds_and_excludes_future_utc():
    as_of = date(2024, 1, 2)
    assert _is_on_or_before_as_of(datetime(2024, 1, 2, 23, 59, 59, 500000), as_of)
    assert _is_on_or_before_as_of(datetime(2024, 1, 2, 15, 59, tzinfo=timezone.utc), as_of)
    assert not _is_on_or_before_as_of(datetime(2024, 1, 2, 16, 0, tzinfo=timezone.utc), as_of)


def test_rag_request_contract_order_dedupe_and_future_filter(settings):
    received = {}

    def handler(request):
        received.update(json.loads(request.content))
        assert request.headers["Authorization"] == "Bearer test-token"
        return httpx.Response(200, json={"news_sources": [
            {"id": "old", "title": "Old", "timestamp": "2023-01-01T09:00:00+08:00"},
            {"id": "future", "title": "Future", "timestamp": "2024-01-02T16:00:00Z"},
            {"id": "new", "title": "Newest", "timestamp": "2024-01-02T23:59:59.500+08:00"},
            {"id": "new", "title": "Duplicate", "timestamp": "2024-01-02T12:00:00"},
            {"id": "earlier", "title": "Earlier", "timestamp": "2024-01-01T12:00:00"},
        ], "raw_answer": "Legacy ignored field"})

    async def run():
        configured = settings.model_copy(update={"RAG_API_URL": "https://rag.test/api/analyze", "RAG_API_KEY": "test-token"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await RagClient(http, configured).collect(symbol="2330", lookback_days=45,
                max_events=2, as_of=date(2024, 1, 2), enforce_window=True)

    result = asyncio.run(run())
    assert received == {"symbols": ["2330"], "lookback_days": 45, "as_of": "2024-01-02 23:59:59"}
    assert [item["id"] for item in result.news_sources] == ["new", "earlier"]
    assert result.status == "available" and not result.fallback_mode


@pytest.mark.parametrize("response", [
    httpx.Response(503, text="private credentials must not leak"),
    httpx.Response(200, text="not JSON"),
    httpx.Response(200, json=[]),
    httpx.Response(200, json={}),
    httpx.Response(200, json={"news_sources": {"wrong": "shape"}}),
])
def test_rag_upstream_errors_have_observable_fallback(settings, response):
    async def run():
        configured = settings.model_copy(update={"RAG_API_URL": "https://rag.test/analyze"})
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: response)) as http:
            return await RagClient(http, configured).collect(symbol="2330")
    result = asyncio.run(run())
    assert result.news_sources == [] and result.fallback_mode
    assert result.status == "unavailable"
    assert result.reason in {"upstream_error", "invalid_response"}


def test_rag_timeout_and_disabled_are_distinguishable(settings):
    def timeout(request):
        raise httpx.ReadTimeout("upstream private detail")

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(timeout)) as http:
            disabled = await RagClient(http, settings).collect(symbol="2330")
            configured = settings.model_copy(update={"RAG_API_URL": "https://rag.test/analyze"})
            unavailable = await RagClient(http, configured).collect(symbol="2330")
            return disabled, unavailable
    disabled, unavailable = asyncio.run(run())
    assert disabled.reason == "disabled" and unavailable.reason == "timeout"


def test_rag_legacy_fields_and_partial_malformed_sources(settings):
    async def run():
        configured = settings.model_copy(update={"RAG_API_URL": "https://rag.test/analyze"})
        response = {"results": [{"article_id": "known", "title": "Known", "publish_time": "2024-01-02"},
                                {"title": "Bad timestamp", "date": "unknown"}]}
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))) as http:
            return await RagClient(http, configured).collect(symbol="2330", as_of=date(2024, 1, 2))
    result = asyncio.run(run())
    assert [item["id"] for item in result.news_sources] == ["known"]
    assert result.fallback_mode and result.status == "degraded" and result.reason == "invalid_items"


def test_rag_keeps_usable_sources_with_null_legacy_metadata_and_bad_siblings(settings):
    async def run():
        configured = settings.model_copy(update={"RAG_API_URL": "https://rag.test/analyze"})
        response = {"news_sources": [None, "invalid", {"title": "Usable", "timestamp": "2024-01-02",
                    "source_chunk": None, "publisher": None, "url": None, "kind": {}}]}
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response))) as http:
            return await RagClient(http, configured).collect(symbol="2330", as_of=date(2024, 1, 2))
    result = asyncio.run(run())
    assert len(result.news_sources) == 1
    assert result.news_sources[0]["kind"] == "general" and result.news_sources[0]["url"] is None
    assert result.fallback_mode and result.reason == "invalid_items"
