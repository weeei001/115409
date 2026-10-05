from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.security.utils import get_authorization_scheme_param
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import AppError
from app.db.models.user import User
from app.db.session import get_db
from app.features.auth import service
from app.features.auth.schemas import (
    ChangePasswordRequest, ForgotPasswordRequest, GoogleAuthRequest, LoginRequest,
    MessageResponse, RegisterRequest, ResetPasswordRequest, TokenResponse, UserPublic,
)


router = APIRouter(prefix="/auth", tags=["認證"])
security = HTTPBearer(auto_error=False)


def auth_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
    settings: Settings = Depends(auth_settings),
) -> User:
    if credentials is None:
        scheme, token = get_authorization_scheme_param(request.headers.get("Authorization"))
        detail = "Invalid authentication credentials" if scheme and token else "Not authenticated"
        raise AppError(detail, status_code=403)
    return service.current_user(db, credentials.credentials, settings)


Database = Annotated[Session, Depends(get_db)]
Configuration = Annotated[Settings, Depends(auth_settings)]
CurrentUser = Annotated[User, Depends(get_current_user)]


@router.post("/register", response_model=TokenResponse, responses={400: {}, 422: {}})
def register(body: RegisterRequest, db: Database, settings: Configuration):
    return service.register(db, body, settings)


@router.post("/login", response_model=TokenResponse, responses={401: {}, 403: {}, 422: {}})
def login(body: LoginRequest, db: Database, settings: Configuration):
    return service.login(db, body, settings)


@router.post("/google", response_model=TokenResponse, responses={400: {}, 401: {}, 403: {}, 409: {}, 503: {}, 422: {}})
def auth_google(body: GoogleAuthRequest, db: Database, settings: Configuration):
    return service.google_login(db, body, settings)


@router.get("/me", response_model=UserPublic, responses={401: {}})
def me(user: CurrentUser):
    return user


@router.post("/change-password", response_model=MessageResponse, responses={400: {}, 401: {}, 403: {}, 409: {}, 422: {}})
def change_password(body: ChangePasswordRequest, user: CurrentUser, db: Database):
    return {"message": service.change_password(db, user, body)}


@router.post("/forgot-password", response_model=MessageResponse, responses={422: {}})
def forgot_password(body: ForgotPasswordRequest, db: Database, settings: Configuration):
    return {"message": service.forgot_password(db, str(body.email), settings)}


@router.post("/reset-password", response_model=MessageResponse, responses={400: {}, 403: {}, 422: {}})
def reset_password(body: ResetPasswordRequest, db: Database):
    return {"message": service.reset_password(db, body.token, body.new_password)}
