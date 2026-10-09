import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.clients.llm import LlmClient, LlmResult, LlmTextChunk
from app.core.errors import UpstreamTimeout
from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService
from test_llm_chat import completion, configured


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
def test_preparation_answer_and_repair_share_one_deadline(settings, stream):
    calls = []
    repair_cancelled = []

    async def text(**kwargs):
        stage = "repair" if "answer" in calls else "answer"
        calls.append(stage)
        try:
            await asyncio.sleep(0.15 if stage == "repair" else 0.06)
        except asyncio.CancelledError:
            if stage == "repair":
                repair_cancelled.append(True)
            raise
        return LlmResult({}, VALID_ANSWER if stage == "repair" else REJECTED_ANSWER, METADATA)

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
                assert REJECTED_ANSWER not in json.dumps(events)
            else:
                try:
                    response = await service.ask(request)
                    assert REJECTED_ANSWER not in response.answer
                except UpstreamTimeout:
                    pass
        assert calls == ["prepare", "answer", "repair"]
        assert repair_cancelled == [True]

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


@pytest.mark.parametrize(("initial_tokens", "repair_tokens", "expected"), [(8192, 1024, 1024), (512, 1024, 512)])
def test_repair_caps_actual_provider_tokens_and_remaining_time_without_mutating_client(
    settings, initial_tokens, repair_tokens, expected,
):
    calls = []

    def provider(request):
        calls.append(json.loads(request.content))
        assert calls[-1]["max_completion_tokens"] == expected
        assert 0 < request.extensions["timeout"]["read"] <= 7
        return httpx.Response(200, json=completion(VALID_ANSWER))

    async def run():
        configured_settings = configured(settings, LLM_MAX_TOKENS=initial_tokens, LLM_TIMEOUT_SECONDS=23,
                                         CHAT_REPAIR_MAX_TOKENS=repair_tokens)
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            llm = LlmClient(configured_settings, http)
            service = ChatService(http=None, settings=configured_settings, retrieval=object(), llm=llm)
            response = prepared_response()
            await service._validate_response(
                REJECTED_ANSWER, METADATA, response, AskRequest(query="Revenue?"), "Evidence", "",
                deadline=asyncio.get_running_loop().time() + 7,
            )
            assert response.answer.startswith(VALID_ANSWER)
            assert llm.settings.LLM_MAX_TOKENS == initial_tokens
            assert llm.settings.LLM_TIMEOUT_SECONDS == 23
            assert len(calls) == 1

    asyncio.run(run())


def test_expired_request_never_starts_another_repair():
    async def forbidden(**kwargs):
        raise AssertionError("Expired request started another model call")

    async def run():
        service = ChatService(http=None, settings=None, retrieval=object(),
                              llm=SimpleNamespace(require_enabled=lambda: None, text=forbidden))
        with pytest.raises(TimeoutError):
            await service._validate_response(
                REJECTED_ANSWER, METADATA, prepared_response(), AskRequest(query="Revenue?"), "Evidence", "",
                deadline=asyncio.get_running_loop().time() - 1,
            )

    asyncio.run(run())
