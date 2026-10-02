import asyncio
import json

import httpx
import pytest
from pydantic import BaseModel

from app.clients.llm import LlmClient, _load_json_object, _thinking_extra_body
from app.core.errors import AppError


class StructuredAnswer(BaseModel):
    summary: str


def _completion(content, finish_reason="stop"):
    return {"id": "chat-test", "object": "chat.completion", "created": 1, "model": "test-model",
            "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": finish_reason}],
            "usage": {"prompt_tokens": 100, "completion_tokens": 7, "total_tokens": 107}}


def _generate(settings, handler, **overrides):
    async def run():
        configured = settings.model_copy(update={"LLM_API_KEY": "test-token", "LLM_BASE_URL": "https://llm.test/v1",
            "LLM_MODEL": "test-model", "LLM_MAX_RETRIES": 0, "LLM_STREAMING": False, **overrides})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            return await LlmClient(configured, http).generate(system_prompt="Return JSON", payload={"test": True}, schema=StructuredAnswer)
    return asyncio.run(run())


def test_actual_langchain_structured_output_and_metadata(settings):
    received = {}

    def handler(request):
        received.update(json.loads(request.content))
        assert request.url.path == "/v1/chat/completions"
        return httpx.Response(200, json=_completion('{"summary":"complete"}'))
    result = _generate(settings, handler)
    assert result.payload == {"summary": "complete"}
    assert result.metadata == {"finish_reason": "stop", "completion_tokens": 7,
        "prompt_tokens": 100, "model_name": "test-model", "truncated": False}
    assert received["response_format"] == {"type": "json_object"}
    assert [message["role"] for message in received["messages"]] == ["system", "user"]
    assert received["max_completion_tokens"] == 8192


@pytest.mark.parametrize("raw, expected", [
    ('{"summary":"complete"}', {"summary": "complete"}),
    ('<think>private</think>\n```json\n{"summary":"complete"}\n```', {"summary": "complete"}),
    ('{"summary":"complete"}\nmodel footer', {"summary": "complete"}),
    ('{"relative_price": 121 / 110}', {"relative_price": 1.1}),
    ('{"items":[{"complete":true},{"partial":', None),
    ('[1,2]', None),
    ('{"relative_price": 121 / 0}', None),
])
def test_provider_parser_regressions(raw, expected):
    assert _load_json_object(raw) == expected


@pytest.mark.parametrize("raw, finish, expected", [
    ('{"summary":"complete"}', "length", {}),
    ('{"summary":"partial"', "stop", {}),
    ('not JSON', "stop", {}),
    ('<think>private</think>```json\n{"summary":"complete"}\n```', "stop", {"summary": "complete"}),
])
def test_malformed_truncated_and_legacy_outputs(settings, raw, finish, expected):
    result = _generate(settings, lambda request: httpx.Response(200, json=_completion(raw, finish)))
    assert result.payload == expected
    assert result.metadata["truncated"] is (finish == "length")


def test_disabled_configuration_does_not_construct_or_contact_provider(settings):
    async def run():
        with pytest.raises(AppError) as error:
            await LlmClient(settings).generate(system_prompt="test", payload={}, schema=StructuredAnswer)
        assert error.value.status_code == 503
        assert error.value.detail["code"] == "llm_unavailable"
    asyncio.run(run())


@pytest.mark.parametrize("timeout", [True, False])
def test_provider_timeout_and_failure_mapping(settings, timeout):
    def handler(request):
        if timeout:
            raise httpx.ReadTimeout("private upstream address")
        return httpx.Response(503, json={"error": {"message": "private credential", "type": "server_error"}})
    with pytest.raises(AppError) as error:
        _generate(settings, handler)
    assert error.value.status_code == (504 if timeout else 503)
    assert "private" not in str(error.value.detail)


def test_provider_thinking_compatibility_remains_local():
    assert _thinking_extra_body("gemini-3.8-flash", False) == {}
    assert _thinking_extra_body("deepseek-ai/deepseek-v4-pro") == {"chat_template_kwargs": {"thinking": False}}
    assert _thinking_extra_body("qwen/qwen3") == {"chat_template_kwargs": {"enable_thinking": False}}
    assert _thinking_extra_body("nvidia/nemotron-3-super-120b-a12b") == {"chat_template_kwargs": {"enable_thinking": False}}
    assert _thinking_extra_body("meta/llama") == {}


def test_disabled_response_format_omits_provider_format(settings):
    def handler(request):
        assert "response_format" not in json.loads(request.content)
        return httpx.Response(200, json=_completion('{"summary":"complete"}'))
    assert _generate(settings, handler, LLM_RESPONSE_FORMAT="off").payload == {"summary": "complete"}


@pytest.mark.parametrize("response_format, streaming", [
    ("json_schema", False), ("json_object", True), ("json_schema", True),
])
def test_optional_schema_and_streaming_modes(settings, response_format, streaming):
    def handler(request):
        body = json.loads(request.content)
        assert body["response_format"]["type"] == response_format
        if response_format == "json_schema":
            assert body["response_format"]["json_schema"]["schema"]["required"] == ["summary"]
        if not streaming:
            return httpx.Response(200, json=_completion('{"summary":"complete"}'))
        assert body["stream"] is True
        base = {"id": "chat-test", "object": "chat.completion.chunk", "created": 1, "model": "test-model"}
        chunks = [
            {**base, "choices": [{"index": 0, "delta": {"role": "assistant", "content": '{"summary":'}, "finish_reason": None}]},
            {**base, "choices": [{"index": 0, "delta": {"content": '"complete"}'}, "finish_reason": None}]},
            {**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]},
            {**base, "choices": [], "usage": {"prompt_tokens": 100, "completion_tokens": 7, "total_tokens": 107}},
        ]
        content = "".join(f"data: {json.dumps(chunk)}\n\n" for chunk in chunks) + "data: [DONE]\n\n"
        return httpx.Response(200, headers={"content-type": "text/event-stream"}, content=content)
    result = _generate(settings, handler, LLM_RESPONSE_FORMAT=response_format, LLM_STREAMING=streaming)
    assert result.payload == {"summary": "complete"}
    assert result.metadata["finish_reason"] == "stop"
    assert result.metadata["completion_tokens"] == 7
