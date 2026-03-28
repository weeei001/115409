from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_BACKEND_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    # 資料庫配置（預設值，可透過 .env 覆蓋）
    DATABASE_HOST: str = "localhost"
    DATABASE_USER: str = "root"
    DATABASE_PASSWORD: str = ""  # 請在 .env 檔案中設置
    DATABASE_NAME: str = "topic_stock"
    DATABASE_PORT: int = 3306
    
    # NVIDIA NIM LLM 配置
    NIM_API_KEY: str = ""
    NIM_BASE_URL: str = "https://integrate.api.nvidia.com/v1"
    NIM_MODEL: str = "meta/llama-3.1-70b-instruct"

    # 新聞 RAG API 配置
    RAG_API_URL: str = ""
    RAG_API_KEY: str = ""
    RAG_API_TIMEOUT: int = 10

    # 應用配置
    APP_NAME: str = "FastAPI MySQL Application"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_RELOAD: bool = True
    
    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache()
def get_settings():
    return Settings()
