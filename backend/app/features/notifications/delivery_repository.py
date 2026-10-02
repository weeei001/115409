"""Notification delivery queries; transactions belong to the dispatcher."""
from datetime import timezone
from zoneinfo import ZoneInfo

from sqlalchemy import and_, delete, or_, select, update

from app.db.models.favorite_stock import FavoriteStock
from app.db.models.notification import Notification, NotificationDelivery, NotificationPreference, PushDevice
from app.db.models.user import User


def outstanding(db, now, limit):
    hour = now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Taipei")).hour
    p = NotificationPreference
    outside_quiet = or_(p.user_id.is_(None), p.quiet_start == p.quiet_end,
        and_(p.quiet_start < p.quiet_end, or_(hour < p.quiet_start, hour >= p.quiet_end)),
        and_(p.quiet_start > p.quiet_end, hour < p.quiet_start, hour >= p.quiet_end))
    waiting = select(NotificationDelivery.device_id).where(
        NotificationDelivery.notification_id == Notification.id,
        NotificationDelivery.status.in_(["pending", "sending"])).correlate(Notification)
    has_delivery = select(NotificationDelivery.device_id).where(
        NotificationDelivery.notification_id == Notification.id,
        NotificationDelivery.device_id == PushDevice.id).correlate(Notification, PushDevice)
    unattempted = select(PushDevice.id).where(PushDevice.user_id == Notification.user_id,
        PushDevice.created_at <= Notification.created_at, ~has_delivery.exists()).correlate(Notification)
    ready = or_(~waiting.exists(), waiting.where(NotificationDelivery.next_attempt_at <= now).exists(),
                unattempted.exists())
    return list(db.scalars(select(Notification).outerjoin(p, p.user_id == Notification.user_id).where(
        Notification.expires_at > now, Notification.delivered_at.is_(None), outside_quiet, ready
    ).order_by(Notification.id).limit(limit)))


def recipient(db, notification):
    return db.get(User, notification.user_id), db.get(NotificationPreference, notification.user_id)


def still_favorited(db, notification):
    query = select(FavoriteStock.id).where(FavoriteStock.user_id == notification.user_id)
    if notification.symbol:
        query = query.where(FavoriteStock.symbol == notification.symbol)
    return db.scalar(query.limit(1)) is not None


def devices(db, notification):
    # Newly registered devices do not receive an old backlog.
    return list(db.scalars(select(PushDevice).where(
        PushDevice.user_id == notification.user_id,
        PushDevice.created_at <= notification.created_at)))


def delivery(db, notification_id, device_id):
    return db.scalar(select(NotificationDelivery).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.device_id == device_id).execution_options(populate_existing=True))


def locked_device(db, device_id, user_id):
    return db.scalar(select(PushDevice).where(PushDevice.id == device_id,
        PushDevice.user_id == user_id).with_for_update().execution_options(populate_existing=True))


def fail_exhausted(db, now):
    db.execute(update(NotificationDelivery).where(
        NotificationDelivery.status.in_(["pending", "sending"]),
        NotificationDelivery.attempts >= 5,
        NotificationDelivery.next_attempt_at <= now,
    ).values(status="failed", last_error="attempt_limit"))


def claim(db, notification_id, device_id, now, lease_until):
    result = db.execute(update(NotificationDelivery).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.device_id == device_id,
        NotificationDelivery.status.in_(["pending", "sending"]),
        NotificationDelivery.attempts < 5,
        NotificationDelivery.next_attempt_at <= now,
    ).values(status="sending", next_attempt_at=lease_until,
             attempts=NotificationDelivery.attempts + 1))
    return result.rowcount == 1


def invalidate_device(db, device_id):
    db.execute(delete(NotificationDelivery).where(NotificationDelivery.device_id == device_id))
    db.execute(delete(PushDevice).where(PushDevice.id == device_id))


def pending(db, notification_id):
    return db.scalar(select(NotificationDelivery.device_id).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.status.in_(["pending", "sending"])).limit(1)) is not None
