import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, urlsplit, urlunsplit

import bcrypt
import jwt
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.clients import google_auth, mail
from app.core.config import Settings
from app.core.errors import AppError
from app.db.models.password_reset_token import PasswordResetToken
from app.db.models.user import User
from app.features.auth import repository
from app.features.auth.schemas import (
    ChangePasswordRequest, GoogleAuthRequest, LoginRequest, RegisterRequest,
    ResetPasswordRequest, TokenResponse, UserPublic,
)


FORGOT_OK_MESSAGE = "如果這個電子郵件已註冊，你會收到重設連結。"
# 前端會原樣顯示 detail：用「電子郵件」並給下一步（05 2.10）
EMAIL_TAKEN_MESSAGE = "這個電子郵件已註冊，請直接登入或使用「忘記密碼」。"
EMAIL_LINKED_MESSAGE = "這個電子郵件已綁定其他 Google 帳號，請改用原本的方式登入。"


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("ascii"))
    except (ValueError, UnicodeError):
        return False


def create_access_token(user_id: int, settings: Settings) -> tuple[str, int]:
    expires_in = settings.JWT_EXPIRE_MINUTES * 60
    token = jwt.encode(
        {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(seconds=expires_in)},
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )
    return token, expires_in


def token_response(user: User, settings: Settings) -> TokenResponse:
    token, expires_in = create_access_token(user.id, settings)
    return TokenResponse(access_token=token, expires_in=expires_in, user=UserPublic.model_validate(user))


def current_user(db: Session, token: str, settings: Settings) -> User:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, TypeError, ValueError, OverflowError):
        raise AppError("Invalid or expired token", status_code=401) from None
    user = repository.by_id(db, user_id)
    if user is None:
        raise AppError("User not found", status_code=401)
    _require_active(user)
    return user


def _require_active(user: User) -> None:
    if not user.is_active:
        raise AppError("User disabled", status_code=403)


def _commit(db: Session) -> None:
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def register(db: Session, body: RegisterRequest, settings: Settings) -> TokenResponse:
    if repository.by_email(db, str(body.email)):
        raise AppError(EMAIL_TAKEN_MESSAGE, status_code=400)
    user = User(
        email=str(body.email).strip().lower(),
        password_hash=hash_password(body.password),
        display_name=body.display_name,
    )
    db.add(user)
    try:
        _commit(db)
    except IntegrityError:
        raise AppError(EMAIL_TAKEN_MESSAGE, status_code=400) from None
    db.refresh(user)
    return token_response(user, settings)


def login(db: Session, body: LoginRequest, settings: Settings) -> TokenResponse:
    user = repository.by_email(db, str(body.email))
    if user is None or not user.password_hash or not verify_password(body.password, user.password_hash):
        raise AppError("帳號或密碼錯誤", status_code=401)
    _require_active(user)
    return token_response(user, settings)


def google_login(db: Session, body: GoogleAuthRequest, settings: Settings) -> TokenResponse:
    audiences = [value.strip() for value in settings.GOOGLE_CLIENT_ID.split(",") if value.strip()]
    if not audiences:
        raise AppError("Google OAuth not configured", status_code=503)
    info = google_auth.verify_google_id_token(body.id_token, audiences)
    sub, email = info.get("sub"), info.get("email")
    if not sub or not email:
        raise AppError("Google token missing sub or email", status_code=400)
    if not info.get("email_verified", False):
        raise AppError("Google email not verified", status_code=400)
    user = repository.by_google_sub(db, sub)
    if user:
        _require_active(user)
        return token_response(user, settings)
    user = repository.by_email(db, str(email))
    if user:
        if user.google_sub and user.google_sub != sub:
            raise AppError(EMAIL_LINKED_MESSAGE, status_code=409)
        _require_active(user)
        if not user.google_sub:
            user.google_sub = sub
            try:
                _commit(db)
            except IntegrityError:
                raise AppError(EMAIL_LINKED_MESSAGE, status_code=409) from None
    else:
        name = info.get("name")
        user = User(
            email=str(email).strip().lower(), google_sub=sub, password_hash=None,
            display_name=str(name)[:255] if name else None,
        )
        db.add(user)
        try:
            _commit(db)
        except IntegrityError:
            raise AppError("無法建立帳號（可能與既有帳號衝突）", status_code=409) from None
    db.refresh(user)
    return token_response(user, settings)


def change_password(db: Session, user: User, body: ChangePasswordRequest) -> str:
    if not user.password_hash:
        raise AppError("只用 Google 登入的帳號沒有密碼，無法在這裡變更。", status_code=400)
    if not verify_password(body.current_password, user.password_hash):
        raise AppError("目前密碼錯誤", status_code=400)
    if body.new_password == body.current_password:
        raise AppError("新密碼不可與目前密碼相同", status_code=400)
    user.password_hash = hash_password(body.new_password)
    repository.delete_reset_tokens(db, user.id)
    _commit(db)
    return "密碼已更新。"


def build_password_reset_link(base_url: str, raw: str) -> str:
    base = base_url.strip().rstrip("/")
    if not base:
        return ""
    parts = urlsplit(base)
    query = f"{parts.query}&" if parts.query else ""
    return urlunsplit((parts.scheme, parts.netloc, parts.path, query + "token=" + quote(raw, safe=""), parts.fragment))


def create_reset_token(db: Session, user_id: int, settings: Settings) -> str:
    raw = secrets.token_urlsafe(32)
    repository.delete_reset_tokens(db, user_id)
    db.add(PasswordResetToken(
        user_id=user_id, token_hash=hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        expires_at=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES),
    ))
    _commit(db)
    return raw


def forgot_password(db: Session, email: str, settings: Settings) -> str:
    user = repository.by_email(db, email)
    if user and user.password_hash and user.is_active:
        raw = create_reset_token(db, user.id, settings)
        link = build_password_reset_link(settings.FRONTEND_PASSWORD_RESET_URL, raw)
        if link:
            mail.send_password_reset_email(user.email, link, settings)
    return FORGOT_OK_MESSAGE


def reset_password(db: Session, body: ResetPasswordRequest) -> str:
    token_hash = hashlib.sha256(body.token.strip().encode("utf-8")).hexdigest()
    pair = repository.reset_token(db, token_hash, datetime.now(timezone.utc).replace(tzinfo=None))
    if pair is None:
        raise AppError("重設連結無效或已過期", status_code=400)
    user, _ = pair
    _require_active(user)
    user.password_hash = hash_password(body.new_password)
    repository.delete_reset_tokens(db, user.id)
    _commit(db)
    return "密碼已重設，請使用新密碼登入。"
