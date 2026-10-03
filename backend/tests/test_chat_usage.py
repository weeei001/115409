import asyncio

import httpx
import pytest

from app.clients.llm import LlmClient
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService, _tokens
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
            await service._validate_response(raw_text, metadata, response,
                                             AskRequest(query="Revenue?"), "Evidence", "")
            attempts = 2 if repair else 1
            assert response.tokens == {"input": 50 * attempts, "output": 12 * attempts,
                                       "thinking": reasoning * attempts if reasoning is not None else None}
            assert response.answer.startswith(valid)
            assert len(calls) == attempts

    asyncio.run(run())
