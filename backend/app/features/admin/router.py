import asyncio
from datetime import date, datetime
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

import httpx
from fastapi import APIRouter, Body, Depends, Path, Query, Request, Response
from fastapi.responses import StreamingResponse

from app.clients.llm import LlmClient
from app.core.config import application_environment, require_development_names
from app.core.errors import NotFound
from app.core.streaming import encode_sse
from app.db.models.user import User
from app.features.backtest import service as backtest
from app.features.backtest.schemas import AIBacktestResult, Preset
from app.features.admin import service
from app.features.admin import ai_feedback, ai_usage, chat_review
from app.features.admin.chat_review_schemas import ChatReviewDetail, ChatReviewFilter, ChatReviewList
from app.features.admin.schemas import ActionResponse, AddStockRequest, GrantAdministratorRequest, JobActionRequest
from app.features.auth.router import CurrentUser, Database
from app.features.retrieval.common import TAIPEI
from app.features.signals import service as signals
from app.features.signals.schemas import SignalCheckResponse, SignalEvidenceResponse


router = APIRouter(prefix="/admin", tags=["後台管理"])


def get_administrator(request: Request, user: CurrentUser, db: Database) -> User:
    try:
        service.require_admin(db, user)
    except service.AppError:
        if request.method in {"POST", "DELETE"}:
            # Only record the route; never record request bodies, passwords or bearer tokens.
            service.record_denied(db, user, request.url.path)
        raise
    return user


Administrator = Annotated[User, Depends(get_administrator)]


@router.get("/me")
def me(user: Administrator):
    return {"user_id": user.id, "email": user.email}


@router.get("/stocks")
def stocks(user: Administrator, db: Database, query: str = Query("", max_length=100)):
    return service.list_stocks(db, query)


@router.post("/stocks", response_model=ActionResponse)
def add_stock(body: AddStockRequest, user: Administrator, db: Database):
    return service.add_stock(db, user, body.symbol)


@router.get("/overview")
async def overview(request: Request, user: Administrator, db: Database):
    settings = request.app.state.settings
    data = await asyncio.to_thread(service.overview, db, getattr(request.app.state, "jobs", None),
                                   getattr(request.app.state, "environment", application_environment()))
    base = (settings.QDRANT_URL or (f"http://{settings.QDRANT_HOST}:{settings.QDRANT_PORT}"
                                   if settings.QDRANT_HOST else "")).rstrip("/")
    status, detail = "not_configured", None
    if base:
        try:
            require_development_names(settings, "QDRANT_COLLECTION")
            collection = quote(settings.QDRANT_COLLECTION, safe="")
            headers = {"api-key": settings.QDRANT_API_KEY} if settings.QDRANT_API_KEY else {}
            response = await request.app.state.http.get(f"{base}/collections/{collection}", headers=headers, timeout=3)
            response.raise_for_status()
            status = "healthy"
        except (httpx.HTTPError, httpx.InvalidURL, ValueError) as exc:
            status, detail = "unhealthy", type(exc).__name__
    data["services"].append({"name": "qdrant", "status": status, "detail": detail})
    return data


@router.get("/runs")
def runs(request: Request, user: Administrator, db: Database, limit: int = Query(20, ge=1, le=100),
         offset: int = Query(0, ge=0), job_name: str | None = Query(None, max_length=80)):
    return service.list_runs(db, limit, offset, job_name, getattr(request.app.state, "jobs", None))


@router.get("/runs/{run_id}")
def run(request: Request, user: Administrator, db: Database, run_id: int = Path(..., gt=0, le=2147483647)):
    return service.get_run(db, run_id, getattr(request.app.state, "jobs", None))


@router.get("/audit")
def audit(user: Administrator, db: Database, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)):
    return service.list_audit(db, limit, offset)


@router.get("/ai-conversations", response_model=ChatReviewList)
def ai_conversations(user: Administrator, db: Database, response: Response,
                     days: int = Query(14, ge=1, le=14),
                     outcome: ChatReviewFilter | None = Query(None),
                     reason: str = Query("", max_length=64), q: str = Query("", max_length=120),
                     limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)):
    response.headers["Cache-Control"] = "no-store"
    return chat_review.list_reviews(db, days=days, outcome=outcome, reason=reason, query=q,
                                    limit=limit, offset=offset)


@router.get("/ai-feedback", response_model=ai_feedback.AIFeedbackSummary)
def ai_feedback_summary(user: Administrator, db: Database, response: Response,
                        days: int = Query(30, ge=1, le=365)):
    response.headers["Cache-Control"] = "no-store"
    return ai_feedback.summary(db, days)


@router.get("/ai-usage", response_model=ai_usage.AIUsageSummary)
def ai_usage_summary(user: Administrator, db: Database, request: Request, response: Response,
                     days: int = Query(30, ge=1, le=365)):
    response.headers["Cache-Control"] = "no-store"
    return ai_usage.summary(db, days, request.app.state.settings)


@router.get("/signal-check", response_model=SignalCheckResponse)
def signal_check(user: Administrator, db: Database, response: Response,
                 symbol: str | None = Query(None, pattern=r"^[0-9]{4,6}[A-Z]?$", description="省略時合計股票清單裡的全部股票。"),
                 start: date = Query(date(2021, 1, 1), description="挑選期的第一天。"),
                 split: date = Query(date(2025, 1, 1), description="驗證期的第一天；之前是挑選期。"),
                 end: date | None = Query(None, description="驗證期的最後一天，預設今天（台北）。"),
                 horizon: int = Query(5, description="觀察成立後第幾個交易日的收盤：5 或 20。")):
    """標準技術、籌碼與營收訊號成立後的實際漲跌，分挑選期與驗證期，並對照任一天進場與加權指數。"""
    response.headers["Cache-Control"] = "no-store"
    return signals.signal_check(db, symbol=symbol, start=start, split=split,
                                end=end or datetime.now(TAIPEI).date(), horizon=horizon)


@router.get("/signal-evidence", response_model=SignalEvidenceResponse)
def signal_evidence(user: Administrator, db: Database, response: Response,
                    symbol: str = Query(..., pattern=r"^[0-9]{4,6}[A-Z]?$"),
                    as_of: date | None = Query(None, description="判斷日，預設今天（台北）；不是交易日時用之前最近的交易日。"),
                    horizon: int = Query(5, description="觀察成立後第幾個交易日的收盤：5 或 20。")):
    """某檔股票在某個判斷日可以引用的訊號證據：近期成立的訊號，以及截至當天已經知道的歷史統計。"""
    response.headers["Cache-Control"] = "no-store"
    return signals.signal_evidence(db, symbol=symbol, as_of=as_of or datetime.now(TAIPEI).date(), horizon=horizon)


def prepared_backtest(db: Database, symbol: str = Query(..., pattern=r"^[0-9]{4,6}[A-Z]?$"),
                      start: date = Query(..., description="第一個判斷日不早於這天。"),
                      end: date = Query(..., description="最後一天；之後的行情只用來算最後幾次判斷的命中與否。"),
                      preset: Preset = Query("standard", description="持股規則：conservative、standard、aggressive。"),
                      initial_cash: float = Query(1_000_000, ge=10_000, le=100_000_000),
                      ai: bool = Query(True, description="false 只跑純規則組，不呼叫模型。")):
    return backtest.prepare(db, symbol=symbol, start=start, end=end, preset=preset,
                            initial_cash=initial_cash, use_ai=ai)


@router.get("/ai-backtest/stream", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}}}, 404: {}, 422: {}})
def ai_backtest_stream(user: Administrator, request: Request,
                       prepared: Annotated[backtest.Prepared, Depends(prepared_backtest)]):
    """三組 AI 回測（純規則、AI 不給訊號、AI 給訊號），每 5 個交易日判斷一次；SSE 回報進度，最後的 done 帶 AIBacktestResult。"""
    settings = request.app.state.settings
    return StreamingResponse(
        encode_sse(backtest.events(prepared, settings, LlmClient(settings, request.app.state.http)), allow_nan=False),
        media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.get("/ai-backtest/result", response_model=AIBacktestResult)
def ai_backtest_result(user: Administrator, request: Request, response: Response,
                       prepared: Annotated[backtest.Prepared, Depends(prepared_backtest)]):
    """同一組條件已經跑完、還在快取裡的結果；沒有時回 404，不會呼叫模型。"""
    response.headers["Cache-Control"] = "no-store"
    settings = request.app.state.settings
    cached = backtest.read_cached(backtest.cache_path(settings, prepared, LlmClient(settings).model_name))
    if cached is None:
        raise NotFound("這組條件還沒有跑完的回測結果")
    return cached


@router.get("/ai-conversations/{review_id}", response_model=ChatReviewDetail)
def ai_conversation(review_id: UUID, user: Administrator, db: Database, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return chat_review.get_review(db, str(review_id))


@router.get("/administrators")
def administrators(user: Administrator, db: Database):
    return service.list_administrators(db)


@router.post("/administrators", response_model=ActionResponse)
def grant_administrator(body: GrantAdministratorRequest, user: Administrator, db: Database):
    return service.grant_administrator(db, user, str(body.email))


@router.delete("/administrators/{user_id}", response_model=ActionResponse)
def revoke_administrator(user: Administrator, db: Database, user_id: int = Path(..., gt=0)):
    return service.revoke_administrator(db, user, user_id)


@router.post("/jobs/{job_name}/{action}", response_model=ActionResponse)
def job_action(request: Request, user: Administrator, db: Database,
               job_name: str = Path(..., min_length=1, max_length=80),
               action: str = Path(..., min_length=1, max_length=20),
               body: JobActionRequest | None = Body(None)):
    return service.perform_job(db, user, getattr(request.app.state, "jobs", None), job_name,
                               action, body.run_id if body else None, body.symbol if body else None)
