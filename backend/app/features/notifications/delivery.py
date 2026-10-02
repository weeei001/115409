"""Durable per-device delivery with bounded retries and preference checks."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy.exc import IntegrityError

from app.clients.fcm import InvalidPushToken, PushDeliveryError
from app.db.models.notification import NotificationDelivery
from . import delivery_repository as repository


def quiet_now(preference, now):
    hour = now.replace(tzinfo=timezone.utc).astimezone(ZoneInfo("Asia/Taipei")).hour
    start, end = preference.quiet_start, preference.quiet_end
    return (start <= hour < end if start < end else hour >= start or hour < end) if start != end else False


def dispatch_notifications(db, sender, now=None, *, limit=100, should_stop=lambda: False):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo:
        now = now.astimezone(timezone.utc).replace(tzinfo=None)
    stats = {"sent": 0, "retry": 0, "invalid": 0}
    repository.fail_exhausted(db, now)
    db.commit()
    for notification in repository.outstanding(db, now, limit):
        if should_stop():
            break
        user, preference = repository.recipient(db, notification)
        if (not user or not user.is_active or not preference
                or not getattr(preference, notification.kind, False)
                or not repository.still_favorited(db, notification)):
            notification.delivered_at = now
            db.commit()
            continue
        if quiet_now(preference, now):
            continue
        for device in repository.devices(db, notification):
            if should_stop():
                return stats
            item = repository.delivery(db, notification.id, device.id)
            if item is None:
                try:
                    with db.begin_nested():
                        db.add(NotificationDelivery(notification_id=notification.id, device_id=device.id,
                            status="pending", attempts=0, next_attempt_at=now))
                        db.flush()
                except IntegrityError:
                    pass
                db.commit()
            if not repository.claim(db, notification.id, device.id, now, now + timedelta(minutes=10)):
                continue
            db.commit()
            # Serialize dispatch with device transfer/removal and reread ownership.
            current_device = repository.locked_device(db, device.id, notification.user_id)
            item = repository.delivery(db, notification.id, device.id)
            if current_device is None or item is None:
                db.commit()
                continue
            try:
                sender.send(token=current_device.token, title=notification.title, body=notification.body,
                            url=notification.url, notification_id=str(notification.id))
            except InvalidPushToken:
                repository.invalidate_device(db, device.id)
                stats["invalid"] += 1
            except PushDeliveryError:
                item.status = "failed" if item.attempts >= 5 else "pending"
                item.last_error = "provider_unavailable"
                item.next_attempt_at = now + timedelta(seconds=min(3600, 60 * 2 ** item.attempts))
                stats["retry"] += 1
            else:
                item.status, item.sent_at, item.last_error = "sent", now, None
                stats["sent"] += 1
            db.commit()
        if not repository.pending(db, notification.id):
            notification.delivered_at = now
            db.commit()
    return stats
