from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import uvicorn

from database import engine, Base
from routers import (
    stock_router,
    news_router,
    simulated_order_router,
    auth_router,
    stock_behavior_router,
)
from config import get_settings
from models.user import User  # noqa: F401 — 註冊至 Base.metadata 供 create_all 建表
from models.password_reset_token import PasswordResetToken  # noqa: F401

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """應用啟動和關閉時的生命週期管理"""
    # 啟動時創建資料庫表
    print("正在創建資料庫表...")
    Base.metadata.create_all(bind=engine)
    print("資料庫表創建完成")
    yield
    # 關閉時的清理工作
    print("應用關閉")


# OpenAPI：標籤說明（Swagger /docs 左側分組）
_OPENAPI_TAGS = [
    {
        "name": "AI 分析",
        "description": (
            "股票 AI 分析相關端點：`raw/*`、`quick-insights`、`final`。\n\n"
            "**模型**：`primary`／`secondary` 由**後端環境設定**決定，**API 請求不得指定**。\n\n"
            "**錯誤**：HTTP 4xx/5xx 時 body 通常為 `{\"detail\": \"...\"}`；參數驗證失敗時為 `422`，`detail` 可能為欄位錯誤陣列。"
        ),
    },
    {
        "name": "股價查詢",
        "description": "個股日線、K 線、歷史價量等（路徑前綴 `/stocks`）。",
    },
    {
        "name": "新聞查詢",
        "description": "鉅亨新聞列表、單篇、筆數統計等（前綴 `/news`）。",
    },
    {
        "name": "技術指標",
        "description": "技術指標相關查詢（前綴 `/stocks`，與股價路由共用）。",
    },
    {
        "name": "三大法人",
        "description": "三大法人買賣超等（前綴 `/stocks`）。",
    },
    {
        "name": "模擬下單",
        "description": "模擬委託、清單、分類損益（前綴 `/simulated-orders`）。",
    },
    {
        "name": "認證",
        "description": (
            "註冊、帳密登入、`POST /auth/google`（Google id_token）、`GET /auth/me`。"
            "同一 email 可合併密碼帳與 Google 帳。"
        ),
    },
]

# 創建 FastAPI 應用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "台股相關 **FastAPI + MySQL** 後端。\n\n"
        "- **互動文件**：本頁 Swagger UI（`/docs`）或 ReDoc（`/redoc`）。\n"
        "- **健康檢查**：`GET /health`。\n"
        "- **AI 分析**：見標籤「AI 分析」；分階架構可並行呼叫 `raw` 三筆 + `quick-insights` + `final`。\n\n"
        "實際部署網域與 CORS 請依環境調整。"
    ),
    openapi_tags=_OPENAPI_TAGS,
    lifespan=lifespan,
)

# 配置 CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 生產環境中應該設置具體的域名
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 註冊路由
app.include_router(stock_router)
app.include_router(news_router)
app.include_router(simulated_order_router)
app.include_router(auth_router)
app.include_router(stock_behavior_router)


@app.get("/")
def read_root():
    """根路徑"""
    return {
        "message": "歡迎使用 FastAPI + MySQL 後端應用",
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }


@app.get("/health")
def health_check():
    """健康檢查"""
    return {"status": "healthy"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_RELOAD,
    )
