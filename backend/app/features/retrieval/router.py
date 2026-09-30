from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.features.news.schemas import PaginatedNewsResponse
from .schemas import RetrievalRequest, RetrievalResponse
from .service import RetrievalService


router = APIRouter(tags=["Retrieval"])


def get_service(request: Request) -> RetrievalService:
    return RetrievalService(request.app.state.http, request.app.state.settings,
                            session_factory=request.app.state.session_factory)


@router.post("/api/analyze", response_model=RetrievalResponse,
             responses={400: {"description": "Invalid stock or date"},
                        503: {"description": "Retrieval unavailable"}})
async def analyze(req: RetrievalRequest, service: RetrievalService = Depends(get_service)):
    return await service.analyze(req)


@router.get("/api/retrieval/news", response_model=PaginatedNewsResponse,
            responses={400: {"description": "Invalid stock or date"},
                       503: {"description": "Retrieval unavailable"}})
async def related_news(
    symbol: str = Query(..., min_length=1, max_length=20),
    relation: str = Query("direct", pattern="^(direct|market_context|industry_context)$"),
    lookback_days: int = Query(30, ge=1, le=120),
    limit: int = Query(20, ge=1, le=50),
    as_of: str | None = Query(None, max_length=40),
    start_time: str | None = Query(None, max_length=40),
    end_time: str | None = Query(None, max_length=40),
    direction: str | None = Query(None, pattern="^(positive|negative|neutral|mixed|uncertain)$"),
    scope: str | None = Query(None, pattern="^(company|industry|market)$"),
    industry: str | None = Query(None, max_length=80),
    topic: str | None = Query(None, max_length=80),
    importance: str | None = Query(None, pattern="^(high|medium|low)$"),
    sort_by: str = Query("relevance", pattern="^(relevance|pub_time|created_at|importance)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"),
    page: int = Query(1, ge=1),
    db: Session = Depends(get_db),
    service: RetrievalService = Depends(get_service),
):
    return await service.related_news(db, symbol=symbol, relation=relation,
                                      lookback_days=lookback_days, limit=limit, as_of=as_of,
                                      start_time=start_time, end_time=end_time, direction=direction,
                                      importance=importance, scope=scope, industry=industry, topic=topic, sort_by=sort_by, sort_order=sort_order, page=page)
