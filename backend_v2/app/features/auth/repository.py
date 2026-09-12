from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models.password_reset_token import PasswordResetToken
from app.db.models.user import User


def by_id(db: Session, user_id: int) -> User | None:
    return db.get(User, user_id)


def by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email.strip().lower()))


def by_google_sub(db: Session, sub: str) -> User | None:
    return db.scalar(select(User).where(User.google_sub == sub))


def delete_reset_tokens(db: Session, user_id: int) -> None:
    db.execute(delete(PasswordResetToken).where(PasswordResetToken.user_id == user_id))


def reset_token(db: Session, token_hash: str, now: datetime):
    # Lock the token until password update and deletion commit together.
    return db.execute(
        select(User, PasswordResetToken)
        .join(PasswordResetToken, PasswordResetToken.user_id == User.id)
        .where(PasswordResetToken.token_hash == token_hash, PasswordResetToken.expires_at > now)
        .with_for_update()
    ).first()
