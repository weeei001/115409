from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from crud import news_article as crud_news
from schemas.news_article import PaginatedNewsResponse


router = APIRouter(prefix="/news", tags=["新聞查詢"])


@router.get(
    "",
    response_model=PaginatedNewsResponse,
    summary="查詢新聞列表",
    description="""
查詢 `news_articles` 新聞列表，支援多條件過濾與分頁。

**可用過濾條件：**
- `article_id`: 文章唯一識別碼（主鍵）
- `keyword`: 關鍵字（在標題與內容中模糊查詢）
- `stock`: 關聯股票（比對 `stock_id`，或在 `tags` 欄位中 LIKE）
- `source`: 新聞來源（cnyes / ltn / udn ...）
- `start_time` / `end_time`: 發布時間區間（比對 `pub_time`）

**排序：**
- `sort_by`: `pub_time` / `created_at`
- `sort_order`: `asc` / `desc`
    """,
    responses={
        200: {"description": "成功返回新聞分頁列表"},
        422: {"description": "查詢參數格式驗證失敗"},
    },
)
def list_news(
    page: int = Query(1, ge=1, description="頁碼（從 1 開始）"),
    page_size: int = Query(20, ge=1, le=200, description="每頁筆數"),
    article_id: Optional[str] = Query(
        None, max_length=64, description="依 article_id 精準查詢"
    ),
    keyword: Optional[str] = Query(
        None, max_length=200, description="關鍵字模糊查詢（標題與內容）"
    ),
    stock: Optional[str] = Query(
        None, max_length=20, description="關聯股票代號（比對 stock_id 與 tags）"
    ),
    source: Optional[str] = Query(
        None, max_length=50, description="新聞來源（精準比對）"
    ),
    start_time: Optional[datetime] = Query(
        None, description="發布時間起（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    end_time: Optional[datetime] = Query(
        None, description="發布時間迄（含），格式 YYYY-MM-DDTHH:MM:SS"
    ),
    sort_by: str = Query(
        "pub_time",
        pattern="^(pub_time|created_at)$",
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
        article_id=article_id,
        keyword=keyword,
        stock=stock,
        source=source,
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
