from sqlalchemy.orm import Session

from app.db.models.audit import AuditLog


def audit(db: Session, actor_id: int | None, actor_email: str | None,
          action: str, target: str, status: str, details: dict | None = None) -> None:
    """Append an event within the caller's transaction; never commit independently."""
    db.add(AuditLog(actor_id=actor_id, actor_email=actor_email, action=action[:80],
                    target=target[:255], status=status, details=details))
