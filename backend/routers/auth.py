from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.google_verify import verify_google_id_token
from auth.jwt import create_access_token
from auth.mail import send_password_reset_email
from auth.password import hash_password, verify_password
from auth.reset_link import build_password_reset_link
from config import get_settings
from crud import password_reset as reset_crud
from crud import user as user_crud
from database import get_db
from deps import get_current_user
from models.user import User
from schemas.auth import (
    ForgotPasswordRequest,
    GoogleAuthRequest,
    LoginRequest,
    MessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UserPublic,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["認證"])

_FORGOT_OK_MSG = "若此 email 已註冊且可重設密碼，您將收到重設連結。"


def _google_audiences() -> list[str]:
    s = (get_settings().GOOGLE_CLIENT_ID or "").strip()
    if not s:
        return []
    return [x.strip() for x in s.split(",") if x.strip()]


def _token_response(user: User) -> TokenResponse:
    token, expires_in = create_access_token(user.id)
    return TokenResponse(
        access_token=token,
        expires_in=expires_in,
        user=UserPublic.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse)
def register(body: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if user_crud.get_by_email(db, str(body.email)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此 email 已註冊",
        )
    try:
        user = user_crud.create_user_email_password(
            db,
            email=str(body.email),
            password=body.password,
            display_name=body.display_name,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此 email 已註冊",
        )
    return _token_response(user)


@router.post("/login", response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    user = user_crud.get_by_email(db, str(body.email))
    if user is None or not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤",
        )
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="帳號或密碼錯誤",
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User disabled",
        )
    return _token_response(user)


@router.post("/google", response_model=TokenResponse)
def auth_google(body: GoogleAuthRequest, db: Session = Depends(get_db)) -> TokenResponse:
    audiences = _google_audiences()
    if not audiences:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Google OAuth not configured",
        )
    try:
        idinfo = verify_google_id_token(body.id_token, audiences)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google token: {e}",
        )

    sub = idinfo.get("sub")
    email_raw = idinfo.get("email")
    email_verified = idinfo.get("email_verified", False)
    if not sub or not email_raw:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google token missing sub or email",
        )
    if not email_verified:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Google email not verified",
        )

    email = user_crud.normalize_email(str(email_raw))
    name = idinfo.get("name")
    display_name = str(name)[:255] if name else None

    user_by_sub = user_crud.get_by_google_sub(db, sub)
    if user_by_sub:
        if not user_by_sub.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User disabled",
            )
        return _token_response(user_by_sub)

    user_by_email = user_crud.get_by_email(db, email)
    if user_by_email:
        if user_by_email.google_sub and user_by_email.google_sub != sub:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="此 email 已綁定其他 Google 帳號",
            )
        if not user_by_email.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User disabled",
            )
        if not user_by_email.google_sub:
            user_crud.link_google_sub(db, user_by_email, sub)
        return _token_response(user_by_email)

    try:
        user = user_crud.create_user_google(
            db,
            email=email,
            google_sub=sub,
            display_name=display_name,
        )
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="無法建立帳號（可能與既有帳號衝突）",
        )
    return _token_response(user)


@router.get("/me", response_model=UserPublic)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


@router.post("/forgot-password", response_model=MessageResponse)
def forgot_password(body: ForgotPasswordRequest, db: Session = Depends(get_db)) -> MessageResponse:
    """
    不論 email 是否存在皆回 200，避免被用來探測註冊帳號。
    僅對「已有密碼」的帳號建立重設 token；純 Google 帳（無密碼）不寄信。
    """
    settings = get_settings()
    user = user_crud.get_by_email(db, str(body.email))
    if user and user.password_hash and user.is_active:
        raw = reset_crud.create_reset_token(db, user.id)
        link = build_password_reset_link(settings.FRONTEND_PASSWORD_RESET_URL, raw)
        if link:
            send_password_reset_email(user.email, link)
        elif settings.DEBUG:
            logger.info(
                "Password reset token (set FRONTEND_PASSWORD_RESET_URL for mail link): %s",
                raw,
            )
    return MessageResponse(message=_FORGOT_OK_MSG)


@router.post("/reset-password", response_model=MessageResponse)
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)) -> MessageResponse:
    pair = reset_crud.find_user_by_raw_token(db, body.token.strip())
    if pair is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="重設連結無效或已過期",
        )
    user, _row = pair
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User disabled",
        )
    user.password_hash = hash_password(body.new_password)
    reset_crud.delete_all_for_user(db, user.id)
    db.commit()
    db.refresh(user)
    return MessageResponse(message="密碼已重設，請使用新密碼登入。")
