import asyncio
from types import SimpleNamespace

import pytest

from app.clients.llm import LlmResult, LlmTextChunk
from app.core.errors import UpstreamTimeout
from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService


VALID_ANSWER = "Revenue increased.[S1]"
REJECTED_ANSWER = "Unverified answer.[S99]"
METADATA = {"finish_reason": "stop", "prompt_tokens": 50, "completion_tokens": 12}


def prepared_response():
    source = SourceChunk(citation_id="S1", content="Revenue increased.", title="Report",
                         source="test", source_name="Test", pub_time="", url="", stock_id="", score=1)
    return AskResponse(answer="Prepared answer.", detected_stocks=[], time_range=None, sources=[source],
                       tokens={"input": 11, "output": 3, "thinking": None}, duration_ms=0,
                       current_time="2026-10-03 12:00")


@pytest.mark.parametrize("stream", [False, True])
def test_preparation_and_answer_share_one_deadline(settings, stream):
    calls = []
    cancelled = []

    async def text(**kwargs):
        calls.append("answer")
        try:
            await asyncio.sleep(0.2)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise
        return LlmResult({}, REJECTED_ANSWER, METADATA)

    async def stream_text(**kwargs):
        result = await text(**kwargs)
        yield LlmTextChunk(result.raw_text, result.metadata)

    async def prepare(request):
        calls.append("prepare")
        yield "Preparing"
        await asyncio.sleep(0.06)
        yield prepared_response(), "Evidence", ""

    async def run():
        llm = SimpleNamespace(require_enabled=lambda: None, text=text, stream_text=stream_text)
        service = ChatService(http=None, settings=settings.model_copy(update={"CHAT_REQUEST_TIMEOUT_SECONDS": 0.2}),
                              retrieval=object(), llm=llm)
        service._prepare_steps = prepare
        request = AskRequest(query="Revenue?", stream=stream)
        async with asyncio.timeout(1):
            if stream:
                events = [event async for event in service.stream_events(request)]
                assert events[-1]["type"] == "error"
                assert not any(event["type"] in {"text", "done"} for event in events)
            else:
                with pytest.raises(UpstreamTimeout):
                    await service.ask(request)
        assert calls == ["prepare", "answer"]
        assert cancelled == [True]

    asyncio.run(run())


def test_stream_deadline_does_not_cancel_the_task_that_consumed_an_earlier_status(settings):
    operation_closed = []

    async def prepare(request):
        yield "Preparing"
        try:
            await asyncio.Event().wait()
        finally:
            operation_closed.append(True)

    async def run():
        llm = SimpleNamespace(require_enabled=lambda: None)
        service = ChatService(http=None, settings=settings.model_copy(update={"CHAT_REQUEST_TIMEOUT_SECONDS": 0.03}),
                              retrieval=object(), llm=llm)
        service._prepare_steps = prepare
        stream = service.stream_events(AskRequest(query="Revenue?", stream=True))
        assert (await anext(stream))["type"] == "status"
        event = await asyncio.wait_for(asyncio.create_task(anext(stream)), timeout=1)
        assert event["type"] == "error" and "時間上限" in event["message"]
        await stream.aclose()
        assert operation_closed == [True]
        assert asyncio.current_task().cancelling() == 0

    asyncio.run(run())


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("with_answer", [False, True])
def test_duration_includes_preparation_and_short_circuit_responses(monkeypatch, stream, with_answer):
    elapsed = [0.0]
    monkeypatch.setattr(chat_module, "perf_counter", lambda: elapsed[0])

    async def prepare(request):
        yield "Preparing"
        elapsed[0] += 2
        yield prepared_response(), "Evidence" if with_answer else "", ""

    async def text(**kwargs):
        elapsed[0] += 1
        return LlmResult({}, VALID_ANSWER, METADATA)

    async def stream_text(**kwargs):
        result = await text(**kwargs)
        yield LlmTextChunk(result.raw_text, result.metadata)

    async def run():
        llm = SimpleNamespace(require_enabled=lambda: None, text=text, stream_text=stream_text)
        service = ChatService(http=None, settings=None, retrieval=object(), llm=llm)
        service._prepare_steps = prepare
        request = AskRequest(query="Revenue?", stream=stream)
        if stream:
            events = [event async for event in service.stream_events(request)]
            assert events[-1]["type"] == "done", events
            duration = events[-1]["duration_ms"]
        else:
            duration = (await service.ask(request)).duration_ms
        assert duration == (3000 if with_answer else 2000)

    asyncio.run(run())
