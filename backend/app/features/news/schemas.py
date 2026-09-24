from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class EventEvidence(BaseModel):
    field: Literal["title", "content"]
    quote: str


class NewsEvent(BaseModel):
    key: str
    summary: str
    statement_type: Literal["fact", "plan", "forecast", "opinion"]
    speaker: str | None = None
    topics: list[str] = Field(default_factory=list)
    evidence: list[EventEvidence] = Field(default_factory=list)


class EventImpact(BaseModel):
    event_key: str
    target_type: Literal["market", "industry", "company"]
    target_id: str
    target_name: str | None = None
    direction: Literal["positive", "negative", "neutral", "mixed", "uncertain"]
    importance: Literal["high", "medium", "low"]
    basis: Literal["reported", "inferred"]
    reason: str
    evidence: list[EventEvidence] = Field(default_factory=list)


class EventAnalysisResponse(BaseModel):
    status: Literal["pending", "success", "failed", "skipped"] = "pending"
    events: list[NewsEvent] = Field(default_factory=list)
    impacts: list[EventImpact] = Field(default_factory=list)
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
    content_kind: str | None = None
    created_at: datetime | None = None
    event_analysis: EventAnalysisResponse = Field(default_factory=EventAnalysisResponse)

    model_config = ConfigDict(from_attributes=True)


class PaginatedNewsResponse(BaseModel):
    page: int
    page_size: int
    total: int
    items: list[News]
