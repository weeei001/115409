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
    retrieval_branch: str = "general"
    shared_fact_ids: list[str] = Field(default_factory=list)
    shared_facts: list[dict] = Field(default_factory=list)
    source_state: dict = Field(default_factory=dict)
    source_relationships: list[dict] = Field(default_factory=list)
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
    content_kind: str | None = None
    content_truncated: bool = False
    analysis_status: str | None = None
    analysis_input_hash: str | None = None
    analysis_config_hash: str | None = None
    impact_scopes: list[str] = Field(default_factory=list)
    impact_company_ids: list[str] = Field(default_factory=list)
    impact_industry_ids: list[str] = Field(default_factory=list)
    impact_directions: list[str] = Field(default_factory=list)
    impact_importance: list[str] = Field(default_factory=list)
    impact_topics: list[str] = Field(default_factory=list)
    impact_context: list[dict] = Field(default_factory=list)


class RetrievalResponse(BaseModel):
    news_sources: list[NewsSource] = Field(default_factory=list)
    no_recent_news: bool = False


@dataclass
class QuestionSearchResult:
    hits: list[dict[str, Any]] = field(default_factory=list)
    time_from: str | None = None
    time_to: str | None = None
    fallback_mode: bool = False
