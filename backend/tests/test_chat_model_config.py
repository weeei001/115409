import asyncio
import json

import httpx
import pytest

from app.features.analysis.service import AnalysisService, build_llm_runtime_config
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from test_chat import FakeRetrieval, MODEL_ANSWER
from test_llm_chat import completion, configured, stream_frame


@pytest.mark.parametrize("stream", [False, True])
def test_chat_intent_answer_and_repair_use_chat_model_without_changing_analysis(settings, stream, chat_session_factory):
    settings = configured(settings, LLM_MODEL="analysis-model", LLM_MAX_TOKENS=8192,
                          LLM_TIMEOUT_SECONDS=900, LLM_MAX_RETRIES=2,
                          CHAT_LLM_MODEL="fast-chat-model", CHAT_LLM_MAX_TOKENS=2048,
                          CHAT_LLM_TIMEOUT_SECONDS=45, CHAT_LLM_MAX_RETRIES=0)
    calls = []

    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        if body["model"] == "analysis-model":
            assert body["max_completion_tokens"] == 8192
            assert request.extensions["timeout"]["read"] == 900
            return httpx.Response(200, json=completion("Analysis answer"))
        assert body["model"] == "fast-chat-model"
        assert body["max_completion_tokens"] == 2048
        assert request.extensions["timeout"]["read"] == 45
        text = ('{"is_finance":true,"stocks":["2330"],"data_needs":["news"]}'
                if "response_format" in body else "Invalid citation [S99]" if len(calls) == 2 else MODEL_ANSWER)
        if body.get("stream"):
            first = stream_frame(text).replace(b'"delta": {', b'"delta": {"role": "assistant", ')
            return httpx.Response(200, content=first + stream_frame(finish="stop") + b"data: [DONE]\n\n",
                                  headers={"Content-Type": "text/event-stream"})
        return httpx.Response(200, json=completion(text))

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(provider)) as http:
            chat = ChatService(settings=settings, http=http, retrieval=FakeRetrieval(), session_factory=chat_session_factory)
            assert chat.intent_llm is chat.llm
            assert chat.llm.settings.LLM_MAX_RETRIES == 0
            request = AskRequest(query="台積電", stream=stream)
            if stream:
                events = [event async for event in chat.stream_events(request)]
                assert events[-1]["type"] == "done"
                assert events[-1]["answer"].startswith(MODEL_ANSWER)
                statuses = [event["content"] for event in events if event["type"] == "status"]
                assert statuses[-3:] == ["正在核對回答的引用與數值…", "回答未通過核對，正在依據來源重新產生…",
                                         "正在重新核對回答的引用與數值…"]
                assert not any("Invalid citation" in event.get("content", "") for event in events)
            else:
                assert (await chat.ask(request)).answer.startswith(MODEL_ANSWER)
            analysis = AnalysisService(db=None, settings=settings, http=http, rag=object())
            assert analysis.llm.settings is settings
            assert analysis.llm.settings.LLM_MAX_RETRIES == 2
            await analysis.llm.text(system_prompt="Analysis", prompt="Evidence")
            assert settings.LLM_MODEL == "analysis-model"
            assert build_llm_runtime_config(settings, analysis.llm.model_name) == build_llm_runtime_config(
                settings.model_copy(update={"CHAT_LLM_MODEL": "different-chat-model"}), analysis.llm.model_name)

    asyncio.run(run())
    assert [body["model"] for body in calls] == ["fast-chat-model"] * 3 + ["analysis-model"]


def test_empty_chat_model_preserves_existing_model_with_separate_limits(settings):
    settings = configured(settings)
    service = ChatService(settings=settings, http=None, retrieval=FakeRetrieval())
    assert service.llm.model_name == settings.LLM_MODEL
    assert service.llm.settings is not settings
    assert service.llm.settings.LLM_MAX_TOKENS == 8192
    assert service.llm.settings.LLM_TIMEOUT_SECONDS == 60
    assert service.llm.settings.LLM_MAX_RETRIES == 0
