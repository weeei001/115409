from typing import Any, Optional

from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from config import get_settings

settings = get_settings()


def get_pymysql_connect_kwargs(
    *,
    autocommit: bool = False,
    cursorclass: Optional[Any] = None,
) -> dict[str, Any]:
    """與 SQLAlchemy `engine` 相同來源的連線參數，供爬蟲等直接使用 pymysql。"""
    import pymysql.cursors

    return {
        "host": settings.DATABASE_HOST,
        "port": settings.DATABASE_PORT,
        "user": settings.DATABASE_USER,
        "password": settings.DATABASE_PASSWORD,
        "database": settings.DATABASE_NAME,
        "charset": "utf8mb4",
        "cursorclass": cursorclass if cursorclass is not None else pymysql.cursors.DictCursor,
        "autocommit": autocommit,
    }
# 創建資料庫連接 URL
SQLALCHEMY_DATABASE_URL = (
    f"mysql+pymysql://{settings.DATABASE_USER}:{settings.DATABASE_PASSWORD}"
    f"@{settings.DATABASE_HOST}:{settings.DATABASE_PORT}/{settings.DATABASE_NAME}"
)

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=10,
    max_overflow=20,
    echo=settings.DEBUG,
)

# 創建會話
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# 創建基類
Base = declarative_base()


# 資料庫依賴
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
