from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint

from app.db.base import Base


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class NotificationPreference(Base):
    __tablename__ = "notification_preferences"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    daily_summary = Column(Boolean, nullable=False, default=False)
    price_alert = Column(Boolean, nullable=False, default=False)
    major_news = Column(Boolean, nullable=False, default=False)
    news_enabled_at = Column(DateTime, nullable=True)
    price_threshold = Column(Float, nullable=False, default=5.0)
    quiet_start = Column(Integer, nullable=False, default=22)
    quiet_end = Column(Integer, nullable=False, default=8)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class PushDevice(Base):
    __tablename__ = "push_devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token = Column(Text, nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True)
    platform = Column(String(16), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utcnow)


class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    kind = Column(String(32), nullable=False)
    symbol = Column(String(10), nullable=True)
    title = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    url = Column(String(2048), nullable=False)
    dedupe_key = Column(String(64), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    expires_at = Column(DateTime, nullable=False)
    delivered_at = Column(DateTime, nullable=True)
    __table_args__ = (
        UniqueConstraint("user_id", "dedupe_key", name="uq_notification_user_dedupe"),
        Index("idx_notification_user_created", "user_id", "created_at"),
    )


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    notification_id = Column(Integer, ForeignKey("notifications.id", ondelete="CASCADE"), primary_key=True)
    device_id = Column(Integer, ForeignKey("push_devices.id", ondelete="CASCADE"), primary_key=True)
    status = Column(String(16), nullable=False, default="pending")
    attempts = Column(Integer, nullable=False, default=0)
    next_attempt_at = Column(DateTime, nullable=False, default=utcnow)
    last_error = Column(String(255), nullable=True)
    sent_at = Column(DateTime, nullable=True)
