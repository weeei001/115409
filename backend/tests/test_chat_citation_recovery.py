import pytest

from app.clients.llm import LlmResult
from app.core.errors import ServiceUnavailable
from app.features.chat.schemas import SourceChunk
from app.features.chat.service import _checked_answer
from test_chat import MODEL_ANSWER, chat, events


@pytest.mark.parametrize("citation", ["[s1]", "［S1］", "【S1】", "[ S1 ]", "[S1, S2]"])
def test_citation_typography_keeps_source_identity(citation):
    sources = [SourceChunk(citation_id=f"S{i}", content="Revenue report.", title="Report",
                           source="test", source_name="Test", pub_time="", url="", stock_id="2330", score=1)
               for i in (1, 2)]
    answer = _checked_answer(f"## **【重點】**\n\n營收增加。{citation}", {"finish_reason": "stop"}, sources)
    assert "營收增加。[S1]" in answer
    if "S2" in citation:
        assert "[S1][S2]" in answer
    with pytest.raises(ServiceUnavailable):
        _checked_answer("營收增加。［S99］", {"finish_reason": "stop"}, sources)


@pytest.mark.parametrize("stream", [False, True])
def test_invalid_citation_is_regenerated_once_before_publication(chat, stream):
    client, _, llm, _ = chat
    invalid = "營收增加。[S99]\n\n明年一定上漲。"
    llm.answer = invalid
    initial_text = llm.text
    attempts = []

    async def repair(**kwargs):
        attempts.append(kwargs)
        if not stream and len(attempts) == 1:
            return await initial_text(**kwargs)
        assert "previous attempt failed citation validation" in kwargs["system_prompt"]
        assert invalid not in kwargs["prompt"]
        return LlmResult({}, MODEL_ANSWER, llm.metadata)

    llm.text = repair
    response = client.post("/api/ask", json={
        "query": "我想知道台積電的相關資訊，以及一個月內股價可能會上漲還是?", "stream": stream,
    })
    assert response.status_code == 200
    data = events(response)[-1] if stream else response.json()
    assert data["answer"].startswith(MODEL_ANSWER)
    assert "S99" not in response.text and "一定上漲" not in response.text
    assert data["tokens"]["input"] == 200 and data["tokens"]["output"] == 60
    assert len(attempts) == (1 if stream else 2)


@pytest.mark.parametrize("stream", [False, True])
def test_failed_repair_does_not_loop_or_publish_unsupported_claims(chat, stream):
    client, _, llm, _ = chat
    llm.answer = "無來源的保證上漲。[S99]"
    response = client.post("/api/ask", json={"query": "台積電", "stream": stream})
    assert len([kind for kind, _ in llm.calls if kind in {"text", "stream"}]) == 2
    if stream:
        result = events(response)
        assert result[-1]["type"] == "error"
        assert not any(event["type"] in {"text", "done"} for event in result)
    else:
        assert response.status_code == 503
