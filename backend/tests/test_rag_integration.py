"""Exercise the actual HTTP routes, services and adapters without a legacy RAG process."""
import asyncio
from datetime import datetime
import json

import httpx

from app.core.config import Settings
from app.db.engine import make_session_factory
from app.db.session import get_db
from app.main import create_app
from test_analysis_service import brief_payload, seed_prices


def test_shared_retrieval_and_chat_routes_never_call_legacy_rag(settings, db_session, monkeypatch):
    monkeypatch.setattr("app.features.chat.service.taipei_now", lambda: datetime(2026, 7, 13, 12))
    for name, value in {
        "QDRANT_URL": "http://vector.test", "EMBED_API_URL": "https://embed.test/v1/embeddings",
        "EMBED_API_KEY": "test-embed-key", "LLM_API_KEY": "test-llm-key",
        "LLM_BASE_URL": "https://model.test/v1", "LLM_MAX_RETRIES": 0,
        "LLM_MODEL": "shared-model",
        "EMBED_MODEL": "embedding-model",
        "LLM_STREAMING": True,
        "RAG_API_URL": "http://forbidden-legacy.test/api/analyze",
        "NIM_API_KEY": "obsolete-key", "ADVISOR_LLM_MODEL": "obsolete-model",
        "RAG_ASK_MODEL": "obsolete-chat", "RAG_INTENT_MODEL": "obsolete-intent",
        "NVIDIA_API_KEY": "obsolete-embedding-key",
    }.items():
        monkeypatch.setenv(name, str(value))
    configured = Settings(_env_file=None, JWT_SECRET=settings.JWT_SECRET)
    seed_prices(db_session)
    requests = []

    def provider(request):
        requests.append(request)
        body = json.loads(request.content)
        if request.url.host == "embed.test":
            assert body["input_type"] == "query"
            assert body["model"] == "embedding-model"
            assert request.headers["Authorization"] == "Bearer test-embed-key"
            return httpx.Response(200, json={"data": [{"embedding": [0.1, 0.2]}]})
        if request.url.host == "vector.test":
            assert request.url.path.endswith("/points/query")
            payload = {"title": "TSMC quarterly revenue", "page_content": "Public revenue report.",
                       "pub_time": "2026-07-12 12:00:00", "stock_id": "2330",
                       "source": "cnyes", "url": None}
            return httpx.Response(200, json={"result": {"points": [
                {"id": 1, "score": 0.8, "payload": payload},
                {"id": 2, "score": 0.99, "payload": {**payload, "title": "Future news", "pub_time": "2999-01-01"}},
            ]}})
        assert request.url.host == "model.test", "Unexpected self-call or legacy service request"
        assert body["model"] == "shared-model"
        assert request.headers["Authorization"] == "Bearer test-llm-key"
        intent = "response_format" in body
        answer = '{"is_finance":true,"stocks":["2330"]}' if intent else "Public revenue answer.[S1]"
        if intent and json.loads(body["messages"][-1]["content"]).get("task", {}).get("type") == "stock_behavior_text_brief":
            answer = json.dumps(brief_payload())
        base = {"id": "test", "created": 1, "model": body["model"]}
        if body.get("stream"):
            chunk = {**base, "object": "chat.completion.chunk", "choices": [
                {"index": 0, "delta": {"role": "assistant", "content": answer}, "finish_reason": "stop"}]}
            return httpx.Response(200, text=f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json={**base, "object": "chat.completion", "choices": [
            {"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}]})

    async def run():
        app = create_app(configured)
        app.dependency_overrides[get_db] = lambda: db_session
        app.state.session_factory = make_session_factory(db_session.get_bind())
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as upstream:
            app.state.http = upstream
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://v2.test") as client:
                for path, body in (
                    ("/api/analyze", {"symbols": ["2330"], "as_of": "2026-07-13"}),
                    ("/analyze/stock-behavior/rag", {"symbols": ["2330"], "as_of_date": "2026-07-13"}),
                ):
                    response = await client.post(path, json=body)
                    assert response.status_code == 200, response.text
                    sources = response.json()["news_sources"]
                    assert len(sources) == 1 and sources[0]["title"] == "TSMC quarterly revenue"
                response = await client.post("/api/ask", json={"query": "TSMC revenue"})
                assert response.status_code == 200, response.text
                expected_answer = "Public revenue answer.[S1]\n\n【引用來源】\n- [S1] TSMC quarterly revenue"
                assert response.json()["answer"] == expected_answer
                assert response.json()["sources"][0]["url"] == ""
                assert len(response.json()["sources"]) == 1
                response = await client.post("/api/ask", json={"query": "TSMC revenue", "stream": True})
                events = [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]
                assert events[-1]["type"] == "done", response.text
                assert "".join(e["content"] for e in events if e["type"] == "text") == expected_answer
                assert len(events[-1]["sources"]) == 1
                response = await client.post("/analyze/stock-behavior/text-brief", json={
                    "symbol": "2330", "as_of_date": "2026-07-13", "force_refresh": True})
                assert response.status_code == 200, response.text
                assert response.json()["generated_by"] == "shared-model"
                assert response.json()["brief"] is not None
                assert response.json()["snapshot_id"] is not None
    asyncio.run(run())
    assert {request.url.host for request in requests} == {"vector.test", "embed.test", "model.test"}
