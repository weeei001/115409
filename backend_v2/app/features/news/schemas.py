from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class SentimentEvidenceItem(BaseModel):
    field: Literal["title", "content"]
    quote: str = Field(..., max_length=80)


class SentimentResponse(BaseModel):
    target_stock_id: str
    label: str
    reason: str
    evidence: list[SentimentEvidenceItem] = Field(default_factory=list)
    analyzed_at: datetime | None = None


class News(BaseModel):
    article_id: str = Field(..., max_length=64)
    source: str | None = Field(None, max_length=50)
    source_group: str | None = Field(None, max_length=50)
    stock_id: str | None = Field(None, max_length=20)
    title: str | None = None
    pub_time: str | None = Field(None, max_length=40)
    url: str | None = None
    tags: str | None = None
    content: str | None = None
    created_at: datetime | None = None
    sentiments: list[SentimentResponse] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class PaginatedNewsResponse(BaseModel):
    page: int
    page_size: int
    total: int
    items: list[News]
