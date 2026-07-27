from __future__ import annotations

from datetime import date
from typing import Any, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


SCENARIO_PROJECTION_DAYS = [5, 10, 15, 20, 25, 30, 35, 40]

TrendState = Literal[
    "bullish",
    "mildly_bullish",
    "neutral",
    "mildly_bearish",
    "bearish",
    "uncertain",
]
ConfidenceLevel = Literal["low", "medium", "high"]
RiskLevel = Literal["low", "medium", "high"]
ProjectionDirection = Literal["up", "down", "neutral", "uncertain"]
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
    id: str = Field(default="", description="新聞唯一識別碼。")
    title: str = Field(default="", description="新聞標題。")
    summary: str = Field(default="", description="新聞摘要或內容節錄。")
    timestamp: str = Field(default="", description="新聞時間，ISO 8601 格式。")
    url: Optional[str] = Field(default=None, description="原始新聞網址。")


class StockBehaviorRagPayload(BaseModel):
    news_sources: List[AnalyzeNewsSourceItem] = Field(
        default_factory=list,
        description="RAG 回傳的新聞來源列表。",
    )
    fallback_mode: bool = Field(
        default=False,
        description="是否啟用 fallback 模式。",
    )


class StockBehaviorAiRequest(StockBehaviorRagPayload):
    symbol: str = Field(..., min_length=1, max_length=10, description="單一股票代號，例如 2330。")
    as_of_date: Optional[date] = Field(
        default=None,
        description="分析基準日（含當日收盤資料），預設今天；供歷史回測重放。",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "as_of_date": "2024-01-31",
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


class TrendAssessment(BaseModel):
    state: TrendState = Field("uncertain", description="趨勢判斷")
    confidence_level: ConfidenceLevel = Field("low", description="信心水準")
    summary: str = Field("", description="趨勢判斷摘要")


class ProjectionPointBase(BaseModel):
    day: int
    relative_price: float = 1.0
    predicted_close: Optional[float] = None
    predicted_volume: Optional[float] = None
    direction: ProjectionDirection = "uncertain"
    reason: str = ""
    evidence_ids: List[str] = Field(default_factory=list)


class ProjectionPoint(ProjectionPointBase):
    pass


class ScenarioProjectionBase(BaseModel):
    horizon_days: int = 40
    scenario_name: str = "主情境"
    user_interpretation: str = ""
    summary_for_user: str = ""
    trigger_conditions: List[str] = Field(default_factory=list)
    invalidation_conditions: List[str] = Field(default_factory=list)


class ScenarioProjection(ScenarioProjectionBase):
    scenario_key: str = "primary"
    points: List[ProjectionPoint] = Field(default_factory=list)

    @field_validator("points")
    @classmethod
    def validate_projection_days(cls, value: List[ProjectionPoint]) -> List[ProjectionPoint]:
        actual_days = [item.day for item in value]
        if actual_days != SCENARIO_PROJECTION_DAYS:
            raise ValueError(f"projection.points days must be exactly {SCENARIO_PROJECTION_DAYS}")
        return value


class RiskItem(BaseModel):
    risk_type: str = ""
    description: str = ""
    watch_condition: str = ""


class RagReferenceAnalysis(BaseModel):
    raw_answer_used_as: Literal["reference_only"] = "reference_only"
    rag_sentiment: Literal["bullish", "neutral", "bearish", "mixed", "unknown"] = "unknown"
    rag_summary: str = ""
    news_sources_count: int = 0
    is_confirmed_by_price_volume: bool = False
    is_confirmed_by_chip: bool = False
    is_confirmed_by_technical: bool = False
    conflicts: List[str] = Field(default_factory=list)
    notes: List[str] = Field(default_factory=list)


class EvidenceUsedObjective(BaseModel):
    field: str = ""
    date: str = ""
    value: Any = None
    usage: str = ""

class EvidenceUsed(BaseModel):
    price_volume: List[EvidenceUsedObjective] = Field(default_factory=list)
    chip: List[EvidenceUsedObjective] = Field(default_factory=list)
    technical: List[EvidenceUsedObjective] = Field(default_factory=list)
    news: List[EvidenceUsedObjective] = Field(default_factory=list)


class StockBehaviorAnalysisPayload(BaseModel):
    data_gap: List[str] = Field(default_factory=list)
    observations: List[str] = Field(default_factory=list)
    inferences: List[str] = Field(default_factory=list)
    summary: str = ""
    current_trend_assessment: TrendAssessment = Field(default_factory=TrendAssessment)
    projection: ScenarioProjection = Field(default_factory=ScenarioProjection)
    risk_level: RiskLevel = "medium"
    risk_analysis: List[RiskItem] = Field(default_factory=list)
    rag_reference_analysis: RagReferenceAnalysis = Field(default_factory=RagReferenceAnalysis)
    evidence_used: EvidenceUsed = Field(default_factory=EvidenceUsed)
    limitations: List[str] = Field(default_factory=list)


class StockBehaviorPublicProjectionPoint(ProjectionPointBase):
    pass


class StockBehaviorPublicScenarioProjection(ScenarioProjectionBase):
    scenario_name: str = ""
    points: List[StockBehaviorPublicProjectionPoint] = Field(default_factory=list)


class StockBehaviorPublicAnalysisPayload(BaseModel):
    observations: List[str] = Field(default_factory=list)
    inferences: List[str] = Field(default_factory=list)
    summary: str = ""
    current_trend_assessment: TrendAssessment = Field(default_factory=TrendAssessment)
    projection: StockBehaviorPublicScenarioProjection = Field(default_factory=StockBehaviorPublicScenarioProjection)
    risk_level: RiskLevel = "medium"
    risk_analysis: List[RiskItem] = Field(default_factory=list)
    evidence_used: EvidenceUsed = Field(default_factory=EvidenceUsed)


class StockBehaviorInventoryItem(BaseModel):
    id: str
    field: str
    date: Optional[str] = None
    date_range: Optional[str] = None
    value: Any
    streak_days: Optional[int] = None
    reference_only: Optional[bool] = None


class StockBehaviorDataInventory(BaseModel):
    price_volume: List[StockBehaviorInventoryItem] = Field(default_factory=list)
    chip: List[StockBehaviorInventoryItem] = Field(default_factory=list)
    technical: List[StockBehaviorInventoryItem] = Field(default_factory=list)
    news: List[StockBehaviorInventoryItem] = Field(default_factory=list)
    missing_fields: List[str] = Field(default_factory=list)


class StockBehaviorAiProjectionPoint(ProjectionPointBase):
    pass


class StockBehaviorAiProjection(BaseModel):
    horizon_days: int = 40
    scenario_key: str = "primary"
    base_close: Optional[float] = None
    base_volume: Optional[float] = None
    points: List[StockBehaviorAiProjectionPoint] = Field(default_factory=list)

    @field_validator("points")
    @classmethod
    def validate_projection_days(cls, value: List[StockBehaviorAiProjectionPoint]) -> List[StockBehaviorAiProjectionPoint]:
        actual_days = [item.day for item in value]
        if actual_days != SCENARIO_PROJECTION_DAYS:
            raise ValueError(f"projection.points days must be exactly {SCENARIO_PROJECTION_DAYS}")
        return value


class StockBehaviorResponseBase(BaseModel):
    symbol: str = Field(..., description="股票代號")
    as_of_date: str = Field(..., description="分析基準日期")


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


class StockBehaviorAiResponse(StockBehaviorResponseBase):
    generated_by: str = Field(..., description="產生分析的模型或後端策略名稱")
    summary: str = Field("", description="AI 分析摘要，供前端直接呈現。")
    data_inventory: StockBehaviorDataInventory = Field(default_factory=StockBehaviorDataInventory)
    projection: StockBehaviorAiProjection = Field(default_factory=StockBehaviorAiProjection)

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
                "as_of_date": "2026-05-20",
                "generated_by": "primary",
                "summary": "價量與技術面顯示短線動能偏強，但法人籌碼仍需觀察，後續情境以溫和震盪偏多為主。",
                "data_inventory": {
                    "price_volume": [],
                    "chip": [],
                    "technical": [],
                    "news": [],
                    "missing_fields": [],
                },
                "projection": {
                    "horizon_days": 40,
                    "scenario_key": "primary",
                    "base_close": 920.0,
                    "base_volume": 32100000.0,
                    "points": [
                        {
                            "day": 5,
                            "relative_price": 1.01,
                            "predicted_close": 929.2,
                            "predicted_volume": 33000000.0,
                            "direction": "up",
                            "reason": "短期新聞與價量資料偏正向。",
                            "evidence_ids": ["news-001"],
                        }
                    ],
                },
            }
        }
    )


class TextBriefClaim(BaseModel):
    id: str
    claim_type: Literal["observation", "inference", "conflict", "limitation"]
    text: str = Field(max_length=160)
    direction: ClaimDirection
    evidence_ids: list[str] = Field(default_factory=list)
    importance: Literal["high", "medium"] = "medium"


class TextBriefEvent(BaseModel):
    id: str
    event_date: str | None = None
    recency: Literal["today", "recent", "background"]
    title: str
    description: str
    information_type: Literal["event", "opinion", "mixed"]
    evidence_ids: list[str] = Field(default_factory=list)
    materiality: Literal["high", "medium"] = "medium"


class TextBriefThesis(BaseModel):
    statement: str
    status: Literal["new", "insufficient_data"]
    evidence_ids: list[str] = Field(default_factory=list)


class StockBehaviorTextBrief(BaseModel):
    headline: str = Field(max_length=80)
    current_status: list[TextBriefClaim] = Field(min_length=1, max_length=3)
    key_reasons: list[TextBriefClaim] = Field(min_length=2, max_length=4)
    events: list[TextBriefEvent] = Field(default_factory=list, max_length=3)
    source_divergences: list[TextBriefClaim] = Field(default_factory=list, max_length=3)
    thesis: TextBriefThesis
    overall_stance: StanceLevel
    confidence: ConfidenceLevel
    confidence_reason: str
    limitations: list[str] = Field(default_factory=list, max_length=5)


class TextBriefVerification(BaseModel):
    filtered_evidence_ids: list[str] = Field(default_factory=list)
    compliance_violations: list[str] = Field(default_factory=list)
    simplified_chars: list[str] = Field(default_factory=list)
    future_dated_items: list[str] = Field(default_factory=list)
    removed_item_ids: list[str] = Field(default_factory=list)
    soft_compliance_hits: list[str] = Field(default_factory=list)


class TextBriefDisclaimer(BaseModel):
    version: str
    text: str


class StockBehaviorTextBriefResponse(BaseModel):
    schema_version: str = "text-first-v1"
    symbol: str
    as_of_date: str
    generated_by: str
    status: Literal["verified", "limited", "unavailable"]
    brief: StockBehaviorTextBrief | None
    evidence_catalog: list[StockBehaviorInventoryItem] = Field(default_factory=list)
    verification: TextBriefVerification
    disclaimer: TextBriefDisclaimer
    limitations: list[str] = Field(default_factory=list)


class RawTextBriefClaim(BaseModel):
    id: Any = None
    claim_type: Any = None
    text: Any = None
    direction: Any = None
    evidence_ids: Any = Field(default_factory=list)
    importance: Any = "medium"


class RawTextBriefEvent(BaseModel):
    id: Any = None
    event_date: Any = None
    recency: Any = None
    title: Any = None
    description: Any = None
    information_type: Any = None
    evidence_ids: Any = Field(default_factory=list)
    materiality: Any = "medium"


class RawTextBriefThesis(BaseModel):
    statement: Any = None
    status: Any = None
    evidence_ids: Any = Field(default_factory=list)


class RawStockBehaviorTextBrief(BaseModel):
    headline: Any = None
    current_status: Any = Field(default_factory=list)
    key_reasons: Any = Field(default_factory=list)
    events: Any = Field(default_factory=list)
    source_divergences: Any = Field(default_factory=list)
    thesis: Any = None
    overall_stance: Any = None
    confidence: Any = None
    confidence_reason: Any = None
    limitations: Any = Field(default_factory=list)
