from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.db.models.notification import NotificationPreference, PushDevice, utcnow
from app.db.models.user import User
from app.features.notifications import repository
from app.features.notifications.schemas import NotificationInbox, NotificationItem, NotificationPreferences, RegisterDevice


def _commit(db: Session):
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def get_preferences(db: Session, user: User) -> NotificationPreferences:
    row = repository.preference(db, user.id)
    return NotificationPreferences.model_validate(row) if row else NotificationPreferences()


def update_preferences(db: Session, user: User, body: NotificationPreferences):
    user_id = user.id
    for attempt in range(2):
        row = repository.preference(db, user_id)
        if row is None:
            row = NotificationPreference(user_id=user_id)
            db.add(row)
        if body.major_news and not row.major_news:
            row.news_enabled_at = utcnow()
        elif not body.major_news:
            row.news_enabled_at = None
        for key, value in body.model_dump().items():
            setattr(row, key, value)
        try:
            _commit(db)
            return body
        except IntegrityError:
            if attempt:
                raise


def register_device(db: Session, user: User, body: RegisterDevice):
    user_id = user.id
    for attempt in range(2):
        row = repository.device(db, body.token)
        if row is None:
            row = PushDevice(user_id=user_id, token=body.token,
                             token_hash=repository.token_hash(body.token), platform=body.platform)
            db.add(row)
        else:
            if row.user_id != user_id:
                # A shared browser must never receive queued messages for its previous account.
                repository.clear_deliveries(db, row.id)
                row.created_at = utcnow()
            row.user_id, row.platform = user_id, body.platform
        try:
            _commit(db)
            return
        except IntegrityError:
            if attempt:
                raise


def remove_device(db: Session, user: User, token: str):
    repository.delete_device(db, user.id, token)
    _commit(db)


def get_inbox(db: Session, user: User):
    return NotificationInbox(items=[NotificationItem.model_validate(row) for row in repository.inbox(db, user.id)])
