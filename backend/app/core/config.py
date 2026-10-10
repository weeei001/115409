from functools import lru_cache
from datetime import date, time
import hashlib
import json
import os
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


BACKEND_DIR = Path(__file__).resolve().parents[2]


def application_environment() -> str:
    environment = os.environ.get("APP_ENV", "production")
    if environment not in {"production", "development"}:
        raise ValueError("APP_ENV must be production or development")
    return environment


def state_directory(*, production: Path | None = None) -> Path:
    if application_environment() == "development":
        return BACKEND_DIR / ".state" / "development"
    return production if production is not None else BACKEND_DIR / ".state"


def require_development_names(settings, *fields: str) -> None:
    if application_environment() == "development":
        for field in fields:
            value = getattr(settings, field, None)
            if not isinstance(value, str) or not value.endswith("_dev"):
                raise ValueError(f"{field} must end with _dev in development")


def news_index_fingerprint(index_version="news-v1", model="nvidia/nemotron-3-embed-1b",
                           max_chars=800, overlap_chars=120):
    """Bind an index to its model, text construction, and chunking parameters."""
    value = {"index_version": index_version, "model": model, "max_chars": max_chars,
             "overlap_chars": overlap_chars, "format": "sentence-spans-title-body-v1"}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode("utf-8")).hexdigest()


class Settings(BaseSettings):
    DATABASE_HOST: str = "localhost"
    DATABASE_USER: str = "root"
    DATABASE_PASSWORD: str = ""
    DATABASE_NAME: str = "topic_stock"
    DATABASE_PORT: int = 3306

    # Ambient proxy variables are opt-in; use OUTBOUND_HTTP_PROXY for an explicit proxy.
    OUTBOUND_HTTP_TRUST_ENV: bool = False
    OUTBOUND_HTTP_PROXY: str = ""

    # 新聞分析、個股分析與對話 AI 共用 LLM_* 模型、端點及金鑰。
    LLM_API_KEY: str = ""
    LLM_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    LLM_MODEL: str = ""
    LLM_ENABLE_THINKING: bool | None = None
    LLM_TEMPERATURE: float = 0.2
    LLM_MAX_TOKENS: int = 8192
    LLM_RESPONSE_FORMAT: Literal["off", "json_object", "json_schema"] = "json_object"
    LLM_TIMEOUT_SECONDS: float = 900
    LLM_MAX_RETRIES: int = 2
    LLM_STREAMING: bool = True
    LLM_STREAM_CHUNK_TIMEOUT_SECONDS: float = 0
    # 單次模型逾時與整輪上限分開；意圖、檢索、初答及唯一一次修復共用整輪時間。
    # 對話僅獨立設定 token、逾時與重試上限。
    CHAT_LLM_MAX_TOKENS: int = 8192
    CHAT_LLM_TIMEOUT_SECONDS: float = 60
    CHAT_LLM_MAX_RETRIES: int = 0
    CHAT_REQUEST_TIMEOUT_SECONDS: float = Field(60, gt=0, allow_inf_nan=False)
    LLM_INPUT_PRICE_PER_M: float = 0.20
    LLM_OUTPUT_PRICE_PER_M: float = 1.20
    ANALYSIS_TIMEOUT_SECONDS: int = 1200
    SIMULATION_CACHE_DIR: Path = Field(default_factory=lambda: state_directory() / "simulation")

    QDRANT_URL: str = ""
    QDRANT_HOST: str = ""
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION: str = "news_chunks"
    QDRANT_TIMEOUT_SECONDS: float = 10
    EMBED_API_URL: str = "https://integrate.api.nvidia.com/v1/embeddings"
    EMBED_API_KEY: str = ""
    EMBED_MODEL: str = "nvidia/nemotron-3-embed-1b"
    EMBED_TIMEOUT_SECONDS: float = 60
    EMBED_TRUNCATE: Literal["NONE", "START", "END"] = "NONE"
    # Empty keeps existing read-only indexes usable until an explicit version switch.
    NEWS_INDEX_VERSION: str = ""
    NEWS_CHUNK_MAX_CHARS: int = 800
    NEWS_CHUNK_OVERLAP_CHARS: int = 120

    # Bob's trend prediction keeps its algorithm, while deployment-specific limits
    # live in the backend environment instead of the route implementation.
    TREND_PREDICTION_HISTORY_DAYS: int = Field(60, ge=2)
    TREND_PREDICTION_MAX_PRICE_POINTS: int = Field(30, ge=2)
    TREND_PREDICTION_HORIZON_DAYS: int = Field(20, ge=1)
    TREND_PREDICTION_NEWS_WINDOW_DAYS: int = Field(30, ge=1)
    TREND_PREDICTION_NEWS_LIMIT: int = Field(20, ge=1)
    TREND_PREDICTION_REGRESSION_LAMBDA: float = 0.1
    TREND_PREDICTION_MOMENTUM_LAMBDA: float = 0.2
    TREND_PREDICTION_DECAY: float = 0.18
    TREND_PREDICTION_TRADING_DAYS_PER_WEEK: int = Field(5, ge=1)

    @property
    def news_index_fingerprint(self) -> str:
        return news_index_fingerprint(self.NEWS_INDEX_VERSION, self.EMBED_MODEL,
                                      self.NEWS_CHUNK_MAX_CHARS, self.NEWS_CHUNK_OVERLAP_CHARS)

    APP_NAME: str = "FastAPI MySQL Application"
    APP_VERSION: str = "1.0.0"
    # Intentional configurable network binding; environment examples use loopback.
    APP_HOST: str = "0.0.0.0"  # nosec B104
    APP_PORT: int = 8002
    APP_RELOAD: bool = False

    JOBS_ENABLED: bool = True
    JOBS_MARKET_TIME: time = time(17)
    JOBS_START_DATE: date = date(2021, 1, 1)
    JOBS_IMPACT_SINCE: date | None = None
    JOBS_IMPACT_LIMIT: int = Field(100, ge=1)
    JOBS_IMPACT_MAX_COST_USD: float = Field(0.50, ge=0, allow_inf_nan=False)
    JOBS_BRIEF_TIMEOUT_SECONDS: float = Field(180, gt=0, allow_inf_nan=False)
    # Settled reviews of past briefs fed back into new ones: "" off, "*" every stock, or comma-separated codes.
    TEXT_BRIEF_LESSONS_SYMBOLS: str = ""
    # Reviews written per warmup run, one model call each; 0 writes none while briefs still read existing ones.
    JOBS_LESSONS_LIMIT: int = Field(30, ge=0)

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
    CORS_ALLOW_ORIGINS: str = "*"
    NOTIFICATIONS_ENABLED: bool = False
    FCM_ENABLED: bool = False
    FCM_PROJECT_ID: str = ""
    FCM_CREDENTIALS_FILE: str = ""
    FCM_WEB_ORIGIN: str = ""

    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        case_sensitive=True,
        extra="ignore",
    )

    @property
    def database_url(self) -> URL:
        return URL.create(
            "mysql+pymysql", username=self.DATABASE_USER,
            password=self.DATABASE_PASSWORD, host=self.DATABASE_HOST,
            port=self.DATABASE_PORT, database=self.DATABASE_NAME,
            query={"charset": "utf8mb4"},
        )


@lru_cache
def get_settings() -> Settings:
    if application_environment() == "production":
        return Settings()
    path = BACKEND_DIR / ".env.development"
    if not path.is_file():
        raise ValueError("Development configuration is missing: backend/.env.development")
    settings = Settings(_env_file=path)
    require_development_names(settings, "DATABASE_NAME", "DATABASE_USER", "QDRANT_COLLECTION")
    return settings
