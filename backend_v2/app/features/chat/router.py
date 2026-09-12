import json
from contextlib import aclosing

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from .schemas import AskRequest, AskResponse
from .service import ChatService

router = APIRouter(tags=["chat"])


def get_service(request: Request) -> ChatService:
    return ChatService(settings=request.app.state.settings, http=request.app.state.http,
                       session_factory=request.app.state.session_factory)


async def _sse(events):
    async with aclosing(events):
        async for event in events:
            yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest, service: ChatService = Depends(get_service)):
    service.require_enabled()
    if request.stream:
        return StreamingResponse(_sse(service.stream_events(request)), media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    return await service.ask(request)
