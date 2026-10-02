import hashlib

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db.models.notification import Notification, NotificationDelivery, NotificationPreference, PushDevice


def preference(db: Session, user_id: int):
    return db.get(NotificationPreference, user_id)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def device(db: Session, token: str):
    return db.scalar(select(PushDevice).where(PushDevice.token_hash == token_hash(token)).with_for_update())


def clear_deliveries(db: Session, device_id: int):
    db.execute(delete(NotificationDelivery).where(NotificationDelivery.device_id == device_id))


def delete_device(db: Session, user_id: int, token: str):
    row = device(db, token)
    if row is not None and row.user_id == user_id:
        clear_deliveries(db, row.id)
        db.delete(row)


def inbox(db: Session, user_id: int):
    return db.scalars(select(Notification).where(Notification.user_id == user_id)
                      .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(50)).all()
