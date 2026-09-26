from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from app.core.streaming import encode_sse
from .schemas import AskRequest, AskResponse
from .service import ChatService

router = APIRouter(tags=["chat"])


def get_service(request: Request) -> ChatService:
    return ChatService(settings=request.app.state.settings, http=request.app.state.http,
                       session_factory=request.app.state.session_factory)


@router.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest, service: ChatService = Depends(get_service)):
    service.require_enabled()
    if request.stream:
        return StreamingResponse(encode_sse(service.stream_events(request)), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    return await service.ask(request)
