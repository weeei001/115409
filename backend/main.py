from __future__ import annotations

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from database import Base, engine
from models.password_reset_token import PasswordResetToken  # noqa: F401
from models.user import User  # noqa: F401
from routers import (
    advisor_report_router,
    advisor_router,
    auth_router,
    core_mode_router,
    indicator_router,
    institutional_trade_router,
    news_router,
    simulated_order_router,
    stock_router,
)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


_OPENAPI_TAGS = [
    {"name": "Advisor 體驗 API", "description": "Advisor 頁面首屏與漸進事件串流。"},
    {"name": "Advisor 報告 Domain API", "description": "Advisor 完整報告背景工作管理。"},
    {"name": "Core Mode API", "description": "Core Mode 能力層 API（decision/backtest/presets）。"},
    {"name": "股票價格", "description": "股票價格查詢與圖表資料 API。"},
    {"name": "新聞", "description": "新聞查詢 API。"},
    {"name": "技術指標", "description": "技術指標查詢 API。"},
    {"name": "法人籌碼", "description": "三大法人資料查詢 API。"},
    {"name": "模擬下單", "description": "模擬交易 API。"},
    {"name": "身份驗證", "description": "註冊、登入、Google 登入與帳號管理 API。"},
]

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "台股分析與 Advisor 後端服務。\n\n"
        "- 文件：`/docs`、`/redoc`\n"
        "- 健康檢查：`/health`\n"
        "- Advisor 首屏保證不依賴 LLM，完整報告於背景流程補回"
    ),
    openapi_tags=_OPENAPI_TAGS,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(stock_router)
app.include_router(news_router)
app.include_router(indicator_router)
app.include_router(simulated_order_router)
app.include_router(institutional_trade_router)
app.include_router(auth_router)
app.include_router(core_mode_router)
app.include_router(advisor_router)
app.include_router(advisor_report_router)


@app.get("/", summary="服務資訊", tags=["系統"])
def read_root():
    return {"message": "FastAPI service is running", "version": settings.APP_VERSION, "docs": "/docs"}


@app.get("/health", summary="健康檢查", tags=["系統"])
def health_check():
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_RELOAD,
    )
