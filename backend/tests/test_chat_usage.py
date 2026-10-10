import asyncio
import json

import httpx
import pytest

from app.clients.llm import LlmClient
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService, _tokens
from app.features.chat.audit import ChatAudit
from test_chat import FakeRetrieval, MODEL_ANSWER
from test_llm_chat import completion, configured, stream_frame


@pytest.mark.parametrize(("metadata", "expected"), [
    ({}, None),
    ({"thinking_tokens": 7}, 7),
    ({"reasoning_tokens": 0, "thinking_tokens": 7}, 0),
    ({"reasoning_tokens": None, "thinking_tokens": 7}, 7),
])
def test_usage_preserves_missing_zero_and_legacy_reasoning_counts(metadata, expected):
    assert _tokens(metadata) == {"input": None, "output": None, "thinking": expected}


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("repair", [False, True])
@pytest.mark.parametrize("reasoning", [None, 0, 7])
def test_provider_reasoning_usage_reaches_chat_response(settings, stream, repair, reasoning):
    calls = []
    valid = "Revenue increased.[S1]"

    def provider(request):
        calls.append(request)
        text = "Rejected.[S99]" if repair and len(calls) == 1 else valid
        result = completion(text)
        if reasoning is not None:
            result["usage"]["completion_tokens_details"] = {"reasoning_tokens": reasoning}
        if stream and len(calls) == 1:
            first = stream_frame(text).replace(b'"delta": {', b'"delta": {"role": "assistant", ')
            return httpx.Response(200, content=first + stream_frame(finish="stop")
                                  + stream_frame(usage=result["usage"]) + b"data: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json=result)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            llm = LlmClient(configured(settings), http)
            service = ChatService(http=None, settings=None, retrieval=object(), llm=llm)
            if stream:
                chunks = [chunk async for chunk in llm.stream_text(system_prompt="Policy", prompt="Evidence")]
                raw_text = "".join(chunk.text for chunk in chunks)
                metadata = chunks[-1].metadata
            else:
                result = await llm.text(system_prompt="Policy", prompt="Evidence")
                raw_text, metadata = result.raw_text, result.metadata
            source = SourceChunk(citation_id="S1", content="Revenue increased.", title="Report",
                                 source="test", source_name="Test", pub_time="", url="", stock_id="", score=1)
            response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[source],
                                   tokens={}, duration_ms=0, current_time="2026-10-03 12:00")
            audit = ChatAudit(AskRequest(query="Revenue?"), llm=llm, timeout_seconds=60)
            audit.start_attempt("initial", llm)
            service._publish_answer(raw_text, metadata, response, audit=audit)
            attempts = 1
            assert response.tokens == {"input": 50 * attempts, "output": 12 * attempts,
                                       "thinking": reasoning * attempts if reasoning is not None else None}
            assert response.answer == ("Rejected.[S99]" if repair else valid)
            assert len(calls) == attempts

    asyncio.run(run())


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("repair", [False, True])
def test_whole_turn_counts_only_intent_and_initial_answer(settings, chat_session_factory, stream, repair):
    calls = []

    def provider(request):
        body = json.loads(request.content)
        if "response_format" in body:
            stage, text, usage = "intent", '{"is_finance":true,"stocks":["2330"]}', (11, 3, 2)
        elif "answer" not in calls:
            stage, text, usage = "answer", "Rejected.[S99]" if repair else MODEL_ANSWER, (50, 12, 5)
        else:
            stage, text, usage = "repair", MODEL_ANSWER, (70, 20, 7)
        calls.append(stage)
        result = completion(text)
        result["usage"] = {"prompt_tokens": usage[0], "completion_tokens": usage[1],
                           "total_tokens": usage[0] + usage[1],
                           "completion_tokens_details": {"reasoning_tokens": usage[2]}}
        if body.get("stream"):
            first = stream_frame(text).replace(b'"delta": {', b'"delta": {"role": "assistant", ')
            return httpx.Response(200, content=first + stream_frame(finish="stop")
                                  + stream_frame(usage=result["usage"]) + b"data: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json=result)

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            service = ChatService(http=http, settings=configured(settings), retrieval=FakeRetrieval(),
                                  session_factory=chat_session_factory)
            request = AskRequest(query="台積電營收", stream=stream)
            if stream:
                events = [event async for event in service.stream_events(request)]
                assert events[-1]["type"] == "done", events
                tokens = events[-1]["tokens"]
                assert events[-1]["answer"] == ("Rejected.[S99]" if repair else MODEL_ANSWER)
            else:
                response = await service.ask(request)
                tokens = response.tokens
                assert response.answer == ("Rejected.[S99]" if repair else MODEL_ANSWER)
            assert tokens == {"input": 61, "output": 15, "thinking": 7}

    asyncio.run(run())
    assert calls == ["intent", "answer"]
