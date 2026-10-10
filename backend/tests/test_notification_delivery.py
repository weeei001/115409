from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.clients.fcm import InvalidPushToken, PushDeliveryError
from app.db.models.favorite_stock import FavoriteStock
from app.db.models.notification import Notification, NotificationDelivery, NotificationPreference, PushDevice
from app.db.models.user import User
from app.features.notifications.delivery import dispatch_notifications
from app.jobs import notifications


NOW = datetime(2026, 10, 2, 9)


def setup(db, *, quiet_start=22, quiet_end=8):
    user = User(email="push@example.com", is_active=True)
    db.add(user)
    db.flush()
    preference = NotificationPreference(user_id=user.id, price_alert=True,
        quiet_start=quiet_start, quiet_end=quiet_end)
    favorite = FavoriteStock(user_id=user.id, symbol="2330")
    notice = Notification(user_id=user.id, kind="price_alert", symbol="2330", title="Price alert",
        body="2026-10-02 close +5%", url="/stock/2330", dedupe_key="x",
        created_at=NOW, expires_at=NOW + timedelta(hours=24))
    devices = [PushDevice(user_id=user.id, token=f"token-{i}", token_hash=str(i), platform="web",
        created_at=NOW - timedelta(days=1)) for i in range(2)]
    db.add_all([preference, favorite, notice, *devices])
    db.commit()
    return user, preference, favorite, notice, devices


class Sender:
    def __init__(self, failure=None):
        self.calls = []
        self.failure = failure

    def send(self, **kwargs):
        self.calls.append(kwargs)
        if self.failure and kwargs["token"] == "token-1":
            raise self.failure("safe error")
        return "message-id"


def test_per_device_retries_do_not_resend_success(db_session):
    _, _, _, notice, devices = setup(db_session)
    sender = Sender(PushDeliveryError)
    assert dispatch_notifications(db_session, sender, NOW) == {"sent": 1, "retry": 1, "invalid": 0}
    assert notice.delivered_at is None
    assert dispatch_notifications(db_session, sender, NOW + timedelta(seconds=30))["sent"] == 0
    sender.failure = None
    assert dispatch_notifications(db_session, sender, NOW + timedelta(minutes=3))["sent"] == 1
    assert [call["token"] for call in sender.calls] == ["token-0", "token-1", "token-1"]
    assert notice.delivered_at is not None
    assert dispatch_notifications(db_session, sender, NOW + timedelta(minutes=4))["sent"] == 0


def test_invalid_registration_is_removed(db_session):
    setup(db_session)
    sender = Sender(InvalidPushToken)
    assert dispatch_notifications(db_session, sender, NOW)["invalid"] == 1
    assert list(db_session.scalars(select(PushDevice.token))) == ["token-0"]
    assert len(list(db_session.scalars(select(NotificationDelivery)))) == 1


@pytest.mark.parametrize("reason", ["disabled", "inactive", "unfavorited", "expired", "quiet", "new_device"])
def test_delivery_rechecks_eligibility(db_session, reason):
    user, preference, favorite, notice, devices = setup(db_session)
    if reason == "disabled":
        preference.price_alert = False
    elif reason == "inactive":
        user.is_active = False
    elif reason == "unfavorited":
        db_session.delete(favorite)
    elif reason == "expired":
        notice.expires_at = NOW
    elif reason == "quiet":
        preference.quiet_start, preference.quiet_end = 16, 18
    else:
        for device in devices:
            device.created_at = NOW + timedelta(minutes=1)
    db_session.commit()
    sender = Sender()
    dispatch_notifications(db_session, sender, NOW)
    assert sender.calls == []


def test_quiet_notifications_do_not_block_another_user(db_session):
    _, preference, _, _, _ = setup(db_session, quiet_start=16, quiet_end=18)
    other = User(email="other@example.com", is_active=True)
    db_session.add(other)
    db_session.flush()
    db_session.add_all([
        NotificationPreference(user_id=other.id, price_alert=True, quiet_start=0, quiet_end=0),
        FavoriteStock(user_id=other.id, symbol="2330"),
        PushDevice(user_id=other.id, token="other", token_hash="other", platform="web", created_at=NOW),
        Notification(user_id=other.id, kind="price_alert", symbol="2330", title="Price", body="Change",
            url="/stock/2330", dedupe_key="y", created_at=NOW, expires_at=NOW + timedelta(hours=1)),
    ])
    db_session.commit()
    sender = Sender()
    assert dispatch_notifications(db_session, sender, NOW, limit=1)["sent"] == 1
    assert sender.calls[0]["token"] == "other"


def test_interrupted_claim_waits_for_lease_before_retry(db_session):
    _, _, _, notice, devices = setup(db_session)
    db_session.add(NotificationDelivery(notification_id=notice.id, device_id=devices[0].id,
        status="sending", attempts=1, next_attempt_at=NOW + timedelta(minutes=10)))
    db_session.commit()
    sender = Sender()
    assert dispatch_notifications(db_session, sender, NOW)["sent"] == 1
    assert sender.calls[0]["token"] == "token-1"
    assert dispatch_notifications(db_session, sender, NOW + timedelta(minutes=11))["sent"] == 1
    assert sender.calls[1]["token"] == "token-0"


def test_cli_no_execute_never_connects(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Must not connect")
    monkeypatch.setattr("app.db.engine.make_engine", forbidden)
    assert notifications.main([]) == 0
    with pytest.raises(SystemExit) as result:
        notifications.main(["--help"])
    assert result.value.code == 0


def test_interrupted_final_attempt_is_not_retried(db_session):
    _, _, _, notice, devices = setup(db_session)
    for device in devices:
        db_session.add(NotificationDelivery(notification_id=notice.id, device_id=device.id,
            status="sending", attempts=5, next_attempt_at=NOW))
    db_session.commit()
    sender = Sender()
    dispatch_notifications(db_session, sender, NOW)
    assert sender.calls == []
    assert notice.delivered_at == NOW
    assert all(item.status == "failed" for item in db_session.scalars(select(NotificationDelivery)))


def test_backoff_does_not_block_new_notifications(db_session):
    user, _, _, notice, devices = setup(db_session)
    for device in devices:
        db_session.add(NotificationDelivery(notification_id=notice.id, device_id=device.id,
            status="pending", attempts=1, next_attempt_at=NOW + timedelta(minutes=10)))
    later = Notification(user_id=user.id, kind="price_alert", symbol="2330", title="New alert",
        body="New change", url="/stock/2330", dedupe_key="later", created_at=NOW,
        expires_at=NOW + timedelta(hours=1))
    db_session.add(later)
    db_session.commit()
    sender = Sender()
    assert dispatch_notifications(db_session, sender, NOW, limit=1)["sent"] == 2
    assert all(call["notification_id"] == str(later.id) for call in sender.calls)


def test_device_disappearing_after_claim_does_not_send(db_session, monkeypatch):
    from app.features.notifications import delivery_repository
    setup(db_session)
    monkeypatch.setattr(delivery_repository, "locked_device", lambda *args: None)
    sender = Sender()
    dispatch_notifications(db_session, sender, NOW)
    assert sender.calls == []


def test_notification_tick_opt_in_interval_and_failure_isolation(settings, monkeypatch):
    from app.jobs.runtime import JobRuntime
    runtime = JobRuntime(settings, lambda: None)
    calls = []
    monkeypatch.setattr(runtime, "_worker", lambda command: calls.append(command) or 1)
    runtime._notification_tick()
    assert calls == []
    settings.NOTIFICATIONS_ENABLED = True
    runtime._notification_tick()
    runtime._notification_tick()
    assert calls == [["notifications", "--execute"]]
