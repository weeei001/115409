import asyncio
from types import SimpleNamespace

from app.clients.llm import LlmResult
from app.features.chat.schemas import AskResponse, SourceChunk
from app.features.chat.service import ChatService

VALID = "Revenue increased.[S1]"
REJECTED = "Private rejected draft.[S99]"
METADATA = {"finish_reason": "stop", "prompt_tokens": 20, "completion_tokens": 8, "reasoning_tokens": 3,
            "private_debug": "provider-private-secret", "reasoning_content": "hidden-chain-of-thought"}


def response():
    return AskResponse(answer="", detected_stocks=[], time_range=None,
        sources=[SourceChunk(citation_id="S1", title="Quarterly report", source="test", source_name="Report",
                             pub_time="2026-10-08", url="", stock_id="", content="Revenue increased.", score=1)],
        tokens={"input": 7, "output": 2, "thinking": None}, duration_ms=0, current_time="now")


def service(factory, answers=(VALID,), *, timeout=60, text_error=None):
    pending = list(answers)
    calls = []

    async def text(**kwargs):
        calls.append("answer")
        if text_error:
            raise text_error
        answer = pending.pop(0)
        if answer is None:
            await asyncio.Event().wait()
        if isinstance(answer, tuple):
            return LlmResult({}, answer[0], answer[1])
        return LlmResult({}, answer, METADATA)

    llm = SimpleNamespace(require_enabled=lambda: None, text=text,
                          model_name="test-model", settings=SimpleNamespace(LLM_MAX_TOKENS=4096))
    chat = ChatService(http=None, settings=None, retrieval=object(), llm=llm, session_factory=factory)
    chat.request_timeout_seconds = timeout

    async def prepare(request):
        return response(), "This private prompt is not persisted.", ""

    chat._prepare = prepare
    return chat, calls
