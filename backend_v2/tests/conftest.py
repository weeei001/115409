import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import Settings
# Test imports and default app factories must never load an operator's local settings.
Settings.model_config["env_file"] = None
from app.db.session import Base, get_db
from app.main import create_app


@pytest.fixture
def settings():
    return Settings(_env_file=None, JWT_SECRET="test-only-secret-not-a-production-secret")


@pytest.fixture
def db_session():
    import app.db.models

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine, expire_on_commit=False) as session:
        yield session
    engine.dispose()


@pytest.fixture
def app(settings, db_session):
    app = create_app(settings)
    app.dependency_overrides[get_db] = lambda: db_session
    return app


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client
