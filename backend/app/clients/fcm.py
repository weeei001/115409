"""Lazy Firebase transport. Importing this module never opens a connection."""

import hashlib
from datetime import timedelta
from threading import Lock
from urllib.parse import urlsplit

from app.core.config import Settings


class PushDeliveryError(Exception):
    """Retryable delivery or provider configuration failure with a safe message."""


class InvalidPushToken(PushDeliveryError):
    """The provider has permanently rejected this device registration."""


_app_lock = Lock()


def _bounded_text(value: str, max_bytes: int) -> str:
    encoded = value.encode("utf-8")
    return value if len(encoded) <= max_bytes else encoded[:max_bytes - 3].decode("utf-8", errors="ignore") + "…"


class FCMClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._app = None

    def _firebase_app(self):
        if self._app is not None:
            return self._app
        import firebase_admin
        from firebase_admin import credentials

        settings = self.settings
        key = hashlib.sha256((settings.FCM_PROJECT_ID + "\0" + settings.FCM_CREDENTIALS_FILE).encode()).hexdigest()[:20]
        with _app_lock:
            try:
                self._app = firebase_admin.get_app("stock-notifications-" + key)
            except ValueError:
                credential = credentials.Certificate(settings.FCM_CREDENTIALS_FILE) if settings.FCM_CREDENTIALS_FILE else credentials.ApplicationDefault()
                self._app = firebase_admin.initialize_app(
                    credential, {"projectId": settings.FCM_PROJECT_ID, "httpTimeout": 15},
                    name="stock-notifications-" + key,
                )
        return self._app

    def send(self, *, token: str, title: str, body: str, url: str, notification_id: int) -> str:
        if not self.settings.FCM_ENABLED:
            raise PushDeliveryError("Push delivery is disabled")
        origin = self.settings.FCM_WEB_ORIGIN.rstrip("/")
        parsed = urlsplit(origin)
        if not self.settings.FCM_PROJECT_ID or parsed.scheme != "https" or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
            raise PushDeliveryError("Firebase project and HTTPS web origin are required")
        if not url.startswith("/") or url.startswith("//") or "\\" in url:
            raise PushDeliveryError("Notification link must be a local path")
        try:
            from firebase_admin import messaging
            app = self._firebase_app()
            message = messaging.Message(
                token=token,
                notification=messaging.Notification(title=_bounded_text(title, 300), body=_bounded_text(body, 2000)),
                data={"url": url, "notification_id": str(notification_id)},
                android=messaging.AndroidConfig(ttl=timedelta(hours=1),
                    notification=messaging.AndroidNotification(tag="notification-" + str(notification_id))),
                webpush=messaging.WebpushConfig(
                    headers={"TTL": "3600"},
                    notification=messaging.WebpushNotification(tag="notification-" + str(notification_id)),
                    fcm_options=messaging.WebpushFCMOptions(link=origin + url),
                ),
            )
            try:
                return messaging.send(message, app=app)
            except (messaging.UnregisteredError, messaging.SenderIdMismatchError):
                raise InvalidPushToken("Device registration is no longer valid") from None
        except InvalidPushToken:
            raise
        except Exception:
            # Provider errors can include tokens or credential paths; do not retain them.
            raise PushDeliveryError("Firebase delivery failed") from None
