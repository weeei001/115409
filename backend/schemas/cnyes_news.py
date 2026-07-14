from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, Field


class NewsBase(BaseModel):
    news_id: int = Field(..., description="來源新聞編號（唯一）")
    title: str = Field(..., max_length=500, description="新聞標題")
    content: Optional[str] = Field(None, description="新聞內文")
    related_stocks: Optional[str] = Field(
        None, max_length=500, description="關聯股票（逗號分隔，例如：2330.TW,2317.TW）"
    )
    publish_time: Optional[datetime] = Field(
        None, description="發布時間（datetime）"
    )
    url: Optional[str] = Field(
        None, max_length=1000, description="原始新聞網址"
    )


class News(NewsBase):
    id: int = Field(..., description="主鍵 id")
    created_at: datetime = Field(..., description="建立時間")

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "id": 1,
                "news_id": 202605200001,
                "title": "台股盤中上漲，電子權值股領軍",
                "content": "台股今日由電子權值股帶動上攻，市場關注後續法說會展望。",
                "related_stocks": "2330.TW,2317.TW",
                "publish_time": "2026-05-20T09:30:00",
                "url": "https://example.com/news/202605200001",
                "created_at": "2026-05-20T10:00:00",
            }
        },
    )


class PaginatedNewsResponse(BaseModel):
    page: int = Field(..., description="目前頁碼（從 1 開始）")
    page_size: int = Field(..., description="每頁筆數")
    total: int = Field(..., description="符合條件的總筆數")
    items: List[News] = Field(..., description="新聞列表")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "page": 1,
                "page_size": 20,
                "total": 1,
                "items": [
                    {
                        "id": 1,
                        "news_id": 202605200001,
                        "title": "台股盤中上漲，電子權值股領軍",
                        "content": "台股今日由電子權值股帶動上攻，市場關注後續法說會展望。",
                        "related_stocks": "2330.TW,2317.TW",
                        "publish_time": "2026-05-20T09:30:00",
                        "url": "https://example.com/news/202605200001",
                        "created_at": "2026-05-20T10:00:00",
                    }
                ],
            }
        }
    )

