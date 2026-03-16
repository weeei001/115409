from datetime import datetime
from typing import Optional, List

from pydantic import BaseModel, Field


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
    updated_at: datetime = Field(..., description="更新時間")

    class Config:
        from_attributes = True


class PaginatedNewsResponse(BaseModel):
    page: int = Field(..., description="目前頁碼（從 1 開始）")
    page_size: int = Field(..., description="每頁筆數")
    total: int = Field(..., description="符合條件的總筆數")
    items: List[News] = Field(..., description="新聞列表")

