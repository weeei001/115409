from datetime import datetime, timedelta
from threading import RLock

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.errors import AppError
from app.db.models.admin import AdminAccount, AdminAuditLog, AdminJobControl, AdminJobRun
from app.db.models.user import User
from app.features.admin import service
from app.features.auth.service import create_access_token


def account(db, settings, email, *, administrator=False, active=True):
    user = User(email=email, is_active=active)
    db.add(user)
    db.commit()
    if administrator:
        service.bootstrap_administrator(db, email)
    token, _ = create_access_token(user.id, settings)
    return user, {"Authorization": f"Bearer {token}"}


class FakeRuntime:
    def __init__(self):
        self.lock = RLock()
        self.paused = False

    def snapshot(self):
        return {"status": "running", "heartbeat": None, "error": None,
                "jobs": [{"name": "sample", "label": "Sample", "schedule": "daily", "paused": self.paused,
                          "next_run_at": None, "active_run_id": None}]}

    def perform(self, db, actor, job_name, action, run_id=None):
        if job_name != "sample" or action not in {"run", "retry", "pause", "resume"}:
            raise AppError("Unknown job or action", 404)
        if action == "retry":
            previous = db.get(AdminJobRun, run_id) if run_id else None
            if previous is None or previous.job_name != job_name:
                raise AppError("Run not found", 404)
            if previous.status in {"queued", "running"}:
                raise AppError("Run is still active", 409)
        if action in {"run", "retry"}:
            run = AdminJobRun(job_name=job_name, status="queued", trigger="retry" if action == "retry" else "manual",
                              actor_id=actor.id, retry_of=run_id)
            db.add(run)
            db.flush()
            return run
        control = db.get(AdminJobControl, job_name)
        if control is None:
            control = AdminJobControl(job_name=job_name)
            db.add(control)
        control.paused = action == "pause"
        db.flush()
        return None

    def apply_control(self, job_name, action, run_id=None):
        if action in {"pause", "resume"}:
            self.paused = action == "pause"


def test_membership_is_checked_for_existing_tokens_and_denied_mutations_are_audited(client, db_session, settings):
    _, manager_headers = account(db_session, settings, "manager@example.com", administrator=True)
    member, member_headers = account(db_session, settings, "member@example.com")
    assert client.get("/admin/me", headers=member_headers).status_code == 403
    response = client.post("/admin/administrators", headers=member_headers, json={"email": "member@example.com"})
    assert response.status_code == 403
    assert db_session.scalar(select(AdminAuditLog).order_by(AdminAuditLog.id.desc())).action == "access.denied"

    assert client.post("/admin/administrators", headers=manager_headers,
                       json={"email": "member@example.com"}).status_code == 200
    assert client.get("/admin/me", headers=member_headers).json() == {"user_id": member.id, "email": member.email}
    assert client.delete(f"/admin/administrators/{member.id}", headers=manager_headers).status_code == 200
    assert client.get("/admin/me", headers=member_headers).status_code == 403
    actions = [row.action for row in db_session.scalars(select(AdminAuditLog).order_by(AdminAuditLog.id))]
    assert actions == ["administrator.bootstrap", "access.denied", "administrator.grant", "administrator.revoke"]


def test_last_active_administrator_cannot_be_revoked_and_invalid_grants_are_audited(client, db_session, settings):
    manager, headers = account(db_session, settings, "manager@example.com", administrator=True)
    account(db_session, settings, "disabled@example.com", active=False)
    assert client.delete(f"/admin/administrators/{manager.id}", headers=headers).status_code == 409
    assert db_session.get(AdminAccount, manager.id) is not None
    for email, status in (("missing@example.com", 404), ("disabled@example.com", 409), (manager.email, 409)):
        assert client.post("/admin/administrators", headers=headers, json={"email": email}).status_code == status
    records = service.list_audit(db_session)["items"]
    assert [record["status"] for record in records[:4]] == ["failed"] * 4
    assert records[0]["actor_email"] == manager.email
    assert client.get("/admin/administrators", headers=headers).json()["total"] == 1


def test_bootstrap_requires_existing_active_account_and_is_idempotent(db_session, settings):
    with pytest.raises(AppError):
        service.bootstrap_administrator(db_session, "missing@example.com")
    inactive, _ = account(db_session, settings, "inactive@example.com", active=False)
    with pytest.raises(AppError):
        service.bootstrap_administrator(db_session, inactive.email)
    user, _ = account(db_session, settings, "manager@example.com")
    assert service.bootstrap_administrator(db_session, user.email.upper()) == user.id
    assert service.bootstrap_administrator(db_session, user.email) == user.id
    assert len(service.list_administrators(db_session)["items"]) == 1
    assert service.list_audit(db_session)["items"][0]["details"]["changed"] is False


def test_job_actions_commit_with_audit_and_controls_and_history_is_paginated(client, app, db_session, settings):
    _, headers = account(db_session, settings, "manager@example.com", administrator=True)
    runtime = FakeRuntime()
    app.state.jobs = runtime
    assert client.post("/admin/jobs/sample/pause", headers=headers).status_code == 200
    assert runtime.paused and db_session.get(AdminJobControl, "sample").paused
    response = client.post("/admin/jobs/sample/run", headers=headers)
    assert response.status_code == 200
    run = db_session.get(AdminJobRun, response.json()["run_id"])
    assert run.status == "queued" and run.trigger == "manual"
    assert client.post("/admin/jobs/sample/retry", headers=headers, json={"run_id": run.id}).status_code == 409
    run.status = "succeeded"
    run.started_at = datetime(2026, 9, 30, 1)
    run.finished_at = run.started_at + timedelta(seconds=8)
    db_session.commit()
    retry = client.post("/admin/jobs/sample/retry", headers=headers, json={"run_id": run.id})
    assert retry.status_code == 200
    assert db_session.get(AdminJobRun, retry.json()["run_id"]).retry_of == run.id
    assert client.post("/admin/jobs/sample/resume", headers=headers).status_code == 200
    assert not runtime.paused and not db_session.get(AdminJobControl, "sample").paused
    assert client.post("/admin/jobs/not-a-command/run", headers=headers).status_code == 404
    assert client.post("/admin/jobs/sample/delete", headers=headers).status_code == 404
    history = client.get("/admin/runs?limit=1&offset=1&job_name=sample", headers=headers).json()
    assert history["total"] == 2 and history["items"][0]["id"] == run.id
    assert history["items"][0]["duration_seconds"] == 8
    assert datetime.fromisoformat(history["items"][0]["started_at"]).utcoffset() == timedelta(0)
    audit = client.get("/admin/audit?limit=2", headers=headers).json()
    assert audit["total"] == 8 and len(audit["items"]) == 2
    assert [item["status"] for item in audit["items"]] == ["failed", "failed"]


def test_failed_commit_does_not_apply_pause_or_leave_queued_work(db_session, settings, monkeypatch):
    user, _ = account(db_session, settings, "manager@example.com", administrator=True)
    runtime = FakeRuntime()
    original = db_session.commit
    calls = 0

    def fail_once():
        nonlocal calls
        calls += 1
        if calls == 1:
            raise OperationalError("secret SQL", {}, RuntimeError("secret password"))
        original()

    monkeypatch.setattr(db_session, "commit", fail_once)
    with pytest.raises(OperationalError):
        service.perform_job(db_session, user, runtime, "sample", "pause", None)
    assert not runtime.paused
    assert db_session.get(AdminJobControl, "sample") is None
    record = service.list_audit(db_session)["items"][0]
    assert record["status"] == "failed" and record["details"] == {"reason": "OperationalError"}


def test_overview_uses_environment_local_qdrant_and_sanitizes_errors(client, app, db_session, settings, monkeypatch):
    _, headers = account(db_session, settings, "manager@example.com", administrator=True)
    app.state.environment = "development"
    app.state.jobs = FakeRuntime()
    monkeypatch.setenv("APP_ENV", "development")
    settings.QDRANT_URL = "https://qdrant.test"
    settings.QDRANT_COLLECTION = "news_chunks_dev"
    settings.QDRANT_API_KEY = "private-key"
    calls = []

    async def respond(request):
        calls.append(request)
        return httpx.Response(503, json={"private": "upstream private response"})

    original = app.state.http
    app.state.http = httpx.AsyncClient(transport=httpx.MockTransport(respond))
    try:
        response = client.get("/admin/overview", headers=headers)
        assert response.status_code == 200
        data = response.json()
        assert data["environment"] == "development"
        assert {item["name"]: item["status"] for item in data["services"]} == {
            "api": "healthy", "database": "healthy", "scheduler": "running", "qdrant": "unhealthy"}
        assert str(calls[0].url) == "https://qdrant.test/collections/news_chunks_dev"
        assert calls[0].headers["api-key"] == "private-key"
        assert "private-key" not in response.text and "upstream private response" not in response.text
        settings.QDRANT_COLLECTION = "production_collection"
        guarded = client.get("/admin/overview", headers=headers).json()["services"][-1]
        assert guarded == {"name": "qdrant", "status": "unhealthy", "detail": "ValueError"}
        assert len(calls) == 1
        settings.QDRANT_URL = ""
        settings.QDRANT_HOST = ""
        assert client.get("/admin/overview", headers=headers).json()["services"][-1]["status"] == "not_configured"
        assert len(calls) == 1
    finally:
        import asyncio

        asyncio.run(app.state.http.aclose())
        app.state.http = original
