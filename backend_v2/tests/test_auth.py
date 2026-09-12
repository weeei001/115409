import hashlib
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qs, urlsplit

import bcrypt
import jwt
import pytest
from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.clients import google_auth, mail
from app.core.errors import AppError
from app.db.models.password_reset_token import PasswordResetToken
from app.db.models.user import User
from app.features.auth import service
from app.features.auth.schemas import ChangePasswordRequest, ResetPasswordRequest


def register(client, email="person@example.com"):
    response = client.post("/auth/register", json={"email": email, "password": "Original123"})
    assert response.status_code == 200, response.text
    return response.json()


def test_existing_bcrypt_hash_and_jwt_contract(client, db_session, settings):
    existing = bcrypt.hashpw(b"Original123", bcrypt.gensalt(rounds=4)).decode("ascii")
    user = User(email="person@example.com", password_hash=existing, is_active=True)
    db_session.add(user)
    db_session.commit()
    response = client.post("/auth/login", json={"email": "Person@EXAMPLE.com", "password": "Original123"})
    assert response.status_code == 200
    body = response.json()
    claims = jwt.decode(body["access_token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    assert set(claims) == {"sub", "exp"}
    assert claims["sub"] == str(user.id)
    assert body["expires_in"] == settings.JWT_EXPIRE_MINUTES * 60
    assert body["token_type"] == "bearer"
    assert body["user"] == {"id": user.id, "email": "person@example.com", "display_name": None}
    assert abs(claims["exp"] - datetime.now(timezone.utc).timestamp() - body["expires_in"]) < 3
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + body["access_token"]}).json() == body["user"]


def test_register_duplicate_and_auth_failures(client, db_session, settings):
    body = register(client, "Person@example.com")
    stored = db_session.get(User, body["user"]["id"])
    assert stored.email == "person@example.com"
    assert stored.password_hash.startswith("$2b$12$")
    assert service.verify_password("Original123", stored.password_hash)
    assert client.post("/auth/register", json={"email": "person@example.com", "password": "Different123"}).status_code == 400
    assert client.post("/auth/login", json={"email": "person@example.com", "password": "Wrong"}).json() == {"detail": "帳號或密碼錯誤"}
    assert client.get("/auth/me").status_code == 403
    assert client.get("/auth/me", headers={"Authorization": "Basic xyz"}).status_code == 403
    for claims in (
        {"sub": str(stored.id), "exp": datetime.now(timezone.utc) - timedelta(seconds=1)},
        {"sub": "not-an-integer", "exp": datetime.now(timezone.utc) + timedelta(minutes=1)},
        {"exp": datetime.now(timezone.utc) + timedelta(minutes=1)},
    ):
        token = jwt.encode(claims, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)
        response = client.get("/auth/me", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 401
        assert response.json() == {"detail": "Invalid or expired token"}
    stored.is_active = False
    db_session.commit()
    assert client.get("/auth/me", headers={"Authorization": "Bearer " + body["access_token"]}).status_code == 403
    assert client.post("/auth/login", json={"email": stored.email, "password": "Original123"}).status_code == 403


def test_google_account_merge_and_conflict(client, db_session, settings, monkeypatch):
    local = register(client)
    settings.GOOGLE_CLIENT_ID = "first, second"
    info = {"sub": "google-1", "email": "Person@example.com", "email_verified": True, "name": "Google name"}
    def verify(token, audiences):
        assert audiences == ["first", "second"]
        return info
    monkeypatch.setattr(google_auth, "verify_google_id_token", verify)
    response = client.post("/auth/google", json={"id_token": "test-google-token"})
    assert response.status_code == 200
    assert response.json()["user"] == local["user"]
    stored = db_session.get(User, local["user"]["id"])
    assert stored.google_sub == "google-1" and stored.password_hash
    info["sub"] = "google-2"
    assert client.post("/auth/google", json={"id_token": "test-google-token"}).status_code == 409
    info["email"] = "new@example.com"
    created = client.post("/auth/google", json={"id_token": "test-google-token"}).json()
    assert created["user"]["display_name"] == "Google name"
    assert db_session.get(User, created["user"]["id"]).password_hash is None
    info["email_verified"] = False
    assert client.post("/auth/google", json={"id_token": "test-google-token"}).status_code == 400


def test_google_disabled_and_adapter_errors(client, monkeypatch):
    assert client.post("/auth/google", json={"id_token": "test-google-token"}).status_code == 503
    def invalid(*args):
        raise ValueError("credential secret must never appear")
    monkeypatch.setattr(google_auth.id_token, "verify_oauth2_token", invalid)
    with pytest.raises(AppError, match="Invalid Google token"):
        google_auth.verify_google_id_token("test-token", ["first", "second"])


def test_reset_tokens_expire_replace_and_are_single_use(client, db_session, settings, monkeypatch):
    registered = register(client)
    settings.FRONTEND_PASSWORD_RESET_URL = "http://localhost:3000/reset-password?source=mail#form"
    delivered = []
    monkeypatch.setattr(mail, "send_password_reset_email", lambda email, link, config: delivered.append((email, link)))
    expected = {"message": service.FORGOT_OK_MESSAGE}
    assert client.post("/auth/forgot-password", json={"email": "unknown@example.com"}).json() == expected
    assert client.post("/auth/forgot-password", json={"email": "person@example.com"}).json() == expected
    raw = parse_qs(urlsplit(delivered[-1][1]).query)["token"][0]
    row = db_session.scalar(select(PasswordResetToken))
    assert row.token_hash == hashlib.sha256(raw.encode()).hexdigest()
    assert raw not in row.token_hash
    assert row.expires_at > datetime.now(timezone.utc).replace(tzinfo=None)
    client.post("/auth/forgot-password", json={"email": "person@example.com"})
    replacement = parse_qs(urlsplit(delivered[-1][1]).query)["token"][0]
    assert replacement != raw
    assert client.post("/auth/reset-password", json={"token": raw, "new_password": "NewPass123"}).status_code == 400
    result = client.post("/auth/reset-password", json={"token": replacement, "new_password": "NewPass123"})
    assert result.status_code == 200
    assert client.post("/auth/reset-password", json={"token": replacement, "new_password": "Other1234"}).status_code == 400
    assert client.post("/auth/login", json={"email": "person@example.com", "password": "NewPass123"}).status_code == 200
    expired = service.create_reset_token(db_session, registered["user"]["id"], settings)
    row = db_session.scalar(select(PasswordResetToken))
    row.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    db_session.commit()
    with pytest.raises(AppError, match="重設連結無效或已過期"):
        service.reset_password(db_session, ResetPasswordRequest(token=expired, new_password="Other1234"))


def test_forgot_password_does_not_reveal_google_or_disabled_accounts(client, db_session, monkeypatch):
    db_session.add_all([
        User(email="google@example.com", google_sub="google", password_hash=None, is_active=True),
        User(email="disabled@example.com", password_hash="irrelevant", is_active=False),
    ])
    db_session.commit()
    monkeypatch.setattr(mail, "send_password_reset_email", lambda *args: pytest.fail("Must not send email"))
    for email in ("google@example.com", "disabled@example.com", "unknown@example.com"):
        response = client.post("/auth/forgot-password", json={"email": email})
        assert response.status_code == 200
        assert response.json() == {"message": service.FORGOT_OK_MESSAGE}
    assert db_session.scalar(select(PasswordResetToken)) is None


def test_change_password_invalidates_resets_and_checks_current_password(client, db_session, settings):
    registered = register(client)
    headers = {"Authorization": "Bearer " + registered["access_token"]}
    raw = service.create_reset_token(db_session, registered["user"]["id"], settings)
    for current, new in (("Wrong123", "NewPass123"), ("Original123", "Original123")):
        response = client.post("/auth/change-password", headers=headers, json={"current_password": current, "new_password": new})
        assert response.status_code == 400
    assert client.post("/auth/change-password", headers=headers, json={"current_password": "Original123", "new_password": "NewPass123"}).status_code == 200
    assert client.post("/auth/reset-password", json={"token": raw, "new_password": "Other1234"}).status_code == 400
    assert client.post("/auth/login", json={"email": "person@example.com", "password": "NewPass123"}).status_code == 200


def test_mail_failure_stays_private(settings, monkeypatch, caplog):
    settings.SMTP_HOST, settings.SMTP_FROM = "smtp.invalid", "sender@example.com"
    def unavailable(*args, **kwargs):
        raise OSError("private provider credentials")
    monkeypatch.setattr(mail.smtplib, "SMTP", unavailable)
    assert mail.send_password_reset_email("person@example.com", "http://app/?token=private-token", settings) is False
    assert "private-token" not in caplog.text
    assert "private provider credentials" not in caplog.text


@pytest.mark.parametrize("operation", ["reset", "change", "renew"])
def test_failed_password_transaction_preserves_password_and_old_token(db_session, settings, monkeypatch, operation):
    user = User(email="person@example.com", password_hash=bcrypt.hashpw(b"Original123", bcrypt.gensalt(rounds=4)).decode())
    db_session.add(user)
    db_session.commit()
    raw = service.create_reset_token(db_session, user.id, settings)
    original_hash = user.password_hash
    def fail_commit():
        raise SQLAlchemyError("transaction failed")
    monkeypatch.setattr(db_session, "commit", fail_commit)
    with pytest.raises(SQLAlchemyError):
        if operation == "reset":
            service.reset_password(db_session, ResetPasswordRequest(token=raw, new_password="NewPass123"))
        elif operation == "change":
            service.change_password(db_session, user, ChangePasswordRequest(current_password="Original123", new_password="NewPass123"))
        else:
            service.create_reset_token(db_session, user.id, settings)
    assert user.password_hash == original_hash
    assert db_session.scalar(select(PasswordResetToken)).token_hash == hashlib.sha256(raw.encode()).hexdigest()
