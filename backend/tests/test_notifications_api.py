from datetime import datetime, timedelta
from types import SimpleNamespace
import sys

import pytest
from sqlalchemy import select

from app.clients.fcm import FCMClient, InvalidPushToken, PushDeliveryError
from app.db.models.notification import Notification, NotificationDelivery, NotificationPreference, PushDevice
from app.db.models.user import User
from app.features.auth.service import create_access_token


def account(db, settings, email):
    user = User(email=email, is_active=True)
    db.add(user)
    db.commit()
    token, _ = create_access_token(user.id, settings)
    return user, {"Authorization": "Bearer " + token}


def test_preferences_are_opt_in_validated_and_private(client, db_session, settings):
    user, headers = account(db_session, settings, "a@example.com")
    _, other = account(db_session, settings, "b@example.com")
    defaults = client.get("/notifications/preferences", headers=headers).json()
    assert defaults == dict(daily_summary=False, price_alert=False, major_news=False,
                            price_threshold=5, quiet_start=22, quiet_end=8)
    changed = {**defaults, "major_news": True, "price_threshold": 3}
    assert client.put("/notifications/preferences", headers=headers, json=changed).json() == changed
    row = db_session.get(NotificationPreference, user.id)
    enabled = row.news_enabled_at
    assert enabled is not None
    assert client.put("/notifications/preferences", headers=headers, json=changed).status_code == 200
    assert row.news_enabled_at == enabled
    assert client.get("/notifications/preferences", headers=other).json() == defaults
    for field, value in (("price_threshold", 0), ("price_threshold", 31), ("quiet_start", 24), ("quiet_end", -1)):
        assert client.put("/notifications/preferences", headers=headers, json={**changed, field: value}).status_code == 422
    client.put("/notifications/preferences", headers=headers, json=defaults)
    assert row.news_enabled_at is None


def test_device_transfer_clears_previous_account_delivery(client, db_session, settings):
    user, headers = account(db_session, settings, "a@example.com")
    other_user, other = account(db_session, settings, "b@example.com")
    payload = {"token": "private-device-token", "platform": "web"}
    for _ in range(2):
        response = client.post("/notifications/devices", headers=headers, json=payload)
        assert response.status_code == 204 and not response.content
    device = db_session.scalar(select(PushDevice))
    notification = Notification(user_id=user.id, kind="major_news", title="News", body="Body",
                                url="/news", dedupe_key="news-a", expires_at=datetime.now() + timedelta(days=1))
    db_session.add(notification)
    db_session.flush()
    db_session.add(NotificationDelivery(notification_id=notification.id, device_id=device.id))
    db_session.commit()
    assert client.post("/notifications/devices", headers=other, json=payload).status_code == 204
    assert device.user_id == other_user.id
    assert db_session.scalar(select(NotificationDelivery)) is None
    assert client.request("DELETE", "/notifications/devices", headers=headers, json=payload).status_code == 204
    assert db_session.scalar(select(PushDevice)) is not None
    assert client.request("DELETE", "/notifications/devices", headers=other, json=payload).status_code == 204
    assert db_session.scalar(select(PushDevice)) is None


def test_inbox_is_private_limited_and_utc(client, db_session, settings):
    user, headers = account(db_session, settings, "a@example.com")
    other, other_headers = account(db_session, settings, "b@example.com")
    for i in range(53):
        db_session.add(Notification(user_id=user.id, kind="price_alert", title=str(i), body="Body",
                                    url="/stock/2330", dedupe_key=str(i), created_at=datetime(2026, 1, 1),
                                    expires_at=datetime(2026, 1, 2)))
    db_session.commit()
    items = client.get("/notifications/inbox", headers=headers).json()["items"]
    assert len(items) == 50 and items[0]["title"] == "52"
    assert items[0]["created_at"].endswith("Z")
    assert set(items[0]) == {"id", "kind", "title", "body", "url", "created_at"}
    assert client.get("/notifications/inbox", headers=other_headers).json() == {"items": []}


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/preferences", None), ("PUT", "/preferences", {}),
    ("POST", "/devices", {"token": "abc"}), ("DELETE", "/devices", {"token": "abc"}),
    ("GET", "/inbox", None),
])
def test_notification_routes_reject_anonymous_and_disabled_users(client, db_session, settings, method, path, payload):
    assert client.request(method, "/notifications" + path, json=payload).status_code == 403
    user, headers = account(db_session, settings, method + path.replace("/", "") + "@example.com")
    user.is_active = False
    db_session.commit()
    assert client.request(method, "/notifications" + path, headers=headers, json=payload).status_code == 403


def test_fcm_disabled_does_not_initialize(settings, monkeypatch):
    provider = FCMClient(settings)
    monkeypatch.setattr(provider, "_firebase_app", lambda: pytest.fail("Unexpected initialization"))
    with pytest.raises(PushDeliveryError, match="disabled"):
        provider.send(token="secret", title="Title", body="Body", url="/", notification_id=1)


def test_fcm_message_and_safe_errors(settings, monkeypatch):
    class Unregistered(Exception):
        pass

    class Mismatch(Exception):
        pass

    calls = []
    def send(message, app):
        calls.append(message)
        return "message-id"

    messaging = SimpleNamespace(Message=SimpleNamespace, Notification=SimpleNamespace,
                                AndroidConfig=SimpleNamespace, AndroidNotification=SimpleNamespace,
                                WebpushConfig=SimpleNamespace, WebpushNotification=SimpleNamespace,
                                WebpushFCMOptions=SimpleNamespace, send=send,
                                UnregisteredError=Unregistered, SenderIdMismatchError=Mismatch)
    monkeypatch.setitem(sys.modules, "firebase_admin", SimpleNamespace(messaging=messaging))
    settings.FCM_ENABLED = True
    settings.FCM_PROJECT_ID = "test-project"
    settings.FCM_WEB_ORIGIN = "https://stocks.example.com"
    provider = FCMClient(settings)
    monkeypatch.setattr(provider, "_firebase_app", lambda: object())
    payload = dict(token="secret", title="Title", body="Body", url="/stock/2330", notification_id=17)
    assert provider.send(**payload) == "message-id"
    assert calls[0].data == {"url": "/stock/2330", "notification_id": "17"}
    assert calls[0].webpush.fcm_options.link == "https://stocks.example.com/stock/2330"
    provider.send(**{**payload, "title": "台" * 200, "body": "股" * 3000})
    assert len(calls[-1].notification.title.encode("utf-8")) <= 300
    assert len(calls[-1].notification.body.encode("utf-8")) <= 2000
    for error, expected in ((Unregistered("secret"), InvalidPushToken), (Mismatch("secret"), InvalidPushToken),
                            (RuntimeError("secret"), PushDeliveryError)):
        def fail(*args, **kwargs):
            raise error
        messaging.send = fail
        with pytest.raises(expected) as raised:
            provider.send(**payload)
        assert "secret" not in str(raised.value)
    with pytest.raises(PushDeliveryError, match="local path"):
        provider.send(**{**payload, "url": "//evil.example"})
