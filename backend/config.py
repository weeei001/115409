from functools import lru_cache
from pathlib import Path
from typing import Literal

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
    ADVISOR_LLM_TEMPERATURE: float = 0.2
    ADVISOR_LLM_MAX_COMPLETION_TOKENS: int = 8192
    ADVISOR_LLM_RESPONSE_FORMAT: Literal["off", "json_object"] = "json_object"
    # 單次 LLM 呼叫的等待上限（秒）。慢速模型（deepseek-v4-pro）需要拉長。
    ADVISOR_LLM_TIMEOUT_SECONDS: int = 900
    # openai SDK 預設重試 2 次，逾時的話總等待是 timeout×3，而且每次都重送整份 prompt。
    # 拉長 timeout 時通常要一併把這個降到 0，否則等待時間與費用都會變三倍。
    ADVISOR_LLM_MAX_RETRIES: int = 2
    # 改用 SSE 串流收取回覆。長輸出時上游閘道不會因為單一連線久久沒有回應而回 504，
    # 代價是 token 用量要另外用 stream_options 要回來。
    ADVISOR_LLM_STREAMING: bool = False
    # 串流時「兩個 chunk 之間」的等待上限（秒），0＝停用。langchain 預設 120 秒，
    # 推理模型在思考期間不吐 chunk，實測 gpt-oss-120b 送出 2 個 chunk 後就被這道砍掉。
    ADVISOR_LLM_STREAM_CHUNK_TIMEOUT_SECONDS: int = 0

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
