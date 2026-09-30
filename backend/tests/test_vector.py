import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from app.clients.vector import VectorClient
from app.core.errors import AppError


def configured(settings, **updates):
    return settings.model_copy(update={"QDRANT_URL": "https://vector.test/", "QDRANT_API_KEY": "test-vector-key",
        "EMBED_API_URL": "https://embedding.test/v1/embeddings", "EMBED_MODEL": "test-embedding-model",
        "EMBED_API_KEY": "test-embedding-key", **updates})


def run_client(settings, handler, operation="embed", **kwargs):
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = VectorClient(http, settings)
            if operation == "embed":
                return await client.embed_query("台積電營收")
            if operation == "query":
                return await client.query([0.1, 0.2], **kwargs)
            return await client.count(**kwargs)
    return asyncio.run(run())


def test_embedding_request_uses_query_input_headers_and_float_vector(settings):
    def handler(request):
        assert str(request.url) == "https://embedding.test/v1/embeddings"
        assert request.headers["Authorization"] == "Bearer test-embedding-key"
        assert "api-key" not in request.headers
        assert json.loads(request.content) == {"model": "test-embedding-model", "input": ["台積電營收"],
            "input_type": "query", "encoding_format": "float", "truncate": "NONE"}
        assert request.extensions["timeout"]["read"] == 12.5
        return httpx.Response(200, json={"data": [{"embedding": [1, -0.25, 0]}]})

    result = run_client(configured(settings, EMBED_TIMEOUT_SECONDS=12.5), handler)
    assert result == [1.0, -0.25, 0.0] and all(type(value) is float for value in result)


@pytest.mark.parametrize("body", ["{}", '{"data":[]}', '{"data":[{}]}',
    '{"data":[{"embedding":null}]}', '{"data":[{"embedding":[]}]}',
    '{"data":[{"embedding":[true]}]}', '{"data":[{"embedding":["0.1"]}]}',
    '{"data":[{"embedding":[NaN]}]}', '{"data":[{"embedding":[Infinity]}]}',
    pytest.param(json.dumps({"data": [{"embedding": [10 ** 400]}]}), id="oversized-integer")])
def test_embedding_rejects_missing_malformed_or_nonfinite_vectors(settings, body):
    with pytest.raises(AppError) as error:
        run_client(configured(settings), lambda request: httpx.Response(200, text=body))
    assert error.value.status_code == 503 and error.value.detail == "Invalid embedding response"


def test_qdrant_query_and_count_use_stock_and_taipei_timestamp_bounds(settings):
    start = datetime(2024, 1, 1)
    end = datetime(2024, 1, 31, 15, 59, 59, tzinfo=timezone.utc)
    expected_filter = {"must": [
        {"should": [
            {"key": "impact_company_ids", "match": {"any": ["2330", "2317"]}},
            {"key": "stock_ids", "match": {"any": ["2330", "2317"]}},
            {"key": "stock_id", "match": {"any": ["2330", "2317"]}},
        ]},
        {"key": "pub_ts", "range": {
            "gte": datetime(2023, 12, 31, 16, tzinfo=timezone.utc).timestamp(), "lte": end.timestamp()}},
    ]}
    operations = []

    def handler(request):
        assert request.headers["api-key"] == "test-vector-key"
        assert "authorization" not in request.headers
        assert request.extensions["timeout"]["read"] == 4.5
        body = json.loads(request.content)
        assert body["filter"] == expected_filter
        operation = request.url.path.rsplit("/", 1)[-1]
        operations.append(operation)
        assert request.url.raw_path.startswith(b"/collections/news%20chunks/points/")
        if operation == "query":
            assert body == {"query": [0.1, 0.2], "filter": expected_filter, "limit": 7,
                            "with_payload": True, "with_vector": False}
            return httpx.Response(200, json={"result": {"points": [{"id": 123, "score": 0.8,
                                                "payload": {"stock_id": "2330", "pub_time": "2024-01-02"}}]}})
        assert body == {"filter": expected_filter, "exact": True}
        return httpx.Response(200, json={"result": {"count": 42}})

    config = configured(settings, QDRANT_COLLECTION="news chunks", QDRANT_TIMEOUT_SECONDS=4.5)
    query = run_client(config, handler, "query", symbols=["2330", "2317"], start=start, end=end, limit=7)
    count = run_client(config, handler, "count", symbols=["2330", "2317"], start=start, end=end)
    assert query == [{"id": "123", "score": 0.8, "payload": {"stock_id": "2330", "pub_time": "2024-01-02"}}]
    assert count == 42 and operations == ["query", "count"]


def test_qdrant_older_background_keeps_end_without_start_and_host_fallback(settings):
    end = datetime(2024, 1, 31, 23, 59, 59, tzinfo=timezone(timedelta(hours=8)))

    def handler(request):
        assert str(request.url) == "http://vector-host.test:7444/collections/news_chunks/points/query"
        assert "api-key" not in request.headers
        assert json.loads(request.content)["filter"] == {"must": [{"key": "pub_ts", "range": {"lte": end.timestamp()}}]}
        return httpx.Response(200, json={"result": {"points": []}})

    assert run_client(configured(settings, QDRANT_URL="", QDRANT_HOST="vector-host.test", QDRANT_PORT=7444,
        QDRANT_API_KEY=""), handler, "query", end=end) == []


@pytest.mark.parametrize("body", [{}, {"result": None}, {"result": {"points": None}},
    {"result": {"points": [None]}}, {"result": {"points": [{"id": "x", "payload": None}]}},
    {"result": {"points": [{"payload": {}}]}},
    {"result": {"points": [{"id": "x", "score": "NaN", "payload": {}}]}},
    pytest.param({"result": {"points": [{"id": "x", "score": 10 ** 400, "payload": {}}]}}, id="oversized-integer")])
def test_qdrant_query_validates_points_and_finite_scores(settings, body):
    with pytest.raises(AppError) as error:
        run_client(configured(settings), lambda request: httpx.Response(200, json=body), "query")
    assert error.value.status_code == 503 and error.value.detail == "Invalid vector database response"


@pytest.mark.parametrize("body", [{}, {"result": None}, {"result": {}},
    {"result": {"count": -1}}, {"result": {"count": "1"}}, {"result": {"count": True}}])
def test_qdrant_count_requires_nonnegative_integer(settings, body):
    with pytest.raises(AppError) as error:
        run_client(configured(settings), lambda request: httpx.Response(200, json=body), "count")
    assert error.value.status_code == 503 and error.value.detail == "Invalid vector database response"


@pytest.mark.parametrize("operation", ["embed", "query", "count"])
@pytest.mark.parametrize("failure,status", [("non2xx", 503), ("malformed", 503), ("not_object", 503), ("timeout", 504)])
def test_upstream_failures_are_typed_and_do_not_leak_credentials(settings, operation, failure, status):
    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private-address-and-secret")
        if failure == "non2xx":
            return httpx.Response(401, text="private-address-and-secret")
        if failure == "malformed":
            return httpx.Response(200, text="private-address-and-secret")
        return httpx.Response(200, json=[])

    with pytest.raises(AppError) as error:
        run_client(configured(settings), handler, operation)
    assert error.value.status_code == status
    assert "private-address-and-secret" not in str(error.value.detail)
    assert "test-embedding-key" not in str(error.value.detail) and "test-vector-key" not in str(error.value.detail)


@pytest.mark.parametrize("updates", [{"QDRANT_URL": ""}, {"EMBED_API_URL": ""},
    {"EMBED_MODEL": ""}, {"EMBED_API_KEY": "", "LLM_API_KEY": "available-but-not-an-embedding-key"}])
def test_disabled_configuration_never_sends_http(settings, updates):
    def handler(request):
        raise AssertionError("Disabled retrieval must not send a request")

    with pytest.raises(AppError) as error:
        run_client(configured(settings, **updates), handler)
    assert error.value.status_code == 503 and error.value.detail["code"] == "retrieval_unavailable"


@pytest.mark.parametrize("llm_key", ["", "different-llm-key"])
def test_embedding_credentials_are_independent_of_llm_credentials(settings, llm_key):
    def handler(request):
        assert request.headers["Authorization"] == "Bearer test-embedding-key"
        return httpx.Response(200, json={"data": [{"embedding": [1.0]}]})

    assert run_client(configured(settings, LLM_API_KEY=llm_key), handler) == [1.0]


def test_versioned_reads_require_the_exact_pipeline_fingerprint(settings):
    config = configured(settings, NEWS_INDEX_VERSION="news-v1")
    def handler(request):
        must = json.loads(request.content)["filter"]["must"]
        assert {"key": "index_version", "match": {"value": "news-v1"}} in must
        assert {"key": "embedding_model", "match": {"value": config.EMBED_MODEL}} in must
        assert {"key": "index_fingerprint", "match": {"value": config.news_index_fingerprint}} in must
        return httpx.Response(200, json={"result": {"points": []}})
    assert run_client(config, handler, "query") == []
    assert config.news_index_fingerprint != config.model_copy(update={"NEWS_CHUNK_MAX_CHARS": 600}).news_index_fingerprint
