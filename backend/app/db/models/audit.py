"""Audit records shared by user and administrator operations."""
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AuditLog(Base):
    __tablename__ = "audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_email = Column(String(255), nullable=True)
    action = Column(String(80), nullable=False)
    target = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    details = Column(JSON, nullable=True)
