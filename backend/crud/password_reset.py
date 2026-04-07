"""Password reset tokens (raw token only returned once; DB stores SHA256 hex)."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from config import get_settings
from models.password_reset_token import PasswordResetToken
from models.user import User


def _hash_raw_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _utc_now_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def delete_all_for_user(db: Session, user_id: int) -> None:
    db.query(PasswordResetToken).filter(PasswordResetToken.user_id == user_id).delete(
        synchronize_session=False,
    )


def create_reset_token(db: Session, user_id: int) -> str:
    """建立新 token，並使該使用者既有 token 失效。回傳明文 token（僅此一次可傳給使用者）。"""
    settings = get_settings()
    raw = secrets.token_urlsafe(32)
    token_hash = _hash_raw_token(raw)
    exp = _utc_now_naive() + timedelta(minutes=settings.PASSWORD_RESET_EXPIRE_MINUTES)

    delete_all_for_user(db, user_id)
    db.flush()
    row = PasswordResetToken(user_id=user_id, token_hash=token_hash, expires_at=exp)
    db.add(row)
    db.commit()
    return raw


def find_user_by_raw_token(db: Session, raw: str) -> tuple[User, PasswordResetToken] | None:
    """若 token 有效回傳 (user, row)；否則 None。"""
    token_hash = _hash_raw_token(raw)
    now = _utc_now_naive()
    row = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.token_hash == token_hash,
            PasswordResetToken.expires_at > now,
        )
        .first()
    )
    if row is None:
        return None
    user = db.query(User).filter(User.id == row.user_id).first()
    if user is None:
        return None
    return user, row
