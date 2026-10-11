import json

import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.db.models.audit import AuditLog
from app.db.models.user import User
from app.features.audit.service import audit
from app.features.auth import service
from app.features.auth.schemas import RegisterRequest


def test_audit_participates_in_caller_transaction(db_session):
    audit(db_session, None, None, "example", "target", "succeeded")
    db_session.flush()
    db_session.rollback()
    assert db_session.scalar(select(AuditLog)) is None


def test_regular_user_registration_and_login_are_audited(client, db_session):
    credentials = {"email": "person@example.com", "password": "Original123"}
    response = client.post("/auth/register", json=credentials)
    assert response.status_code == 200
    user_id = response.json()["user"]["id"]
    assert client.post("/auth/login", json=credentials).status_code == 200
    assert client.post("/auth/login", json={**credentials, "password": "Incorrect123"}).status_code == 401
    assert client.post("/auth/login", json={**credentials, "email": "unknown@example.com"}).status_code == 401
    rows = list(db_session.scalars(select(AuditLog).order_by(AuditLog.id)))
    assert [(r.action, r.status, r.actor_id) for r in rows] == [
        ("auth.register", "succeeded", user_id), ("auth.login", "succeeded", user_id),
        ("auth.login", "failed", user_id), ("auth.login", "failed", None),
    ]
    serialized = json.dumps([{key: getattr(r, key) for key in
                             ("actor_email", "action", "target", "status", "details")} for r in rows])
    assert "Original123" not in serialized and "Incorrect123" not in serialized
    assert rows[-1].actor_email == "unknown@example.com"


def test_registration_and_event_rollback_together(db_session, settings, monkeypatch):
    def fail_commit():
        raise SQLAlchemyError("commit failed")
    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(SQLAlchemyError):
        service.register(db_session, RegisterRequest(email="person@example.com", password="Original123"), settings)
    assert db_session.scalar(select(User)) is None
    assert db_session.scalar(select(AuditLog)) is None


def test_google_login_and_password_changes_record_no_credentials(client, db_session, settings, monkeypatch):
    from app.clients import google_auth
    from app.features.auth.schemas import ChangePasswordRequest

    settings.GOOGLE_CLIENT_ID = "test-client"
    monkeypatch.setattr(google_auth, "verify_google_id_token", lambda *args: {
        "sub": "google-sub", "email": "google@example.com", "email_verified": True,
    })
    for _ in range(2):
        assert client.post("/auth/google", json={"id_token": "private-google-token"}).status_code == 200
    registered = service.register(db_session, RegisterRequest(email="local@example.com", password="Original123"), settings)
    user = db_session.get(User, registered.user.id)
    service.change_password(db_session, user, ChangePasswordRequest(current_password="Original123", new_password="Changed123"))
    raw = service.create_reset_token(db_session, user.id, settings)
    service.reset_password(db_session, raw, "Reset12345")
    rows = list(db_session.scalars(select(AuditLog).order_by(AuditLog.id)))
    assert [r.action for r in rows] == ["auth.register", "auth.login", "auth.login", "auth.register",
                                          "auth.password_change", "auth.password_reset"]
    serialized = json.dumps([{key: getattr(r, key) for key in ("action", "target", "details")} for r in rows])
    for secret in ("private-google-token", "Original123", "Changed123", "Reset12345", raw):
        assert secret not in serialized
