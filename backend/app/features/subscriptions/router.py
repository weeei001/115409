from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.db.models.user import User
from app.features.auth import service as auth_service
from app.features.auth.router import Configuration, CurrentUser, Database
from app.features.subscriptions import service
from app.features.subscriptions.schemas import ActivateSubscriptionRequest, SubscriptionStatus


router = APIRouter(prefix="/subscription", tags=["方案與額度"])
security = HTTPBearer(auto_error=False)


def optional_user(db: Database, settings: Configuration,
                  credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> User | None:
    if credentials is None:
        return None
    return auth_service.current_user(db, credentials.credentials, settings)


def request_guest_subject(request: Request) -> str:
    """Guests are counted per client address. Behind a reverse proxy, run uvicorn with --proxy-headers."""
    address = request.client.host if request.client else "unknown"
    return service.guest_subject(address, request.app.state.settings.JWT_SECRET)


OptionalUser = Annotated[User | None, Depends(optional_user)]


@router.get("", response_model=SubscriptionStatus, responses={401: {}})
def get_subscription(request: Request, user: OptionalUser, db: Database):
    """目前方案、AI 提問額度與用量。不帶登入時回傳訪客的免費版額度。"""
    return service.status(db, user, request_guest_subject(request))


@router.put("", response_model=SubscriptionStatus, responses={401: {}, 403: {}, 422: {}})
def activate_subscription(body: ActivateSubscriptionRequest, user: CurrentUser, db: Database):
    """模擬開通付費方案（展示用，不經金流）。換方案或繳費週期時，開通日重新起算。"""
    return service.activate(db, user, body)


@router.delete("", response_model=SubscriptionStatus, responses={401: {}, 403: {}})
def cancel_subscription(user: CurrentUser, db: Database):
    """恢復免費版；收藏與對話紀錄都保留。"""
    return service.cancel(db, user)
