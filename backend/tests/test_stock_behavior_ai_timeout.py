import asyncio
from types import SimpleNamespace

from routers.stock_behavior import STOCK_BEHAVIOR_TIMEOUT_SECONDS
from stock_behavior import llm
from stock_behavior.llm import StockBehaviorLlmService


def test_text_brief_endpoint_allows_long_running_llm_response():
    assert STOCK_BEHAVIOR_TIMEOUT_SECONDS >= 900


def test_llm_client_uses_bounded_non_thinking_json_generation(monkeypatch):
    captured = {}

    class FakeChatOpenAI:
        def __init__(self, **kwargs):
            captured.update(kwargs)

        async def ainvoke(self, messages):
            return SimpleNamespace(
                content='{"summary": "ok"}',
                response_metadata={
                    "finish_reason": "stop",
                    "token_usage": {"completion_tokens": 7},
                },
            )

    monkeypatch.setattr(llm, "ChatOpenAI", FakeChatOpenAI)

    service = StockBehaviorLlmService(
        SimpleNamespace(
            NIM_API_KEY="token",
            NIM_BASE_URL="https://example.test/v1",
            ADVISOR_LLM_MODEL="deepseek-ai/deepseek-v4-pro",
            ADVISOR_LLM_TEMPERATURE=0.35,
            ADVISOR_LLM_MAX_COMPLETION_TOKENS=4096,
            ADVISOR_LLM_RESPONSE_FORMAT="json_object",
        )
    )

    parsed, raw_text, meta = asyncio.run(
        service.generate_text_brief_from_evidence(task_packet={"task": {}})
    )

    assert 600 <= captured["timeout"] < STOCK_BEHAVIOR_TIMEOUT_SECONDS
    assert captured["max_completion_tokens"] == 4096
    assert captured["temperature"] == 0.35
    assert captured["extra_body"]["chat_template_kwargs"]["thinking"] is False
    assert captured["model_kwargs"]["response_format"] == {"type": "json_object"}
    assert parsed["summary"] == "ok"
    assert raw_text == '{"summary": "ok"}'
    assert meta == {
        "finish_reason": "stop",
        "completion_tokens": 7,
        "truncated": False,
    }
