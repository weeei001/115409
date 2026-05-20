from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    DATABASE_HOST: str = "localhost"
    DATABASE_USER: str = "root"
    DATABASE_PASSWORD: str = ""
    DATABASE_NAME: str = "topic_stock"
    DATABASE_PORT: int = 3306

    NIM_API_KEY: str = ""
    NIM_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    ADVISOR_LLM_MODEL: str = ""

    RAG_API_URL: str = ""
    RAG_API_KEY: str = ""
    RAG_API_TIMEOUT: int = 10

    APP_NAME: str = "FastAPI MySQL Application"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_RELOAD: bool = True

    JWT_SECRET: str = "change-me-in-production-use-long-random-string"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 60 * 24 * 7

    GOOGLE_CLIENT_ID: str = ""

    PASSWORD_RESET_EXPIRE_MINUTES: int = 60
    FRONTEND_PASSWORD_RESET_URL: str = ""
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    SMTP_FROM: str = ""
    SMTP_USE_TLS: bool = True

    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache()
def get_settings():
    return Settings()
