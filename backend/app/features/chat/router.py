from fastapi import APIRouter, Depends, Request

from app.features.subscriptions.router import request_guest_subject
from app.features.subscriptions.service import AskQuota

from .schemas import AskRequest, AskResponse
from .service import ChatService

router = APIRouter(tags=["chat"])


def get_service(request: Request) -> ChatService:
    return ChatService(settings=request.app.state.settings, http=request.app.state.http,
                       session_factory=request.app.state.session_factory)


def get_guest_quota(request: Request, service: ChatService = Depends(get_service)) -> AskQuota:
    return AskQuota(service.session_factory, request_guest_subject(request))


@router.post("/api/ask", response_model=AskResponse, responses={429: {"description": "訪客的 AI 提問額度已用完"}})
async def ask(request: AskRequest, service: ChatService = Depends(get_service), quota: AskQuota = Depends(get_guest_quota)):
    service.require_enabled()
    with quota.reserve():
        return await service.ask(request)
