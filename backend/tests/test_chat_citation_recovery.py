import pytest

from app.features.chat.schemas import SourceChunk
from test_chat import MODEL_ANSWER, chat, events


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("answer", [
    "?????[S99]\n\n???????",
    "?????????[S99]",
    "??????S1?",
])
def test_citations_are_published_unchanged_without_repair(chat, stream, answer):
    client, _, llm, retrieval = chat
    llm.answer = answer
    response = client.post("/api/ask", json={"query": "????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == answer
    assert data["tokens"] == {"input": 100, "output": 30, "thinking": None}
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert len(retrieval.calls) == 1
    assert data["sources"][0]["url"] == "https://news.test/report"
    assert "https://news.test/report" not in data["answer"]
    if stream:
        result = events(response)
        assert result[-1]["type"] == "done" and llm.closed
        assert "".join(event["content"] for event in result if event["type"] == "text") == answer


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("completion", [
    {"finish_reason": "length"}, {"finish_reason": "stop", "truncated": True},
])
@pytest.mark.parametrize("citation", ["S1", "S99"])
def test_truncation_and_citation_metadata_do_not_gate_or_retry_output(chat, stream, completion, citation):
    client, _, llm, retrieval = chat
    llm.answer = f"Incomplete fixture draft [{citation}]"
    llm.metadata.update(completion, thinking_tokens=7)
    response = client.post("/api/ask", json={"query": "???????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == llm.answer
    assert data["tokens"] == {"input": 100, "output": 30, "thinking": 7}
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert len(retrieval.calls) == 1
    if stream:
        result = events(response)
        assert result[-1]["type"] == "done" and llm.closed
        assert [event["content"] for event in result if event["type"] == "text"] == [llm.answer]


@pytest.mark.parametrize("news", ["接單成長", "工廠停工並取消財測"])
@pytest.mark.parametrize("stream", [False, True])
def test_outlook_is_not_replaced_by_verified_fallback(chat, news, stream):
    client, service, llm, retrieval = chat
    retrieval.hits[0]["payload"]["page_content"] = news
    llm.intent = {"is_finance": True, "stocks": ["2330", "2317"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: [SourceChunk(citation_id="", title="2317 price", source="system_market",
        source_name="Test", pub_time="2026-09-11", url="", stock_id="2317", score=1,
        category="market_technical", content='{"columns":["date","close"],"rows":[["2026-09-11",50]]}')]
    llm.answer = "保證上漲。[S99]"
    response = client.post("/api/ask", json={"query": "???????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == llm.answer
    assert any(source["stock_id"] == "2317" for source in data["sources"])
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1


@pytest.mark.parametrize("stream", [False, True])
def test_partial_market_coverage_does_not_append_to_model_answer(chat, monkeypatch, stream):
    from app.features.chat import service as chat_module
    client, service, llm, _ = chat
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {"2330": {"name": "台積電"}, "2603": {"name": "長榮"}})
    llm.intent = {"is_finance": True, "stocks": ["2330", "2603"], "data_needs": ["market", "news"]}
    service._market_sources = lambda *_: []
    response = client.post("/api/ask", json={"query": "????????", "stream": stream})
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"] == MODEL_ANSWER
    assert data["detected_stocks"] == ["2330", "2603"]
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 1
    assert data["sources"]
