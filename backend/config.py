from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # 資料庫配置（預設值，可透過 .env 覆蓋）
    DATABASE_HOST: str = "localhost"
    DATABASE_USER: str = "root"
    DATABASE_PASSWORD: str = ""  # 請在 .env 檔案中設置
    DATABASE_NAME: str = "topic_stock"
    DATABASE_PORT: int = 3306
    
    # 應用配置
    APP_NAME: str = "FastAPI MySQL Application"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = True
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_RELOAD: bool = True
    
    model_config = SettingsConfigDict(
        env_file=".env",
        case_sensitive=True,
        extra="ignore",
    )


@lru_cache()
def get_settings():
    return Settings()
