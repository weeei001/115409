from __future__ import annotations

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


class StockBehaviorRagRequest(BaseModel):
    symbols: List[str] = Field(
        ...,
        min_length=1,
        description="股票代號陣列。Swagger 與目前後端流程只會使用第一個有效代號。",
        examples=[["2330"]],
    )

    model_config = ConfigDict(json_schema_extra={"example": {"symbols": ["2330"]}})


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
    raw_answer: str = Field(
        default="",
        description="RAG 回傳的原始摘要文字。",
    )


class StockBehaviorAiRequest(StockBehaviorRagPayload):
    symbol: str = Field(..., min_length=1, max_length=10, description="單一股票代號，例如 2330。")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "symbol": "2330",
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
                "raw_answer": "近期新聞以先進製程需求與法說會展望為主。",
            }
        }
    )


class TrendAssessment(BaseModel):
    state: TrendState = Field("uncertain", description="趨勢判斷")
    confidence_level: ConfidenceLevel = Field("low", description="信心水準")
    summary: str = Field("", description="趨勢判斷摘要")


class SubjectiveView(BaseModel):
    opinion: str = ""
    supported_evidence: List[str] = Field(default_factory=list)
    invalidation_conditions: List[str] = Field(default_factory=list)


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
    line_disclaimer: str = "此趨勢線為 AI 情境推演，非統計預測，不構成投資建議。"

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
    subjective_view: SubjectiveView = Field(default_factory=SubjectiveView)
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
    subjective_view: SubjectiveView = Field(default_factory=SubjectiveView)
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
    disclaimer: str = "以下為 AI 情境推演，relative_price 為相對尺度，非統計預測或報酬率承諾，不構成任何投資建議。"
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
                "raw_answer": "近期新聞以先進製程需求與法說會展望為主。",
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
                    "disclaimer": "以下為 AI 情境推演，relative_price 為相對尺度，非統計預測或報酬率承諾，不構成任何投資建議。",
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
