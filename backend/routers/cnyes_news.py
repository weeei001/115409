from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from crud import cnyes_news as crud_news
from schemas.cnyes_news import PaginatedNewsResponse


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
    responses={
        200: {"description": "成功返回新聞分頁列表"},
        422: {"description": "查詢參數格式驗證失敗"},
    },
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

