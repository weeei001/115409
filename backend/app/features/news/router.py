from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.features.news import service
from app.features.news.schemas import News, PaginatedNewsResponse


router = APIRouter(prefix="/news", tags=["News"])


@router.get("", response_model=PaginatedNewsResponse)
def list_news(
    request: Request,
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=200),
    article_id: str | None = Query(None, max_length=64),
    keyword: str | None = Query(None, max_length=200),
    stock: str | None = Query(None, max_length=20),
    source: str | None = Query(None, max_length=50),
    start_time: datetime | None = Query(None), end_time: datetime | None = Query(None),
    scope: str | None = Query(None, pattern="^(market|industry|company)$"),
    industry: str | None = Query(None, max_length=80),
    topic: str | None = Query(None, pattern="^(interest_rates|inflation|exchange_rates|trade_tariffs|geopolitics|energy_materials|regulation|ai|technology_demand|company_operations|capital_markets)$"),
    direction: str | None = Query(None, pattern="^(positive|negative|neutral|mixed|uncertain)$"),
    importance: str | None = Query(None, pattern="^(high|medium|low)$"),
    relation: str | None = Query(None, pattern="^(direct|market_context|industry_context)$"),
    sort_by: str = Query("pub_time", pattern="^(pub_time|created_at|importance)$"),
    sort_order: str = Query("desc", pattern="^(asc|desc)$"), db: Session = Depends(get_db),
):
    return service.news_list(
        db, page=page, page_size=page_size, article_id=article_id, keyword=keyword,
        stock=stock, source=source, start_time=start_time, end_time=end_time,
        scope=scope, industry=industry, topic=topic, direction=direction,
        importance=importance, relation=relation, sort_by=sort_by, sort_order=sort_order,
        settings=request.app.state.settings,
    )


@router.get("/industries")
def list_industries():
    return service.industries()


@router.get("/{article_id}", response_model=News, responses={404: {"description": "Not found"}})
def get_single_news(
    article_id: str, request: Request, stock: str | None = Query(None, max_length=20), db: Session = Depends(get_db),
):
    return service.news_detail(db, article_id, stock, settings=request.app.state.settings)
