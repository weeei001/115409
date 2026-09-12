from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app


def test_factory_and_health_do_not_connect_to_external_services(monkeypatch):
    import socket
    import sqlalchemy.engine

    def fail(*args, **kwargs):
        raise AssertionError("External connection attempted")

    monkeypatch.setattr(socket, "create_connection", fail)
    monkeypatch.setattr(sqlalchemy.engine.Engine, "connect", fail)
    app = create_app(Settings(_env_file=None))
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "healthy"}
        assert client.get("/").json()["docs"] == "/docs"
        assert client.get("/docs").status_code == 200
        assert client.get("/openapi.json").status_code == 200


def test_database_url_handles_reserved_password_characters():
    settings = Settings(_env_file=None, DATABASE_PASSWORD="p@ss:/?#%")
    assert settings.database_url.password == "p@ss:/?#%"
    assert settings.APP_PORT == 8002


def test_error_handlers_do_not_expose_credentials_or_sql(client, app):
    from sqlalchemy.exc import OperationalError

    @app.get("/test-database-failure")
    def database_failure():
        raise OperationalError("SELECT private_credentials", {}, RuntimeError("secret-password"))

    @app.get("/test-unexpected-failure")
    def unexpected_failure():
        raise RuntimeError("secret-password")

    with TestClient(app, raise_server_exceptions=False) as safe_client:
        db = safe_client.get("/test-database-failure")
        internal = safe_client.get("/test-unexpected-failure")
    assert db.status_code == 503 and internal.status_code == 500
    assert db.json() == {"detail": "Database service unavailable"}
    assert internal.json() == {"detail": "Internal server error"}
    validation = client.post("/auth/register", json={"email": "valid@example.com", "password": "secret"})
    assert validation.status_code == 422 and "secret" not in validation.text
