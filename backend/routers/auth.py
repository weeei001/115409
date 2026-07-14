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
    ChangePasswordRequest,
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

_AUTH_ERROR_RESPONSES = {
    400: {"description": "請求資料不合法或帳號狀態不允許此操作"},
    401: {"description": "認證失敗，帳號密碼或 token 無效"},
    403: {"description": "帳號已停用或沒有權限"},
    409: {"description": "帳號綁定或資料衝突"},
    422: {"description": "欄位驗證失敗"},
}


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


@router.post(
    "/register",
    response_model=TokenResponse,
    summary="註冊 email 密碼帳號",
    description=(
        "建立本地 email 密碼帳號並立即回傳 JWT。"
        "若 email 已存在會回傳 400；同一 email 不能重複註冊。"
    ),
    responses={
        200: {"description": "註冊成功並回傳登入 token"},
        400: {"description": "此 email 已註冊"},
        422: {"description": "email 或密碼格式驗證失敗"},
    },
)
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


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="使用 email 密碼登入",
    description="驗證本地密碼帳號後回傳 JWT。純 Google 帳號若尚未設定本地密碼，請使用 Google 登入或忘記密碼流程建立密碼。",
    responses={
        200: {"description": "登入成功"},
        401: {"description": "帳號或密碼錯誤"},
        403: {"description": "帳號已停用"},
        422: {"description": "欄位驗證失敗"},
    },
)
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


@router.post(
    "/google",
    response_model=TokenResponse,
    summary="使用 Google id_token 登入或註冊",
    description=(
        "驗證 Google Sign-In 的 `id_token` 後登入。"
        "若 email 已有本地帳號且尚未綁定 Google，系統會綁定同一帳號；"
        "若為新 email，會建立 Google 帳號。需先設定 `GOOGLE_CLIENT_ID`。"
    ),
    responses={
        200: {"description": "Google 登入成功"},
        400: {"description": "Google token 缺少必要欄位或 email 未驗證"},
        401: {"description": "Google token 驗證失敗"},
        403: {"description": "帳號已停用"},
        409: {"description": "email 已綁定其他 Google 帳號或建立帳號衝突"},
        503: {"description": "後端尚未設定 Google OAuth"},
        422: {"description": "欄位驗證失敗"},
    },
)
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


@router.get(
    "/me",
    response_model=UserPublic,
    summary="取得目前登入使用者",
    description="使用 `Authorization: Bearer <access_token>` 取得目前 token 對應的使用者資料。",
    responses={
        200: {"description": "成功取得使用者資料"},
        401: {"description": "未提供 token、token 無效或已過期"},
    },
)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


@router.post(
    "/change-password",
    response_model=MessageResponse,
    summary="變更目前登入帳號密碼",
    description=(
        "需登入。帳號必須已有本地密碼，系統會先驗證目前密碼，再更新為新密碼。"
        "純 Google 註冊且尚未建立本地密碼的帳號，請使用忘記密碼流程建立密碼。"
    ),
    responses={
        200: {"description": "密碼更新成功"},
        **_AUTH_ERROR_RESPONSES,
    },
)
def change_password(
    body: ChangePasswordRequest,
    user: Annotated[User, Depends(get_current_user)],
    db: Session = Depends(get_db),
) -> MessageResponse:
    """
    已登入且帳號已有本地密碼時，驗證目前密碼後更新為新密碼。
    純 Google 註冊（無本地密碼）請先透過忘記密碼流程建立密碼。
    """
    if not user.password_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="此帳號尚未設定本地密碼，無法由此變更",
        )
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="目前密碼錯誤",
        )
    if body.new_password == body.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="新密碼不可與目前密碼相同",
        )
    user.password_hash = hash_password(body.new_password)
    reset_crud.delete_all_for_user(db, user.id)
    db.commit()
    db.refresh(user)
    return MessageResponse(message="密碼已更新。")


@router.post(
    "/forgot-password",
    response_model=MessageResponse,
    summary="申請忘記密碼重設連結",
    description=(
        "不論 email 是否存在皆回 200，避免帳號探測。"
        "僅針對已啟用且已有本地密碼的帳號建立重設 token；純 Google 帳號不寄送重設信。"
    ),
    responses={
        200: {"description": "已接受申請；若帳號可重設密碼會寄送重設連結"},
        422: {"description": "email 格式驗證失敗"},
    },
)
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


@router.post(
    "/reset-password",
    response_model=MessageResponse,
    summary="使用重設 token 設定新密碼",
    description="驗證忘記密碼流程產生的 token 後設定新密碼。成功後會清除該使用者所有尚未使用的重設 token。",
    responses={
        200: {"description": "密碼重設成功"},
        400: {"description": "重設連結無效或已過期"},
        403: {"description": "帳號已停用"},
        422: {"description": "token 或新密碼格式驗證失敗"},
    },
)
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
