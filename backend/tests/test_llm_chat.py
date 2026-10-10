import asyncio
import json
import ssl

import httpx
import pytest

from app.clients import llm as adapter
from app.clients.llm import LlmClient
from app.core.errors import ServiceUnavailable, UpstreamTimeout
from app.features.chat.planning import TaskPlan
from test_chat import plan_payload


async def invoke(client, mode):
    if mode == "generate":
        return await client.generate(system_prompt="Policy", payload={"query": "TSMC"}, schema=TaskPlan)
    return await client.text(system_prompt="Policy", prompt="News")


def configured(settings, **overrides):
    return settings.model_copy(update={"LLM_API_KEY": "shared-test-key",
        "LLM_BASE_URL": "https://chat.test/v1", "LLM_MODEL": "test-shared-model",
        "LLM_MAX_RETRIES": 0, **overrides})


def completion(content, finish="stop"):
    return {"id": "chat-test", "object": "chat.completion", "created": 1, "model": "served-model",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 12, "total_tokens": 62}}


def stream_frame(content=None, *, finish=None, usage=None):
    chunk = {"id": "chat-test", "object": "chat.completion.chunk", "created": 1, "model": "served-model",
        "choices": [{"index": 0, "delta": {"content": content} if content is not None else {},
                     "finish_reason": finish}] if usage is None else []}
    if usage:
        chunk["usage"] = usage
    return ("data: " + json.dumps(chunk) + "\n\n").encode()


@pytest.mark.parametrize("finish", ["stop", "length"])
def test_text_messages_reasoning_filter_and_metadata(settings, finish):
    def handler(request):
        body = json.loads(request.content)
        assert request.url.path == "/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer shared-test-key"
        assert body["model"] == "test-shared-model" and body["max_completion_tokens"] == 765
        assert body["temperature"] == 0.4 and body.get("stream") is False
        assert "response_format" not in body
        assert body["messages"] == [{"role": "system", "content": "Policy"}, {"role": "user", "content": "News"}]
        return httpx.Response(200, json=completion("<think>private calculation</think> Public answer ", finish))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            result = await LlmClient(configured(settings, LLM_MAX_TOKENS=765, LLM_TEMPERATURE=0.4), http).text(
                system_prompt="Policy", prompt="News")
            assert result.raw_text == "Public answer" and result.payload == {}
            assert result.metadata == {"finish_reason": finish, "model_name": "served-model",
                "prompt_tokens": 50, "completion_tokens": 12, "truncated": finish == "length"}
    asyncio.run(run())


@pytest.mark.parametrize(("chunks", "expected", "finish"), [
    (["<th", "ink>private", " chain</th", "ink>Public", " answer"], "Public answer", "stop"),
    (["First", "<THINK>private</TH", "INK>Second"], "FirstSecond", "stop"),
    (["Visible", "<think>private truncated reasoning"], "Visible", "length"),
])
def test_real_sse_split_reasoning_tokens_never_reach_consumer(settings, chunks, expected, finish):
    def handler(request):
        body = json.loads(request.content)
        assert body["stream"] is True
        assert body["stream_options"] == {"include_usage": True}
        data = b"".join(stream_frame(chunk) for chunk in chunks)
        data += stream_frame(finish=finish)
        data += stream_frame(usage={"prompt_tokens": 50, "completion_tokens": 12, "total_tokens": 62})
        return httpx.Response(200, content=data + b"data: [DONE]\n\n", headers={"Content-Type": "text/event-stream"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            results = [chunk async for chunk in LlmClient(configured(settings), http).stream_text(
                system_prompt="Policy", prompt="News")]
            assert "".join(chunk.text for chunk in results) == expected
            assert all("private" not in chunk.text for chunk in results)
            assert results[-1].metadata["completion_tokens"] == 12
            assert results[-1].metadata["finish_reason"] == finish
            assert results[-1].metadata["truncated"] is (finish == "length")
    asyncio.run(run())


def test_disabled_provider_stream_setting_still_supports_sse_consumer(settings):
    def handler(request):
        assert json.loads(request.content).get("stream") is False
        return httpx.Response(200, json=completion("Answer"))
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = LlmClient(configured(settings, LLM_STREAMING=False), http)
            chunks = [chunk async for chunk in client.stream_text(system_prompt="Policy", prompt="News")]
            assert len(chunks) == 1 and chunks[0].text == "Answer"
            assert chunks[0].metadata["prompt_tokens"] == 50
    asyncio.run(run())


@pytest.mark.parametrize("response_format", ["off", "json_object", "json_schema"])
@pytest.mark.parametrize("configured_streaming", [False, True])
def test_shared_llm_configuration_keeps_structured_and_plain_invocations_distinct(settings, response_format, configured_streaming):
    calls = []
    llm_settings = configured(settings, LLM_MAX_TOKENS=321, LLM_TEMPERATURE=0,
        LLM_TIMEOUT_SECONDS=23, LLM_MAX_RETRIES=1, LLM_STREAMING=configured_streaming, LLM_RESPONSE_FORMAT=response_format)
    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert str(request.url) == "https://chat.test/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer shared-test-key"
        assert body["model"] == "test-shared-model"
        assert body["temperature"] == 0 and body["max_completion_tokens"] == 321
        assert request.extensions["timeout"]["read"] == 23
        if len(calls) == 1:
            assert body.get("stream") is False
            if response_format == "off":
                assert "response_format" not in body
            else:
                assert body["response_format"]["type"] == response_format
            return httpx.Response(200, json=completion(json.dumps(plan_payload({"stocks": ["2330"], "data_needs": ["news"]}))))
        assert "response_format" not in body
        return httpx.Response(200, json=completion("Answer"))
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = LlmClient(llm_settings, http)
            assert client.settings.LLM_MAX_RETRIES == 1
            result = await client.generate(system_prompt="Classify", payload={"query": "TSMC"}, schema=TaskPlan)
            assert result.payload["stocks"] == ["2330"]
            assert result.metadata["finish_reason"] == "stop"
            await client.text(system_prompt="Policy", prompt="News")
    asyncio.run(run())
    assert len(calls) == 2


@pytest.mark.parametrize("stream", [False, True])
def test_disabled_chat_configuration_never_constructs_provider(settings, monkeypatch, stream):
    def forbidden(**kwargs):
        raise AssertionError("Disabled configuration constructed a provider")
    monkeypatch.setattr(adapter, "ChatOpenAI", forbidden)
    async def run():
        client = LlmClient(settings)
        with pytest.raises(ServiceUnavailable) as caught:
            if stream:
                await anext(client.stream_text(system_prompt="Policy", prompt="News"))
            else:
                await client.text(system_prompt="Policy", prompt="News")
        assert caught.value.status_code == 503 and caught.value.detail["code"] == "llm_unavailable"
    asyncio.run(run())


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("failure", ["timeout", "upstream", "malformed_json", "malformed_shape"])
def test_upstream_failures_map_to_typed_safe_errors(settings, stream, failure):
    def handler(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private upstream credential")
        if failure == "upstream":
            return httpx.Response(503, json={"error": {"message": "private upstream credential"}})
        if failure == "malformed_json":
            return httpx.Response(200, content="private malformed body", headers={"Content-Type": "application/json"})
        return httpx.Response(200, json={"private": "credential", "choices": []})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = LlmClient(configured(settings), http)
            with pytest.raises(UpstreamTimeout if failure == "timeout" else ServiceUnavailable) as caught:
                if stream:
                    _ = [chunk async for chunk in client.stream_text(system_prompt="Policy", prompt="News")]
                else:
                    await client.text(system_prompt="Policy", prompt="News")
            assert "private" not in str(caught.value.detail)
    asyncio.run(run())


def test_closing_consumer_closes_actual_upstream_response(settings):
    class ProviderStream(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            yield stream_frame("Visible answer")
            await asyncio.Event().wait()
        async def aclose(self):
            self.closed = True
    upstream = ProviderStream()
    def handler(request):
        return httpx.Response(200, stream=upstream, headers={"Content-Type": "text/event-stream"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            stream = LlmClient(configured(settings), http).stream_text(system_prompt="Policy", prompt="News")
            assert (await anext(stream)).text == "Visible answer"
            await stream.aclose()
            # LangChain's inner async generator finalizes on the next loop turn.
            await asyncio.sleep(0)
            assert upstream.closed
    asyncio.run(run())


def test_stalled_chunk_times_out_before_total_deadline_and_closes_upstream(settings):
    class StalledStream(httpx.AsyncByteStream):
        closed = False
        async def __aiter__(self):
            yield stream_frame("First chunk")
            await asyncio.Event().wait()
        async def aclose(self):
            self.closed = True
    upstream = StalledStream()
    def handler(request):
        return httpx.Response(200, stream=upstream, headers={"Content-Type": "text/event-stream"})
    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = LlmClient(configured(settings, LLM_STREAM_CHUNK_TIMEOUT_SECONDS=1,
                LLM_TIMEOUT_SECONDS=10), http)
            stream = client.stream_text(system_prompt="Policy", prompt="News")
            assert (await anext(stream)).text == "First chunk"
            # This outer limit makes a missing per-chunk timeout fail promptly.
            async with asyncio.timeout(3):
                with pytest.raises(UpstreamTimeout):
                    await anext(stream)
            await asyncio.sleep(0)
            assert upstream.closed
    asyncio.run(run())


@pytest.mark.parametrize("mode", ["generate", "text"])
@pytest.mark.parametrize("failure", ["status", "auth", "read", "timeout", "format", "certificate"])
def test_failure_diagnostics_keep_context_codes_without_exposing_details(settings, mode, failure, caplog):
    calls = []

    def handler(request):
        calls.append(request)
        if failure in {"status", "auth"}:
            return httpx.Response(503 if failure == "status" else 401,
                                  json={"error": {"message": "private upstream token"}})
        if failure == "read":
            raise httpx.ReadError("private upstream token", request=request)
        if failure == "timeout":
            raise httpx.ConnectTimeout("private upstream token", request=request)
        if failure == "certificate":
            certificate = ssl.SSLCertVerificationError(1, "private certificate metadata")
            certificate.verify_code = 20
            try:
                raise certificate
            except ssl.SSLCertVerificationError:
                raise httpx.ConnectError("private upstream token", request=request) from None
        return httpx.Response(200, content="invalid private body", headers={"Content-Type": "application/json"})

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises(UpstreamTimeout if failure == "timeout" else ServiceUnavailable):
                await invoke(LlmClient(configured(settings), http), mode)
    asyncio.run(run())
    assert len(calls) == 1
    if failure == "status":
        assert '"status_code": 503' in caplog.text
    if failure == "certificate":
        assert "SSLCertVerificationError" in caplog.text and '"verify_code": 20' in caplog.text
    assert not any(value in caplog.text for value in ("private upstream token", "private certificate metadata", "invalid private body"))
