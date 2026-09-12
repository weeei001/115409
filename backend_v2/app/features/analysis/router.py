import asyncio

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.errors import UpstreamTimeout
from app.db.session import get_db
from .schemas import (StockBehaviorRagRequest, StockBehaviorRagResponse,
                      StockBehaviorTextBriefRequest, StockBehaviorTextBriefResponse)
from .service import AnalysisService


router = APIRouter(prefix="/analyze/stock-behavior", tags=["AI analysis"])


def get_service(request: Request, db: Session = Depends(get_db)) -> AnalysisService:
    return AnalysisService(db=db, settings=request.app.state.settings, http=request.app.state.http)


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
