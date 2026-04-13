from sqlalchemy.orm import Session

from auth.password import hash_password
from models.user import User


def normalize_email(email: str) -> str:
    return email.strip().lower()


def get_by_id(db: Session, user_id: int) -> User | None:
    return db.query(User).filter(User.id == user_id).first()


def get_by_email(db: Session, email: str) -> User | None:
    return db.query(User).filter(User.email == normalize_email(email)).first()


def get_by_google_sub(db: Session, google_sub: str) -> User | None:
    return db.query(User).filter(User.google_sub == google_sub).first()


def create_user_email_password(
    db: Session,
    *,
    email: str,
    password: str,
    display_name: str | None,
) -> User:
    user = User(
        email=normalize_email(email),
        password_hash=hash_password(password),
        display_name=display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_user_google(
    db: Session,
    *,
    email: str,
    google_sub: str,
    display_name: str | None,
) -> User:
    user = User(
        email=normalize_email(email),
        password_hash=None,
        google_sub=google_sub,
        display_name=display_name,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def link_google_sub(db: Session, user: User, google_sub: str) -> User:
    user.google_sub = google_sub
    db.commit()
    db.refresh(user)
    return user
