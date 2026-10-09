from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.errors import AuthenticationFailed
from app.core.streaming import encode_sse
from app.db.models.user import User
from app.features.auth import service as auth_service
from app.features.auth.router import Configuration, Database
from app.features.chat.router import get_service as get_chat_service
from app.features.chat.schemas import AskRequest, AskResponse

from .schemas import ConversationDetail, ConversationList, MessageFeedback, MessageFeedbackRequest
from .service import ConversationService


router = APIRouter(prefix="/api/conversations", tags=["conversations"])
security = HTTPBearer(auto_error=False)


def current_user(db: Database, settings: Configuration,
                 credentials: HTTPAuthorizationCredentials | None = Depends(security)):
    if credentials is None:
        raise AuthenticationFailed()
    return auth_service.current_user(db, credentials.credentials, settings)


def get_service(request: Request, chat=Depends(get_chat_service)):
    return ConversationService(request.app.state.session_factory, chat)


CurrentUser = Annotated[User, Depends(current_user)]
Service = Annotated[ConversationService, Depends(get_service)]


@router.get("", response_model=ConversationList)
def list_conversations(user: CurrentUser, service: Service, q: str = Query("", max_length=200),
                       offset: int = Query(0, ge=0), limit: int = Query(30, ge=1, le=100)):
    return service.list(user.id, q, offset, limit)


@router.post("", response_model=ConversationDetail, status_code=201)
def create_conversation(user: CurrentUser, service: Service):
    return service.create(user.id)


@router.get("/{conversation_id}", response_model=ConversationDetail)
def get_conversation(conversation_id: UUID, user: CurrentUser, service: Service):
    return service.get(user.id, str(conversation_id))


@router.delete("/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: UUID, user: CurrentUser, service: Service):
    service.delete(user.id, str(conversation_id))


@router.put("/{conversation_id}/messages/{message_id}/feedback", response_model=MessageFeedback)
def rate_message(conversation_id: UUID, message_id: UUID, body: MessageFeedbackRequest,
                 user: CurrentUser, service: Service):
    return service.rate(user.id, str(conversation_id), str(message_id), body.rating)


@router.delete("/{conversation_id}/messages/{message_id}/feedback", response_model=MessageFeedback)
def clear_message_rating(conversation_id: UUID, message_id: UUID, user: CurrentUser, service: Service):
    return service.rate(user.id, str(conversation_id), str(message_id), None)


@router.post("/{conversation_id}/ask", response_model=AskResponse)
async def ask_conversation(conversation_id: UUID, body: AskRequest, user: CurrentUser, service: Service):
    service.chat.require_enabled()
    turn_id, request = service.begin(user.id, str(conversation_id), body)
    if body.stream:
        return StreamingResponse(encode_sse(service.stream_events(str(conversation_id), turn_id, request)),
                                 media_type="text/event-stream",
                                 headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    return await service.ask(str(conversation_id), turn_id, request)
