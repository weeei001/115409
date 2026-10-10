from fastapi import APIRouter, Depends, Request

from .schemas import AskRequest, AskResponse
from .service import ChatService

router = APIRouter(tags=["chat"])


def get_service(request: Request) -> ChatService:
    return ChatService(settings=request.app.state.settings, http=request.app.state.http,
                       session_factory=request.app.state.session_factory)


@router.post("/api/ask", response_model=AskResponse)
async def ask(request: AskRequest, service: ChatService = Depends(get_service)):
    service.require_enabled()
    return await service.ask(request)
