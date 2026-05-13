from __future__ import annotations

from datetime import date, datetime
from typing import Optional

from pydantic import BaseModel, Field


class ParsedIntent(BaseModel):
    symbols: list[str] = Field(default_factory=list)
    date_start: date
    date_end: date
    original_query: str = ""


class NormalizedNewsChunk(BaseModel):
    id: str
    title: str
    content: str = Field(default="", description="截斷至 ~300 字")
    timestamp: datetime
    url: Optional[str] = Field(None, description="缺少時為 None")
    relevance_score: float = 0.0


class DBData(BaseModel):
    """DB 查詢回傳的三類量化資料"""

    symbol: str
    date_start: date
    date_end: date

    prices: list[dict] = Field(default_factory=list)
    indicators: list[dict] = Field(default_factory=list)
    institutional: list[dict] = Field(default_factory=list)


class ScoreWeights(BaseModel):
    technical: float = 0.35
    institutional: float = 0.25
    news: float = 0.25
    momentum: float = 0.15


class ScoreExplanations(BaseModel):
    technical: str = ""
    institutional: str = ""
    news: str = ""
    momentum: str = ""


class ScoreBreakdown(BaseModel):
    technical_score: float = Field(0.0, ge=-1, le=1)
    institutional_score: float = Field(0.0, ge=-1, le=1)
    news_score: float = Field(0.0, ge=-1, le=1)
    momentum_score: float = Field(0.0, ge=-1, le=1)
    weighted_score: float = Field(0.0, ge=-1, le=1)
    weights: ScoreWeights = Field(default_factory=ScoreWeights)
    explanations: ScoreExplanations = Field(default_factory=ScoreExplanations)


class AnalysisResult(BaseModel):
    summary: str = ""
    sentiment_score: float = Field(0.0, ge=-1, le=1)
    technical_highlights: list[str] = Field(default_factory=list)
    institutional_data: list[dict] = Field(default_factory=list)
    recommendation: str = ""
    recommendation_basis: list[str] = Field(default_factory=list)
    news_sources: list[NormalizedNewsChunk] = Field(default_factory=list)
    score_breakdown: ScoreBreakdown = Field(default_factory=ScoreBreakdown)
    fallback_mode: bool = False
