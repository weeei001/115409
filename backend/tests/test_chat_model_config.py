import asyncio
import json

import httpx
import pytest

from app.core.config import Settings
from app.features.analysis.service import AnalysisService, build_llm_runtime_config
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from app.features.news.impact import ImpactOutput, SYSTEM_PROMPT
from app.jobs.impact.runner import ImpactBatchRunner
from test_chat import FakeRetrieval, MODEL_ANSWER, plan_payload
from test_llm_chat import completion, configured, stream_frame


@pytest.mark.parametrize("stream", [False, True])
def test_news_analysis_and_chat_share_provider_with_separate_limits(
        stream, chat_session_factory, tmp_path, monkeypatch):
    monkeypatch.setenv("STREAM_LLM_API_KEY", "obsolete-stream-key")
    monkeypatch.setenv("STREAM_LLM_BASE_URL", "https://obsolete-stream.test/v1")
    monkeypatch.setenv("STREAM_LLM_MODEL", "obsolete-stream-model")
    monkeypatch.setenv("CHAT_LLM_MODEL", "obsolete-chat-model")
    settings = Settings(_env_file=None, LLM_API_KEY="shared-test-key",
                        LLM_BASE_URL="https://chat.test/v1", LLM_MODEL="shared-model",
                        LLM_MAX_TOKENS=8192, LLM_TIMEOUT_SECONDS=900, LLM_MAX_RETRIES=2,
                        CHAT_LLM_MAX_TOKENS=2048, CHAT_LLM_TIMEOUT_SECONDS=45, CHAT_LLM_MAX_RETRIES=0)
    original_config = build_llm_runtime_config(settings, settings.LLM_MODEL)
    calls = []

    def provider(request):
        body = json.loads(request.content)
        calls.append(body)
        assert body["model"] == "shared-model"
        assert str(request.url) == "https://chat.test/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer shared-test-key"
        if len(calls) > 2:
            assert body["max_completion_tokens"] == 8192
            assert request.extensions["timeout"]["read"] == 900
            text = "Analysis answer" if len(calls) == 3 else '{"events":[],"impacts":[]}'
            return httpx.Response(200, json=completion(text))
        assert body["max_completion_tokens"] == 2048
        assert request.extensions["timeout"]["read"] == 45
        text = (json.dumps(plan_payload({"stocks": ["2330"], "data_needs": ["news"]})) if len(calls) == 1
                else "Invalid citation [S99]")
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
            assert (await chat.ask(request)).answer == "Invalid citation [S99]"
            analysis = AnalysisService(db=None, settings=settings, http=http, rag=object())
            news = ImpactBatchRunner(db_session=None, settings=settings, catalog={}, http=http, work_dir=tmp_path)
            assert analysis.llm.settings is settings
            assert analysis.llm.settings.LLM_MAX_RETRIES == 2
            assert news.llm.settings.LLM_MAX_RETRIES == 0
            await analysis.llm.text(system_prompt="Analysis", prompt="Evidence")
            result = await news.llm.generate(system_prompt=SYSTEM_PROMPT, payload={"title": "測試新聞"},
                                             schema=ImpactOutput)
            assert result.payload == {"events": [], "impacts": []}
            assert settings.LLM_MODEL == "shared-model"
            assert original_config == build_llm_runtime_config(settings, analysis.llm.model_name)

    asyncio.run(run())
    assert [body["model"] for body in calls] == ["shared-model"] * 4


def test_chat_uses_shared_model_with_default_chat_limits(settings):
    settings = configured(settings)
    service = ChatService(settings=settings, http=None, retrieval=FakeRetrieval())
    assert service.llm.model_name == settings.LLM_MODEL
    assert service.llm.settings is not settings
    assert service.llm.settings.LLM_MAX_TOKENS == 8192
    assert service.llm.settings.LLM_TIMEOUT_SECONDS == 60
    assert service.llm.settings.LLM_MAX_RETRIES == 0
