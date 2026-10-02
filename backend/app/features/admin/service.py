from datetime import datetime, timezone
from threading import RLock

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models.admin import AdminAccount, AdminAuditLog
from app.db.models.user import User
from app.features.admin import repository
from app.features.admin.schemas import AuditPublic, RunPublic
from app.features.admin.diagnostics import run_diagnostics


# ponytail: one API process serializes membership changes; database row locks also protect separate processes.
_administrators_lock = RLock()


def require_admin(db: Session, user: User) -> None:
    if not user.is_active or not repository.is_admin(db, user.id):
        raise AppError("Administrator access required", 403)


def audit(db: Session, actor_id: int | None, actor_email: str | None,
          action: str, target: str, status: str, details: dict | None = None) -> None:
    db.add(AdminAuditLog(actor_id=actor_id, actor_email=actor_email, action=action[:80],
                         target=target[:255], status=status, details=details))


def _commit(db: Session) -> None:
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def _failed(db: Session, actor: tuple[int | None, str | None], action: str, target: str, error: Exception) -> None:
    db.rollback()
    reason = str(error.detail)[:500] if isinstance(error, AppError) else type(error).__name__
    audit(db, *actor, action, target, "failed", {"reason": reason})
    _commit(db)


def record_denied(db: Session, user: User, path: str) -> None:
    audit(db, user.id, user.email, "access.denied", path[:255], "failed")
    _commit(db)


def _lock_actor(db: Session, actor_id: int):
    accounts = repository.administrators(db, lock=True)
    if not any(account.user_id == actor_id and user.is_active for account, user in accounts):
        raise AppError("Administrator access required", 403)
    return accounts


def list_administrators(db: Session) -> dict:
    items = [{"user_id": account.user_id, "email": user.email, "display_name": user.display_name,
              "is_active": user.is_active, "created_at": account.created_at.replace(tzinfo=timezone.utc)}
             for account, user in repository.administrators(db)]
    return {"items": items, "total": len(items)}


def grant_administrator(db: Session, actor: User, email: str) -> dict:
    actor_snapshot = (actor.id, actor.email)
    target = email.strip().lower()
    with _administrators_lock:
        try:
            accounts = _lock_actor(db, actor_snapshot[0])
            user = repository.account_by_email(db, target)
            if user is None:
                raise AppError("Account not found", 404)
            if not user.is_active:
                raise AppError("Account is disabled", 409)
            if any(account.user_id == user.id for account, _ in accounts):
                raise AppError("Account is already an administrator", 409)
            db.add(AdminAccount(user_id=user.id))
            audit(db, *actor_snapshot, "administrator.grant", str(user.id), "succeeded", {"email": target})
            _commit(db)
        except (AppError, SQLAlchemyError) as exc:
            _failed(db, actor_snapshot, "administrator.grant", target, exc)
            raise
    return {"message": "Administrator granted", "run_id": None}


def revoke_administrator(db: Session, actor: User, user_id: int) -> dict:
    actor_snapshot = (actor.id, actor.email)
    with _administrators_lock:
        try:
            accounts = _lock_actor(db, actor_snapshot[0])
            pair = next(((account, user) for account, user in accounts if account.user_id == user_id), None)
            if pair is None:
                raise AppError("Administrator not found", 404)
            account, user = pair
            if user.is_active and sum(bool(member.is_active) for _, member in accounts) <= 1:
                raise AppError("The last active administrator cannot be revoked", 409)
            db.delete(account)
            audit(db, *actor_snapshot, "administrator.revoke", str(user_id), "succeeded", {"email": user.email})
            _commit(db)
        except (AppError, SQLAlchemyError) as exc:
            _failed(db, actor_snapshot, "administrator.revoke", str(user_id), exc)
            raise
    return {"message": "Administrator revoked", "run_id": None}


def bootstrap_administrator(db: Session, email: str) -> int:
    """Explicit CLI-only grant; no automatic privilege for the first registered user."""
    target = email.strip().lower()
    with _administrators_lock:
        try:
            accounts = repository.administrators(db, lock=True)
            user = repository.account_by_email(db, target)
            if user is None or not user.is_active:
                raise AppError("An existing active account is required", 400)
            user_id = user.id
            changed = not any(account.user_id == user_id for account, _ in accounts)
            if changed:
                db.add(AdminAccount(user_id=user_id))
            audit(db, None, None, "administrator.bootstrap", str(user_id), "succeeded",
                  {"email": target, "changed": changed, "source": "cli"})
            _commit(db)
        except (AppError, SQLAlchemyError) as exc:
            _failed(db, (None, None), "administrator.bootstrap", target, exc)
            raise
    return user_id


def perform_job(db: Session, actor: User, runtime, job_name: str, action: str, run_id: int | None, symbol: str | None = None) -> dict:
    actor_snapshot = (actor.id, actor.email)
    audit_action = f"job.{action}"[:80]
    target = job_name[:255]
    with _administrators_lock:
        try:
            _lock_actor(db, actor_snapshot[0])
            if runtime is None:
                raise AppError("Job scheduler unavailable", 503)
            with runtime.lock:
                run = runtime.perform(db, actor, job_name, action, run_id=run_id, symbol=symbol)
                queued_id = run.id if run is not None else None
                audit(db, *actor_snapshot, audit_action, target, "succeeded",
                      {"run_id": queued_id, "retry_of": run_id, "symbol": run.symbol if run is not None else None})
                _commit(db)
                runtime.apply_control(job_name, action, queued_id)
        except (AppError, SQLAlchemyError) as exc:
            _failed(db, actor_snapshot, audit_action, target, exc)
            raise
    return {"message": "Job action accepted", "run_id": queued_id}


def public_run(row, live=None) -> dict:
    item = RunPublic.model_validate(row)
    if item.started_at:
        item.duration_seconds = max(0, ((item.finished_at or datetime.now(timezone.utc)) - item.started_at).total_seconds())
    item.diagnostics = run_diagnostics(row, live)
    return item.model_dump(mode="json")


def get_run(db: Session, run_id: int, runtime=None) -> dict:
    row = repository.run_by_id(db, run_id)
    if row is None:
        raise AppError("Job run not found", 404)
    live = runtime.snapshot().get("run_activity", {}).get(row.job_name) if runtime else None
    return public_run(row, live)


def list_runs(db: Session, limit: int = 20, offset: int = 0, job_name: str | None = None, runtime=None) -> dict:
    rows, total = repository.runs(db, limit, offset, job_name)
    activity = runtime.snapshot().get("run_activity", {}) if runtime else {}
    items = [public_run(row, activity.get(row.job_name)) for row in rows]
    return {"items": items, "total": total}


def list_audit(db: Session, limit: int = 20, offset: int = 0) -> dict:
    rows, total = repository.audit_logs(db, limit, offset)
    return {"items": [AuditPublic.model_validate(row).model_dump(mode="json") for row in rows], "total": total}


def overview(db: Session, runtime, environment: str) -> dict:
    snapshot = runtime.snapshot() if runtime else {"status": "unavailable", "heartbeat": None, "error": None, "jobs": []}
    services = [{"name": "api", "status": "healthy", "detail": None},
                {"name": "scheduler", "status": snapshot["status"], "detail": snapshot.get("error")}]
    try:
        repository.ping(db)
        services.append({"name": "database", "status": "healthy", "detail": None})
    except SQLAlchemyError as exc:
        db.rollback()
        services.append({"name": "database", "status": "unhealthy", "detail": type(exc).__name__})
        return {"environment": environment, "checked_at": datetime.now(timezone.utc), "services": services,
                "scheduler": {key: snapshot.get(key) for key in ("status", "heartbeat", "error")},
                "jobs": snapshot["jobs"], "recent_runs": []}
    jobs = []
    for job in snapshot["jobs"]:
        succeeded, failed, streak, total = repository.job_results(db, job["name"])
        active = repository.run_by_id(db, job["active_run_id"]) if job.get("active_run_id") else None
        queued = repository.run_by_id(db, job["queued_run_id"]) if job.get("queued_run_id") else None
        live = snapshot.get("run_activity", {}).get(job["name"])
        jobs.append({**job, "active_run": public_run(active, live) if active else None,
            "queued_run": public_run(queued) if queued else None, "result_summary": {"history_scope": "all_stored_runs", "terminal_runs": total,
            "last_success": public_run(succeeded) if succeeded else None,
            "last_failure": public_run(failed) if failed else None, "consecutive_failed": streak}})
    return {"environment": environment, "checked_at": datetime.now(timezone.utc), "services": services,
            "scheduler": {key: snapshot.get(key) for key in ("status", "heartbeat", "error")},
            "jobs": jobs, "recent_runs": list_runs(db, 10, runtime=runtime)["items"]}
