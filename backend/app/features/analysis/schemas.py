from __future__ import annotations

from datetime import date
from typing import Annotated, Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.json_schema import SkipJsonSchema

ConfidenceLevel = Literal["low", "medium", "high"]
ClaimDirection = Literal["positive", "negative", "mixed", "neutral", "not_applicable"]
StanceLevel = Literal[
    "bullish",
    "mildly_bullish",
    "mixed",
    "neutral",
    "mildly_bearish",
    "bearish",
    "uncertain",
]
class StockBehaviorRagRequest(BaseModel):
    symbols: List[str] = Field(
        ...,
        min_length=1,
        description="股票代號陣列。Swagger 與目前後端流程只會使用第一個有效代號。",
        examples=[["2330"]],
    )
    as_of_date: Optional[date] = Field(
        default=None,
        description="分析基準日（含當日收盤資料），預設今天；供歷史回測重放。",
    )
    lookback_days: Optional[int] = Field(
        default=None,
        ge=1,
        le=120,
        description="新聞回溯天數；預設由後端使用 30 天。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbols": ["2330"],
                "as_of_date": "2024-01-31",
                "lookback_days": 30,
            }
        }
    )

class AnalyzeNewsSourceItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(default="", description="新聞唯一識別碼。")
    title: str = Field(default="", description="新聞標題。")
    summary: str = Field(default="", description="新聞摘要或內容節錄。")
    timestamp: str = Field(default="", description="新聞時間，ISO 8601 格式。")
    url: Optional[str] = Field(default=None, description="原始新聞網址。")
    publisher: Optional[str] = Field(
        default=None,
        description="發布媒體可讀名稱，由 RAG 端的 ingest metadata 對照而來；舊快照可能沒有。",
    )
    kind: Literal["general", "guidance"] = Field(
        default="general",
        description="general 為一般報導，guidance 為媒體轉述的公司財測／展望。",
    )

class StockBehaviorRagPayload(BaseModel):
    news_sources: List[AnalyzeNewsSourceItem] = Field(
        default_factory=list,
        description="RAG 回傳的新聞來源列表。",
    )
    fallback_mode: bool = Field(
        default=False,
        description="是否啟用 fallback 模式。",
    )

class StockBehaviorRagResponse(StockBehaviorRagPayload):
    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "news_sources": [
                    {
                        "id": "news-001",
                        "title": "台積電法說會展望受關注",
                        "summary": "市場關注先進製程需求與資本支出展望。",
                        "timestamp": "2026-05-20T09:30:00",
                        "url": "https://example.com/news/news-001",
                    }
                ],
                "fallback_mode": False,
            }
        }
    )

class StockBehaviorTextBriefRequest(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=10, description="單一股票代號，例如 2330。")
    as_of_date: Optional[date] = Field(
        default=None,
        description="分析基準日（含當日收盤資料），預設今天；供歷史回測重放。",
    )
    force_refresh: bool = Field(
        default=False,
        description="略過既有快照，強制重新呼叫 LLM；cache_only 為 true 時不生效。",
    )
    cache_only: bool = Field(
        default=False,
        description=(
            "只讀 llm_responses 中基準日以前（含當日）最新有效快照，不核對目前模型設定或來源版本，"
            "不呼叫 LLM；查無則回 `status=unavailable`。優先於 force_refresh，實際產生交給排程。"
        ),
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "as_of_date": "2026-07-13",
                "force_refresh": False,
            }
        }
    )

EvidenceId = Annotated[str, Field(max_length=16, pattern=r"^(d|ch|lt|fd|nw)_[0-9]+$")]


class TextBriefNewsSupport(BaseModel):
    evidence_id: EvidenceId
    quote: str = Field(min_length=4, max_length=100)
    use: Literal["reported_fact", "attributed_view", "retrospective", "price_reaction"]
    event_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")


class TextBriefClaim(BaseModel):
    id: str
    claim_type: Literal["observation", "inference", "conflict", "limitation"]
    text: str = Field(max_length=160)
    direction: ClaimDirection
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    importance: Literal["high", "medium"] = "medium"
    news_support: list[TextBriefNewsSupport] = Field(default_factory=list, max_length=3)

class TextBriefKeyDay(BaseModel):

    id: str
    date: str
    ref: str
    what: str = Field(max_length=200)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    move_pct: Optional[float] = None
    volume_ratio: Optional[float] = None
    news_support: list[TextBriefNewsSupport] = Field(default_factory=list, max_length=1)

class TextBriefRisk(BaseModel):
    id: str
    risk_type: str = Field(max_length=20)
    description: str = Field(max_length=160)
    trigger: str = Field(max_length=120)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    news_support: list[TextBriefNewsSupport] = Field(default_factory=list, max_length=3)

class TextBriefWatchPoint(BaseModel):
    id: str
    what_to_watch: str = Field(max_length=80)
    why_it_matters: str = Field(max_length=160)
    when: str = Field(max_length=40)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    news_support: list[TextBriefNewsSupport] = Field(default_factory=list, max_length=3)

class TextBriefForwardView(BaseModel):
    stance: StanceLevel
    reason: str = Field(max_length=160)
    invalidation: str = Field(max_length=120)
    evidence_ids: list[EvidenceId] = Field(default_factory=list, max_length=6)
    news_support: list[TextBriefNewsSupport] = Field(default_factory=list, max_length=3)
    validation_status: SkipJsonSchema[Literal["rejected"] | None] = None

class TextBriefForwardViews(BaseModel):
    short_1_5: TextBriefForwardView
    swing_6_20: TextBriefForwardView
    medium_21_40: TextBriefForwardView

class StockBehaviorTextBrief(BaseModel):
    key_days: list[TextBriefKeyDay] = Field(max_length=5)
    headline: str = Field(max_length=80)
    current_status: list[TextBriefClaim] = Field(max_length=3)
    positive_factors: list[TextBriefClaim] = Field(max_length=3)
    negative_factors: list[TextBriefClaim] = Field(max_length=3)
    source_divergences: list[TextBriefClaim] = Field(default_factory=list, max_length=3)
    risks: list[TextBriefRisk] = Field(max_length=3)
    watch_points: list[TextBriefWatchPoint] = Field(max_length=4)
    forward_views: TextBriefForwardViews
    overall_stance: StanceLevel
    confidence: ConfidenceLevel
    confidence_reason: str = Field(max_length=160)
    limitations: list[str] = Field(default_factory=list, max_length=5)

class TextBriefVerification(BaseModel):
    filtered_evidence_ids: list[str] = Field(default_factory=list)
    compliance_violations: list[str] = Field(default_factory=list)
    simplified_chars: list[str] = Field(default_factory=list)
    future_dated_items: list[str] = Field(default_factory=list)
    removed_item_ids: list[str] = Field(default_factory=list)
    soft_compliance_hits: list[str] = Field(default_factory=list)
    unverified_numbers: list[str] = Field(default_factory=list)
    undercount_sections: list[str] = Field(default_factory=list)
    truncated_sections: list[str] = Field(default_factory=list)
    jargon_hits: list[str] = Field(default_factory=list)

class TextBriefDisclaimer(BaseModel):
    version: str
    text: str

class StockBehaviorEvidenceItem(BaseModel):

    model_config = ConfigDict(extra="allow")

    id: str
    field: str
    date: Optional[str] = None
    value: Any = None

class StockBehaviorTextBriefResponse(BaseModel):
    schema_version: str = "text-first-v1"
    symbol: str
    as_of_date: str
    generated_by: str
    status: Literal["verified", "limited", "unavailable"]
    brief: StockBehaviorTextBrief | None
    evidence_catalog: list[StockBehaviorEvidenceItem] = Field(default_factory=list)
    disclaimer: TextBriefDisclaimer
    limitations: list[str] = Field(default_factory=list)
    cached: bool = False
    analysis_mode: Literal["current_analysis", "historical_reanalysis"] | None = None
    price_as_of_date: str | None = None
    news_cutoff_date: str | None = None
    verification: dict[str, int] = Field(default_factory=dict)
    verification_scope: str = "structure_citations_and_selected_numbers"
    snapshot_id: int | None = None
    generated_at: str | None = None
    analysis_revision: str | None = None
    config_hash: str | None = None

class RawTextBriefClaim(BaseModel):
    id: Any = None
    claim_type: Any = None
    text: Any = None
    direction: Any = None
    evidence_ids: Any = Field(default_factory=list)
    news_support: Any = Field(default_factory=list)
    importance: Any = "medium"

class RawTextBriefKeyDay(BaseModel):
    id: Any = None
    date: Any = None
    ref: Any = None
    what: Any = None
    evidence_ids: Any = Field(default_factory=list)
    news_support: Any = Field(default_factory=list)

class RawTextBriefRisk(BaseModel):
    id: Any = None
    risk_type: Any = None
    description: Any = None
    trigger: Any = None
    evidence_ids: Any = Field(default_factory=list)
    news_support: Any = Field(default_factory=list)

class RawTextBriefWatchPoint(BaseModel):
    id: Any = None
    what_to_watch: Any = None
    why_it_matters: Any = None
    when: Any = None
    evidence_ids: Any = Field(default_factory=list)
    news_support: Any = Field(default_factory=list)

class RawTextBriefForwardView(BaseModel):
    stance: Any = None
    reason: Any = None
    invalidation: Any = None
    evidence_ids: Any = Field(default_factory=list)
    news_support: Any = Field(default_factory=list)

class RawStockBehaviorTextBrief(BaseModel):
    key_days: Any = Field(default_factory=list)
    headline: Any = None
    current_status: Any = Field(default_factory=list)
    positive_factors: Any = Field(default_factory=list)
    negative_factors: Any = Field(default_factory=list)
    source_divergences: Any = Field(default_factory=list)
    risks: Any = Field(default_factory=list)
    watch_points: Any = Field(default_factory=list)
    forward_views: Any = None
    overall_stance: Any = None
    confidence: Any = None
    confidence_reason: Any = None
    limitations: Any = Field(default_factory=list)
