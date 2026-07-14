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
    finmind_extra_router,
)
from config import get_settings
from models.password_reset_token import PasswordResetToken  # noqa: F401
from models.analysis_snapshot import (  # noqa: F401
    StockBehaviorAnalysisSnapshot,
    StockBehaviorBacktestRun,
    StockBehaviorProjectionScore,
)

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
        "name": "系統",
        "description": "`GET /` 與 `GET /health`，用於取得服務基本資訊與健康檢查。",
    },
    {
        "name": "AI 分析",
        "description": (
            "股票 AI 分析流程：`POST /analyze/stock-behavior/rag` 取得新聞摘要，"
            "`POST /analyze/stock-behavior/ai` 產生 AI 情境分析。\n\n"
            "**模型**：由後端環境設定決定，API 請求不得指定模型。\n\n"
            "**錯誤**：HTTP 4xx/5xx 時 body 通常為 `{\"detail\": \"...\"}`；"
            "參數驗證失敗時為 `422`。"
        ),
    },
    {
        "name": "股價查詢",
        "description": (
            "`/stocks` 底下的股票資料查詢，包含可用代號、最新股價、歷史股價、"
            "區間統計、多股比較與部分圖表資料。"
        ),
    },
    {
        "name": "新聞查詢",
        "description": "`GET /news`，查詢鉅亨新聞列表，支援分頁、關鍵字、股票與發布時間篩選。",
    },
    {
        "name": "技術指標",
        "description": "`GET /stocks/{symbol}/technical-indicators`，查詢均線、RSI、KD、MACD 等技術指標。",
    },
    {
        "name": "三大法人",
        "description": (
            "三大法人與籌碼相關查詢，包含 `/stocks/{symbol}/institutional-trades`、"
            "`/stocks/{symbol}/chart/chips-volume`、`/stocks/{symbol}/volume-with-chips`。"
        ),
    },
    {
        "name": "FinMind 財報籌碼",
        "description": "FinMind 擴充資料，包含財報、月營收、估值、股利、融資融券與外資持股。",
    },
    {
        "name": "進階繪圖",
        "description": "`GET /stocks/{symbol}/integrated-chart`，一次取得前端圖表初始化所需的整合資料。",
    },
    {
        "name": "模擬下單",
        "description": "`/simulated-orders` 底下的模擬委託建立、列表、可賣張數與依股票代號彙總損益。",
    },
    {
        "name": "認證",
        "description": (
            "`/auth` 底下的註冊、帳密登入、Google 登入、目前使用者、變更密碼與忘記密碼流程。"
            "同一 email 可合併密碼帳與 Google 帳。"
        ),
    },
]

# 創建 FastAPI 應用
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description=(
        "台股相關 **FastAPI + MySQL** 後端，提供股價查詢、新聞查詢、技術指標、三大法人、模擬下單與 AI 分析 API。\n\n"
        "- **互動文件**：本頁 Swagger UI（`/docs`）或 ReDoc（`/redoc`）。\n"
        "- **OpenAPI JSON**：`/openapi.json`。\n"
        "- **健康檢查**：`GET /health`。\n"
        "- **日期格式**：所有日期查詢使用 `YYYY-MM-DD`；日期時間使用 ISO 8601。\n"
        "- **認證方式**：需要登入的端點使用 `Authorization: Bearer <access_token>`。\n"
        "- **AI 分析**：見標籤「AI 分析」；建議先呼叫 `/analyze/stock-behavior/rag`，再將結果帶入 `/analyze/stock-behavior/ai`。\n\n"
        "實際部署網域、CORS 與外部服務金鑰請依環境調整。"
    ),
    openapi_tags=_OPENAPI_TAGS,
    swagger_ui_parameters={
        "defaultModelsExpandDepth": 1,
        "displayRequestDuration": True,
        "filter": True,
    },
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
app.include_router(finmind_extra_router)


@app.get(
    "/",
    tags=["系統"],
    summary="取得 API 基本資訊",
    description="返回服務歡迎訊息、目前版本與 Swagger 文件路徑。",
    responses={
        200: {
            "description": "成功返回 API 基本資訊",
            "content": {
                "application/json": {
                    "example": {
                        "message": "歡迎使用 FastAPI + MySQL 後端應用",
                        "version": "1.0.0",
                        "docs": "/docs",
                    }
                }
            },
        }
    },
)
def read_root():
    """根路徑"""
    return {
        "message": "歡迎使用 FastAPI + MySQL 後端應用",
        "version": settings.APP_VERSION,
        "docs": "/docs"
    }


@app.get(
    "/health",
    tags=["系統"],
    summary="健康檢查",
    description="檢查 API 服務是否可回應。此端點不檢查外部 RAG、LLM 或 SMTP 服務。",
    responses={
        200: {
            "description": "服務可回應",
            "content": {"application/json": {"example": {"status": "healthy"}}},
        }
    },
)
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
