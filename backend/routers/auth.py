from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.google_verify import verify_google_id_token
from auth.jwt import create_access_token
from auth.password import verify_password
from config import get_settings
from crud import user as user_crud
from database import get_db
from deps import get_current_user
from models.user import User
from schemas.auth import (
    GoogleAuthRequest,
    LoginRequest,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

router = APIRouter(prefix="/auth", tags=["認證"])


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
