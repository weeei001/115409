from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class ParsedIntent(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    date_start: date
    date_end: date
    focus: Literal["technical", "institutional", "news", "general"] = "general"
    original_query: str = ""


class NormalizedNewsChunk(BaseModel):
    id: str
    title: str
    content: str = Field(default="", description="截斷至 ~300 字")
    timestamp: datetime
    url: Optional[str] = Field(None, description="缺少時為 None")
    relevance_score: float = 0.0


class FetchedData(BaseModel):
    """data_fetcher 回傳的彙整結構"""

    symbol: str
    date_start: date
    date_end: date

    prices: list[dict] = Field(default_factory=list)
    indicators: list[dict] = Field(default_factory=list)
    institutional: list[dict] = Field(default_factory=list)
    news: list[NormalizedNewsChunk] = Field(default_factory=list)
    rag_summary: str = Field("", description="RAG API 回傳的 raw_answer 新聞情緒摘要")
    news_fallback: bool = False


class AnalysisResult(BaseModel):
    summary: str = ""
    sentiment_score: float = Field(0.0, ge=-1, le=1)
    technical_highlights: list[str] = Field(default_factory=list)
    institutional_data: list[dict] = Field(default_factory=list)
    recommendation: str = ""
    recommendation_basis: list[str] = Field(default_factory=list)
    news_sources: list[NormalizedNewsChunk] = Field(default_factory=list)
    fallback_mode: bool = False
