from contextlib import ExitStack

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.core.streaming import encode_sse
from app.features.subscriptions.router import request_guest_subject
from app.features.subscriptions.service import AskQuota

from .schemas import AskRequest, AskResponse
from .service import ChatService
from .streaming import answer_events

router = APIRouter(tags=["chat"])


def wants_stream(http_request: Request) -> bool:
    """只有明確接受 SSE 的請求才串流；其他請求（含舊的 stream 欄位）維持一般 JSON。"""
    return "text/event-stream" in http_request.headers.get("accept", "")


def stream_answer(run, reservation: ExitStack) -> StreamingResponse:
    """reservation 是回應開始前已保留的提問額度：額度不足仍回 429，回答失敗時退回額度。"""
    async def guarded(on_delta):
        with reservation:
            return await run(on_delta)

    return StreamingResponse(
        encode_sse(answer_events(guarded)), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


def get_service(request: Request) -> ChatService:
    return ChatService(settings=request.app.state.settings, http=request.app.state.http,
                       session_factory=request.app.state.session_factory)


def get_guest_quota(request: Request, service: ChatService = Depends(get_service)) -> AskQuota:
    return AskQuota(service.session_factory, request_guest_subject(request))


@router.post("/api/ask", response_model=AskResponse, responses={429: {"description": "訪客的 AI 提問額度已用完"}})
async def ask(request: AskRequest, http_request: Request, service: ChatService = Depends(get_service),
              quota: AskQuota = Depends(get_guest_quota)):
    service.require_enabled()
    with ExitStack() as stack:
        stack.enter_context(quota.reserve())
        if wants_stream(http_request):
            return stream_answer(lambda on_delta: service.ask(request, on_delta=on_delta), stack.pop_all())
        return await service.ask(request)
