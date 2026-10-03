import pytest

from app.clients.llm import LlmResult
from test_chat import chat, events


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("raw", [
    '{"is_finance":true,"data_needs":["knowledge"]',
    "not-json",
    '{"standalone_query":"What is nominal revenue?"',
])
def test_malformed_intent_does_not_classify_finance_from_arbitrary_no_substrings(chat, stream, raw):
    client, _, llm, retrieval = chat
    llm.intent = {}
    llm.raw_intent = raw
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    data = events(response)[-1] if stream else response.json()
    assert response.status_code == 200
    assert data["detected_stocks"] == ["2330"]
    assert retrieval.calls[0]["symbols"] == ["2330"]
    assert data["sources"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("metadata", [
    {"finish_reason": "length"},
    {"finish_reason": "stop", "truncated": True},
    {"finish_reason": "content_filter"},
])
def test_incomplete_intent_payload_and_legacy_reply_are_not_trusted(chat, stream, metadata):
    client, _, llm, retrieval = chat

    async def incomplete(**kwargs):
        return LlmResult({"is_finance": False, "stocks": ["2454"], "data_needs": ["help"]}, "NO", metadata)

    llm.generate = incomplete
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    data = events(response)[-1] if stream else response.json()
    assert response.status_code == 200
    assert data["detected_stocks"] == ["2330"]
    assert retrieval.calls[0]["symbols"] == ["2330"]
    assert data["sources"]


def test_complete_legacy_no_still_classifies_non_finance(chat):
    client, _, llm, retrieval = chat
    llm.intent = {}
    llm.raw_intent = " NO "
    response = client.post("/api/ask", json={"query": "Tell me a joke"})
    assert response.status_code == 200
    assert response.json()["sources"] == []
    assert not retrieval.calls
