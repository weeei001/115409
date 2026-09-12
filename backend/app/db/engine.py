"""Database resource builders shared by the API and independent workers."""
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.config import Settings


def make_engine(settings: Settings):
    return create_engine(
        settings.database_url, pool_pre_ping=True, pool_recycle=3600,
        pool_size=10, max_overflow=20, echo=False,
    )


def make_session_factory(engine):
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
