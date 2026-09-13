from functools import lru_cache
import hashlib
import json
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


def news_index_fingerprint(index_version="news-v2", model="nvidia/nemotron-3-embed-1b",
                           max_chars=800, overlap_chars=120):
    """Bind an index to its model, text construction, and chunking parameters."""
    value = {"index_version": index_version, "model": model, "max_chars": max_chars,
             "overlap_chars": overlap_chars, "format": "sentence-spans-title-body-v1"}
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode("utf-8")).hexdigest()


class Settings(BaseSettings):
    DATABASE_HOST: str = Field("localhost", validation_alias=AliasChoices("DATABASE_HOST", "MYSQL_HOST"))
    DATABASE_USER: str = Field("root", validation_alias=AliasChoices("DATABASE_USER", "MYSQL_USER"))
    DATABASE_PASSWORD: str = Field("", validation_alias=AliasChoices("DATABASE_PASSWORD", "MYSQL_PASSWORD"))
    DATABASE_NAME: str = Field("topic_stock", validation_alias=AliasChoices("DATABASE_NAME", "MYSQL_DATABASE"))
    DATABASE_PORT: int = Field(3306, validation_alias=AliasChoices("DATABASE_PORT", "MYSQL_PORT"))

    # Ambient proxy variables are opt-in; use OUTBOUND_HTTP_PROXY for an explicit proxy.
    OUTBOUND_HTTP_TRUST_ENV: bool = False
    OUTBOUND_HTTP_PROXY: str = ""

    # LLM_* remains the internal analysis configuration. ANALYSIS_LLM_* is the
    # deployment-facing name; the older aliases keep existing deployments working.
    LLM_API_KEY: str = Field("", validation_alias=AliasChoices(
        "ANALYSIS_LLM_API_KEY", "LLM_API_KEY", "H200_API_KEY", "RAG_LLM_API_KEY", "NVIDIA_API_KEY"))
    LLM_BASE_URL: str = Field(
        "https://integrate.api.nvidia.com/v1",
        validation_alias=AliasChoices(
            "ANALYSIS_LLM_BASE_URL", "LLM_BASE_URL", "H200_BASE_URL", "RAG_LLM_BASE_URL"),
    )
    LLM_MODEL: str = Field("", validation_alias=AliasChoices(
        "ANALYSIS_LLM_MODEL", "LLM_MODEL", "H200_MODEL", "RAG_LLM_MODEL", "NIM_MODEL"))
    STREAM_LLM_API_KEY: str = ""
    STREAM_LLM_BASE_URL: str = ""
    STREAM_LLM_MODEL: str = ""
    LLM_ENABLE_THINKING: bool | None = None
    LLM_TEMPERATURE: float = 0.2
    LLM_MAX_TOKENS: int = 8192
    LLM_RESPONSE_FORMAT: Literal["off", "json_object", "json_schema"] = "json_object"
    LLM_TIMEOUT_SECONDS: float = 900
    LLM_MAX_RETRIES: int = 2
    LLM_STREAMING: bool = True
    LLM_STREAM_CHUNK_TIMEOUT_SECONDS: float = 0
    # Chat intent, answers and citation repair share a separate latency budget.
    # An empty model preserves existing deployments until a chat model is selected.
    CHAT_LLM_MODEL: str = ""
    CHAT_LLM_MAX_TOKENS: int = 2048
    CHAT_LLM_TIMEOUT_SECONDS: float = 60
    CHAT_LLM_MAX_RETRIES: int = 0
    LLM_INPUT_PRICE_PER_M: float = 0.20
    LLM_OUTPUT_PRICE_PER_M: float = 1.20
    SENTIMENT_USD_TWD_RATE: float = 32.0
    ANALYSIS_TIMEOUT_SECONDS: int = 1200
    SIMULATION_CACHE_DIR: Path = Path(__file__).resolve().parents[2] / ".state" / "simulation"
    FINMIND_API_TOKEN: str = ""

    RAG_API_URL: str = ""
    RAG_API_KEY: str = ""
    RAG_API_TIMEOUT: int = 10

    QDRANT_URL: str = ""
    QDRANT_HOST: str = ""
    QDRANT_PORT: int = 6333
    QDRANT_API_KEY: str = ""
    QDRANT_COLLECTION: str = "news_chunks"
    QDRANT_TIMEOUT_SECONDS: float = 10
    EMBED_API_URL: str = "https://integrate.api.nvidia.com/v1/embeddings"
    EMBED_API_KEY: str = Field("", validation_alias=AliasChoices("EMBED_API_KEY", "NVIDIA_API_KEY"))
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

    @property
    def stream_llm_overrides(self) -> dict[str, str]:
        """Resolve the optional stream provider, falling back to analysis LLM."""
        stream = {
            "LLM_API_KEY": self.STREAM_LLM_API_KEY.strip(),
            "LLM_BASE_URL": self.STREAM_LLM_BASE_URL.strip(),
            "LLM_MODEL": self.STREAM_LLM_MODEL.strip(),
        }
        return stream if all(stream.values()) else {
            "LLM_API_KEY": self.LLM_API_KEY,
            "LLM_BASE_URL": self.LLM_BASE_URL,
            "LLM_MODEL": self.LLM_MODEL,
        }

    APP_NAME: str = "FastAPI MySQL Application"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8002
    APP_RELOAD: bool = False

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

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
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
    return Settings()
