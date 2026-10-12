from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, PrimaryKeyConstraint, String

from app.db.base import Base


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class UserSubscription(Base):
    """A paid plan for one user; users without a row are on the free plan."""

    __tablename__ = "user_subscriptions"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    plan = Column(String(16), nullable=False)
    billing = Column(String(16), nullable=False)
    # Asia/Taipei calendar date the plan started; renewal dates are derived from it.
    started_on = Column(Date, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utcnow)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)


class AiAskUsage(Base):
    """AI chat questions per subject and Asia/Taipei day; monthly usage is the sum over the month."""

    __tablename__ = "ai_ask_usage"

    # "user:<id>", or "guest:<keyed hash of the client address>" so raw addresses are never stored.
    subject = Column(String(64), nullable=False)
    day = Column(Date, nullable=False)
    count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, nullable=False, default=utcnow, onupdate=utcnow)

    __table_args__ = (PrimaryKeyConstraint("subject", "day", name="pk_ai_ask_usage"),)
