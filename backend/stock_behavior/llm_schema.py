from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class RawTrendAssessment(BaseModel):
    state: Any = "uncertain"
    confidence: Any = None
    confidence_level: Any = None
    summary: Any = ""


class RawSubjectiveView(BaseModel):
    opinion: Any = ""
    supported_evidence: Any = Field(default_factory=list)
    invalidation_conditions: Any = Field(default_factory=list)


class RawProjectionPoint(BaseModel):
    day: Any = None
    relative_price: Any = None
    predicted_close: Any = None
    predicted_volume: Any = None
    direction: Any = "uncertain"
    reason: Any = ""
    description: Any = None
    plain_language_explanation: Any = ""
    price: Any = None
    close: Any = None
    volume: Any = None
    volume_shares: Any = None
    evidence_ids: Any = Field(default_factory=list)


class RawProjection(BaseModel):
    horizon_days: Any = None
    scenario_key: Any = None
    scenario_name: Any = None
    user_interpretation: Any = None
    summary_for_user: Any = None
    trigger_conditions: Any = Field(default_factory=list)
    invalidation_conditions: Any = Field(default_factory=list)
    points: Any = None
    projection_points: Any = None
    base_line: Any = None
    base: Any = None
    line_disclaimer: Any = None


class RawProjectionResponse(BaseModel):
    projection: RawProjection = Field(default_factory=RawProjection)


class RawScenarioProjection(BaseModel):
    scenario_key: Any = None
    scenario_name: Any = None
    scenario_role: Any = None
    user_interpretation: Any = None
    trigger_conditions: Any = Field(default_factory=list)
    invalidation_conditions: Any = Field(default_factory=list)
    projection_points: Any = None


class RawScenarioProjections(BaseModel):
    primary_scenario_key: Any = None
    summary_for_user: Any = None
    scenarios: Any = Field(default_factory=list)


class RawRiskItem(BaseModel):
    risk_type: Any = ""
    description: Any = ""
    watch_condition: Any = ""


class RawRagReferenceAnalysis(BaseModel):
    raw_answer_used_as: Any = "reference_only"
    rag_sentiment: Any = "unknown"
    rag_summary: Any = ""
    news_sources_count: Any = 0
    is_confirmed_by_price_volume: Any = False
    is_confirmed_by_chip: Any = False
    is_confirmed_by_technical: Any = False
    conflicts: Any = Field(default_factory=list)
    notes: Any = Field(default_factory=list)


class RawEvidenceUsed(BaseModel):
    price_volume: Any = Field(default_factory=list)
    chip: Any = Field(default_factory=list)
    technical: Any = Field(default_factory=list)
    news: Any = Field(default_factory=list)


class RawScenarioTrendLine(BaseModel):
    horizon_days: Any = None
    base_line: Any = Field(default_factory=list)
    base: Any = Field(default_factory=list)
    line_disclaimer: Any = None


class RawStructuredAnalysisPayload(BaseModel):
    data_gap: Any = Field(default_factory=list)
    observations: Any = Field(default_factory=list)
    inferences: Any = Field(default_factory=list)
    summary: Any = ""
    current_trend_assessment: RawTrendAssessment = Field(default_factory=RawTrendAssessment)
    subjective_view: RawSubjectiveView = Field(default_factory=RawSubjectiveView)
    projection: RawProjection | None = None
    scenario_projections: RawScenarioProjections | None = None
    llm_scenario_trend_line: RawScenarioTrendLine | None = None
    risk_level: Any = "medium"
    risk_analysis: Any = Field(default_factory=list)
    rag_reference_analysis: RawRagReferenceAnalysis | None = None
    evidence_used: RawEvidenceUsed | list[Any] = Field(default_factory=RawEvidenceUsed)
    limitations: Any = Field(default_factory=list)
