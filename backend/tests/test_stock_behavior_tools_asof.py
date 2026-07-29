import asyncio
import json
from datetime import date, datetime, timedelta, timezone

import httpx

from stock_behavior import tools
from stock_behavior.tools import _is_on_or_before_as_of, fetch_rag_news


def test_is_on_or_before_as_of_handles_taipei_utc_and_naive_timestamps():
    as_of = date(2024, 1, 2)
    taipei = timezone(timedelta(hours=8))

    assert _is_on_or_before_as_of(datetime(2024, 1, 2, 23, 59, tzinfo=taipei), as_of)
    assert not _is_on_or_before_as_of(datetime(2024, 1, 2, 16, 0, tzinfo=timezone.utc), as_of)
    assert _is_on_or_before_as_of(datetime(2024, 1, 2, 23, 59, 59), as_of)
    assert not _is_on_or_before_as_of(datetime(2024, 1, 3), as_of)


def test_fetch_rag_news_sends_as_of_and_filters_future_news(monkeypatch):
    received = {}

    def handler(request: httpx.Request) -> httpx.Response:
        received.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "news_sources": [
                    {
                        "id": "past",
                        "title": "past news",
                        "timestamp": "2024-01-02T12:00:00+08:00",
                    },
                    {
                        "id": "future",
                        "title": "future news",
                        "timestamp": "2024-01-03T00:00:00+08:00",
                    },
                ]
            },
        )

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)

    def client_with_transport(*args, **kwargs):
        return original_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(tools.httpx, "AsyncClient", client_with_transport)
    result = asyncio.run(
        fetch_rag_news(
            rag_api_url="https://rag.example.test/analyze",
            rag_api_key="token",
            symbol="2330",
            lookback_days=45,
            max_events=5,
            timeout_seconds=10,
            as_of=date(2024, 1, 2),
        )
    )

    assert received == {
        "symbols": ["2330"],
        "lookback_days": 45,
        "as_of": "2024-01-02 23:59:59",
    }
    assert [item["id"] for item in result["news_sources"]] == ["past"]
    assert "raw_answer" not in result


def test_fetch_rag_news_tolerates_legacy_response_fields(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "news_sources": [
                    {
                        "id": "legacy",
                        "title": "legacy news",
                        "timestamp": "2024-01-02T12:00:00+08:00",
                    }
                ],
                "raw_answer": "legacy summary",
                "fallback_mode": False,
            },
        )

    original_client = httpx.AsyncClient
    transport = httpx.MockTransport(handler)

    def client_with_transport(*args, **kwargs):
        return original_client(*args, transport=transport, **kwargs)

    monkeypatch.setattr(tools.httpx, "AsyncClient", client_with_transport)
    result = asyncio.run(
        fetch_rag_news(
            rag_api_url="https://rag.example.test/analyze",
            rag_api_key="token",
            symbol="2330",
            lookback_days=30,
            max_events=5,
            timeout_seconds=10,
            as_of=date(2024, 1, 2),
        )
    )

    assert [item["id"] for item in result["news_sources"]] == ["legacy"]
    assert result["fallback_mode"] is False
    assert "raw_answer" not in result
