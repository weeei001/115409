from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

try:
    from langchain_core.exceptions import OutputParserException
    from langchain_core.output_parsers import PydanticOutputParser
except ImportError:  # pragma: no cover - local test fallback
    OutputParserException = ValueError
    PydanticOutputParser = None

try:
    from langchain_openai import ChatOpenAI
except ImportError:  # pragma: no cover - local test fallback
    ChatOpenAI = None

from stock_behavior.prompt_templates import (
    STOCK_ANALYST_SYSTEM_PROMPT,
    build_stock_behavior_prefetched_evidence_user_prompt,
)


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


LLM_ANALYSIS_OUTPUT_PARSER = (
    PydanticOutputParser(pydantic_object=RawProjectionResponse)
    if PydanticOutputParser is not None
    else None
)
LLM_MAX_COMPLETION_TOKENS = 4096


def _coerce_llm_text(content: str | list[Any] | None) -> str:
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return content if isinstance(content, str) else ""


def _load_json_object(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            parsed = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return None
    return parsed if isinstance(parsed, dict) else None


def _is_projection_payload(value: dict[str, Any]) -> bool:
    return "points" in value and "projection" not in value


def _parse_structured_analysis_payload(content: str | list[Any] | None) -> dict[str, Any]:
    text = _coerce_llm_text(content)
    loaded = _load_json_object(text)
    if loaded is not None:
        if _is_projection_payload(loaded):
            parsed_projection = RawProjection.model_validate(loaded)
            return {"projection": parsed_projection.model_dump(mode="python")}
        parsed = RawStructuredAnalysisPayload.model_validate(loaded)
        return parsed.model_dump(mode="python")

    if LLM_ANALYSIS_OUTPUT_PARSER is None:
        parsed = RawStructuredAnalysisPayload.model_validate(json.loads(text))
        return parsed.model_dump(mode="python")

    parsed = LLM_ANALYSIS_OUTPUT_PARSER.parse(text)
    return parsed.model_dump(mode="python")


class StockBehaviorLlmService:
    def __init__(self, settings: Any) -> None:
        self._settings = settings
        self._model = settings.ADVISOR_LLM_MODEL or "meta/llama-3.1-70b-instruct"
        self._enabled = bool(
            settings.NIM_API_KEY and settings.NIM_BASE_URL and self._model
        )
        self._client = (
            ChatOpenAI(
                api_key=settings.NIM_API_KEY,
                base_url=settings.NIM_BASE_URL,
                model=self._model,
                temperature=0.2,
                max_tokens=LLM_MAX_COMPLETION_TOKENS,
                extra_body={"chat_template_kwargs": {"enable_thinking": True}},
            )
            if self._enabled and ChatOpenAI is not None
            else None
        )

    @property
    def enabled(self) -> bool:
        return self._enabled

    @property
    def model_name(self) -> str:
        return self._model

    async def generate_analysis_from_evidence(
        self,
        *,
        task_packet: dict[str, Any],
    ) -> dict[str, Any]:
        if not self._enabled or self._client is None:
            print(
                f"[stock_behavior_llm] stage=prefetched_evidence status=fail reason=disabled "
                f"enabled={self._enabled} model={self._model}"
            )
            raise RuntimeError(
                "LLM service is disabled: missing NIM_API_KEY, NIM_BASE_URL, model, or langchain dependencies"
            )

        user_prompt = build_stock_behavior_prefetched_evidence_user_prompt(
            task_packet=task_packet,
            format_instructions=(
                LLM_ANALYSIS_OUTPUT_PARSER.get_format_instructions()
                if LLM_ANALYSIS_OUTPUT_PARSER is not None
                else json.dumps(RawProjectionResponse.model_json_schema(), ensure_ascii=False)
            ),
        )
        messages = [
            ("system", STOCK_ANALYST_SYSTEM_PROMPT),
            ("human", user_prompt),
        ]

        print(
            f"[stock_behavior_llm] stage=prefetched_evidence status=start model={self._model}"
        )
        response = await self._client.ainvoke(messages)
        raw_content = response.content
        raw_text = _coerce_llm_text(raw_content)

        print(
            "[stock_behavior_llm] stage=prefetched_evidence raw_response",
            {
                "model": self._model,
                "content_type": type(raw_content).__name__,
                "content_len": len(raw_text),
                "content_preview": raw_text[:3000],
            },
        )

        try:
            parsed = _parse_structured_analysis_payload(raw_content)
        except OutputParserException:
            print(
                f"[stock_behavior_llm] stage=prefetched_evidence status=fallback "
                f"reason=structured_parse_failed model={self._model}"
            )
            return {}

        print(
            f"[stock_behavior_llm] stage=prefetched_evidence status=success model={self._model}"
        )
        return parsed
