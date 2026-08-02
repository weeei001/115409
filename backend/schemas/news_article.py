from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class NewsBase(BaseModel):
    article_id: str = Field(..., max_length=64, description="文章唯一識別碼")
    source: Optional[str] = Field(None, max_length=50, description="新聞來源（cnyes / ltn / udn ...）")
    source_group: Optional[str] = Field(None, max_length=50, description="來源分組")
    stock_id: Optional[str] = Field(None, max_length=20, description="主要關聯股票代號")
    title: Optional[str] = Field(None, description="新聞標題")
    pub_time: Optional[str] = Field(
        None, max_length=40, description="發布時間字串（ISO8601 或 YYYY-MM-DD HH:MM:SS）"
    )
    url: Optional[str] = Field(None, description="原始新聞網址")
    tags: Optional[str] = Field(None, description="標籤／其他關聯股票（逗號分隔）")
    content: Optional[str] = Field(None, description="新聞內文")


class News(NewsBase):
    created_at: Optional[datetime] = Field(None, description="建立時間")

    model_config = ConfigDict(
        from_attributes=True,
        json_schema_extra={
            "example": {
                "article_id": "00218d822300ec667c6f08cf5dfa57b7",
                "source": "ltn",
                "source_group": "ltn",
                "stock_id": "2330",
                "title": "台積電股價反映未來潛力 美媒曝這因素讓它有續漲空間",
                "pub_time": "2025-10-18T22:03:55+08:00",
                "url": "https://ec.ltn.com.tw/article/breakingnews/5216036",
                "tags": "",
                "content": "〔財經頻道／綜合報導〕台積電股價持續吸引投資者關注……",
                "created_at": "2026-07-16T17:13:57",
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
                        "article_id": "00218d822300ec667c6f08cf5dfa57b7",
                        "source": "ltn",
                        "source_group": "ltn",
                        "stock_id": "2330",
                        "title": "台積電股價反映未來潛力 美媒曝這因素讓它有續漲空間",
                        "pub_time": "2025-10-18T22:03:55+08:00",
                        "url": "https://ec.ltn.com.tw/article/breakingnews/5216036",
                        "tags": "",
                        "content": "〔財經頻道／綜合報導〕台積電股價持續吸引投資者關注……",
                        "created_at": "2026-07-16T17:13:57",
                    }
                ],
            }
        }
    )
