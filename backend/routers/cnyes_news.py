from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db
from crud import cnyes_news as crud_news
from schemas.cnyes_news import News, PaginatedNewsResponse


router = APIRouter(prefix="/news", tags=["新聞查詢"])


@router.get(
    "",
    response_model=PaginatedNewsResponse,
    summary="查詢新聞列表",
    description="""
查詢 `cnyes_tw_stock_news` 新聞列表，支援多條件過濾與分頁。

**可用過濾條件：**
- `news_id`: 來源新聞編號（唯一值）
- `id`: 主鍵 id
- `keyword`: 關鍵字（在標題與內容中模糊查詢）
- `stock`: 關聯股票（在 `related_stocks` 欄位中 LIKE）
- `start_time` / `end_time`: 發布時間區間

**排序：**
- `sort_by`: `publish_time` / `created_at` / `updated_at`
- `sort_order`: `asc` / `desc`
    """,
)
def list_news(
    page: int = Query(1, ge=1, description="頁碼（從 1 開始）"),
    page_size: int = Query(20, ge=1, le=200, description="每頁筆數"),
    news_id: Optional[int] = Query(None, description="依 news_id 精準查詢"),
    id: Optional[int] = Query(None, description="依主鍵 id 精準查詢"),
    keyword: Optional[str] = Query(
        None, max_length=200, description="關鍵字模糊查詢（標題與內容）"
    ),
    stock: Optional[str] = Query(
        None, max_length=50, description="關聯股票代碼或名稱（LIKE 搜尋）"
    ),
    start_time: Optional[datetime] = Query(
        None, description="發布時間起（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    end_time: Optional[datetime] = Query(
        None, description="發布時間迄（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    sort_by: str = Query(
        "publish_time",
        pattern="^(publish_time|created_at|updated_at)$",
        description="排序欄位",
    ),
    sort_order: str = Query(
        "desc",
        pattern="^(asc|desc)$",
        description="排序方向",
    ),
    db: Session = Depends(get_db),
):
    total, items = crud_news.get_list(
        db,
        page=page,
        page_size=page_size,
        news_id=news_id,
        id_=id,
        keyword=keyword,
        stock=stock,
        start_time=start_time,
        end_time=end_time,
        sort_by=sort_by,
        sort_order=sort_order,
    )

    return PaginatedNewsResponse(
        page=page,
        page_size=page_size,
        total=total,
        items=items,
    )


@router.get(
    "/{id}",
    response_model=News,
    summary="依主鍵 id 取得單筆新聞",
    responses={
        200: {"description": "查詢成功"},
        404: {"description": "找不到資料"},
    },
)
def get_news_by_id(id: int, db: Session = Depends(get_db)):
    news = crud_news.get_by_id(db, id_=id)
    if not news:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="News not found",
        )
    return news


@router.get(
    "/by-news-id/{news_id}",
    response_model=News,
    summary="依 business news_id 取得單筆新聞",
    responses={
        200: {"description": "查詢成功"},
        404: {"description": "找不到資料"},
    },
)
def get_news_by_news_id(news_id: int, db: Session = Depends(get_db)):
    news = crud_news.get_by_news_id(db, news_id=news_id)
    if not news:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="News not found",
        )
    return news


@router.get(
    "/stats/count",
    summary="取得符合條件的新聞總數",
    description="與 `/news` 相同過濾條件，但只回傳統計筆數。",
)
def get_news_count(
    news_id: Optional[int] = Query(None, description="依 news_id 精準查詢"),
    id: Optional[int] = Query(None, description="依主鍵 id 精準查詢"),
    keyword: Optional[str] = Query(
        None, max_length=200, description="關鍵字模糊查詢（標題與內容）"
    ),
    stock: Optional[str] = Query(
        None, max_length=50, description="關聯股票代碼或名稱（LIKE 搜尋）"
    ),
    start_time: Optional[datetime] = Query(
        None, description="發布時間起（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    end_time: Optional[datetime] = Query(
        None, description="發布時間迄（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    db: Session = Depends(get_db),
):
    count = crud_news.get_count(
        db,
        news_id=news_id,
        id_=id,
        keyword=keyword,
        stock=stock,
        start_time=start_time,
        end_time=end_time,
    )
    return {"count": count}

