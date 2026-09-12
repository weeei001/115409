from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel, Field


class RetrievalRequest(BaseModel):
    symbols: list[str]
    as_of: str | None = None
    lookback_days: int = 30
    max_events: int = 10


class NewsSource(BaseModel):
    id: str
    title: str
    summary: str
    timestamp: str
    url: str
    publisher: str = ""
    kind: str = "general"
    article_id: str | None = None
    chunk_id: str | None = None
    chunk_index: int | None = None
    char_start: int | None = None
    char_end: int | None = None
    content_hash: str | None = None
    revision: str | None = None
    index_version: str | None = None
    embedding_model: str | None = None
    stock_ids: list[str] = Field(default_factory=list)


class RetrievalResponse(BaseModel):
    news_sources: list[NewsSource] = Field(default_factory=list)
    no_recent_news: bool = False


@dataclass
class QuestionSearchResult:
    hits: list[dict[str, Any]] = field(default_factory=list)
    time_from: str | None = None
    time_to: str | None = None
    fallback_mode: bool = False
