import asyncio
from contextlib import aclosing
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.errors import UpstreamTimeout
from app.core.streaming import encode_sse
from app.db.session import get_db
from .schemas import (StockBehaviorRagRequest, StockBehaviorRagResponse,
                      StockBehaviorTextBriefRequest, StockBehaviorTextBriefResponse)
from .prediction import AnalysisDigestResponse, TrendPredictionResponse
from .service import AnalysisService


router = APIRouter(prefix="/analyze/stock-behavior", tags=["AI analysis"])
prediction_router = APIRouter(tags=["AI prediction"])


def get_service(request: Request, db: Session = Depends(get_db)) -> AnalysisService:
    return AnalysisService(db=db, settings=request.app.state.settings, http=request.app.state.http,
                           session_factory=request.app.state.session_factory)


@router.post("/rag", response_model=StockBehaviorRagResponse,
             responses={200: {"description": "Success"}, 422: {"description": "Policy violation"},
                        504: {"description": "Timeout"}})
async def rag(req: StockBehaviorRagRequest, request: Request,
              service: AnalysisService = Depends(get_service)):
    try:
        async with asyncio.timeout(request.app.state.settings.ANALYSIS_TIMEOUT_SECONDS):
            return await service.collect_rag_news(req)
    except TimeoutError as exc:
        raise UpstreamTimeout("分析逾時，請稍後重試") from exc


@router.post("/text-brief", response_model=StockBehaviorTextBriefResponse,
             responses={200: {"description": "Success"}, 422: {"description": "Policy violation"},
                        503: {"description": "Model unavailable"}, 504: {"description": "Timeout"}})
async def text_brief(req: StockBehaviorTextBriefRequest, request: Request,
                     service: AnalysisService = Depends(get_service)):
    try:
        async with asyncio.timeout(request.app.state.settings.ANALYSIS_TIMEOUT_SECONDS):
            return await service.generate_text_brief(req)
    except TimeoutError as exc:
        raise UpstreamTimeout("分析逾時，請稍後重試") from exc


@prediction_router.get("/api/trend_predict", response_model=TrendPredictionResponse,
            responses={404: {"description": "Price data not found"}, 503: {"description": "Model unavailable"},
                       504: {"description": "Timeout"}})
async def trend_predict(request: Request,
                        stock_id: str = Query(..., description="股票代號，如 2330"),
                        service: AnalysisService = Depends(get_service)):
    try:
        async with asyncio.timeout(request.app.state.settings.ANALYSIS_TIMEOUT_SECONDS):
            return await service.generate_trend_prediction(stock_id)
    except TimeoutError as exc:
        raise UpstreamTimeout("預測逾時，請稍後重試") from exc


@prediction_router.get("/api/analysis_digest", response_model=AnalysisDigestResponse,
                       responses={404: {"description": "Digest not found"}})
async def analysis_digest(request: Request,
                          symbol: str = Query(..., description="股票代號，如 2330"),
                          as_of: date = Query(..., description="時間點 YYYY-MM-DD"),
                          period: Literal["week", "month"] = Query("week"),
                          service: AnalysisService = Depends(get_service)):
    return await service.get_analysis_digest(symbol, as_of, period)


async def _bounded_prediction_events(service: AnalysisService, stock_id: str, timeout: int):
    try:
        async with asyncio.timeout(timeout), aclosing(service.stream_trend_prediction(stock_id)) as events:
            async for event in events:
                yield event
    except TimeoutError:
        yield {"type": "error", "message": "預測逾時，請稍後重試"}


@prediction_router.get("/api/trend_predict_stream", response_class=StreamingResponse,
            responses={200: {"content": {"text/event-stream": {}}}})
async def trend_predict_stream(request: Request,
                               stock_id: str = Query(..., description="股票代號，如 2330"),
                               service: AnalysisService = Depends(get_service)):
    events = _bounded_prediction_events(
        service, stock_id, request.app.state.settings.ANALYSIS_TIMEOUT_SECONDS,
    )
    return StreamingResponse(
        encode_sse(events), media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "Connection": "keep-alive"},
    )
