"""Environment-local administrator membership, job state and audit records."""
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text

from app.db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class AdminAccount(Base):
    __tablename__ = "admin_accounts"
    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class AdminJobControl(Base):
    __tablename__ = "admin_job_controls"
    job_name = Column(String(80), primary_key=True)
    paused = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


class AdminJobRun(Base):
    __tablename__ = "admin_job_runs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    job_name = Column(String(80), nullable=False, index=True)
    status = Column(String(20), nullable=False, index=True)
    trigger = Column(String(20), nullable=False)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    symbol = Column(String(10), nullable=True)
    retry_of = Column(Integer, ForeignKey("admin_job_runs.id"), nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    exit_code = Column(Integer, nullable=True)
    error = Column(Text, nullable=True)


class AdminAuditLog(Base):
    __tablename__ = "admin_audit_logs"
    id = Column(Integer, primary_key=True, autoincrement=True)
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    actor_email = Column(String(255), nullable=True)
    action = Column(String(80), nullable=False)
    target = Column(String(255), nullable=False)
    status = Column(String(20), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now, index=True)
    details = Column(JSON, nullable=True)
