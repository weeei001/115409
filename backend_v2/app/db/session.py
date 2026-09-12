from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.engine import make_engine, make_session_factory


def get_db(request: Request) -> Iterator[Session]:
    with request.app.state.session_factory() as session:
        try:
            yield session
        except BaseException:
            session.rollback()
            raise
