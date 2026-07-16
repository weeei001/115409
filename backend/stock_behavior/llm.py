from __future__ import annotations

import json
import re
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
    TEXT_BRIEF_SYSTEM_PROMPT,
)
from stock_behavior.utils import detect_simplified_chinese


class RawTrendAssessment(BaseModel):
    state: Any = "uncertain"
    confidence: Any = None
    confidence_level: Any = None
    summary: Any = ""


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


class RawProjectionResponse(BaseModel):
    summary: Any = ""
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


class RawStructuredAnalysisPayload(BaseModel):
    data_gap: Any = Field(default_factory=list)
    observations: Any = Field(default_factory=list)
    inferences: Any = Field(default_factory=list)
    summary: Any = ""
    current_trend_assessment: RawTrendAssessment = Field(default_factory=RawTrendAssessment)
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
LLM_MAX_COMPLETION_TOKENS = 8192
LLM_TIMEOUT_SECONDS = 900
THINKING_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>\s*", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
JSON_NUMBER_RE = r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?"
JSON_NUMERIC_EXPR_RE = re.compile(
    rf"(?P<prefix>:\s*)(?P<left>{JSON_NUMBER_RE})\s*(?P<op>[*/])\s*(?P<right>{JSON_NUMBER_RE})(?P<suffix>\s*[,}}\]])"
)
TEXT_BRIEF_OUTPUT_SCHEMA = """{
  "headline": "string (max 80)",
  "current_status": "TextBriefClaim[1..3]",
  "key_reasons": "TextBriefClaim[2..4]",
  "events": "TextBriefEvent[0..3]",
  "potential_impacts": "TextBriefImpact[0..3]",
  "source_divergences": "TextBriefClaim[0..3]",
  "watch_conditions": "TextBriefCondition[1..3]",
  "forward_views": "TextBriefForwardView[3], horizons short_1_5|swing_6_20|medium_21_40 each once",
  "thesis": "TextBriefThesis",
  "overall_stance": "bullish|mildly_bullish|mixed|neutral|mildly_bearish|bearish|uncertain",
  "confidence": "low|medium|high",
  "confidence_reason": "string",
  "limitations": "string[0..5]",
  "TextBriefClaim": {"id":"string","claim_type":"observation|inference|conflict|limitation","text":"string max 160","direction":"positive|negative|mixed|neutral|not_applicable","evidence_ids":"string[]","importance":"high|medium"},
  "TextBriefEvent": {"id":"string","event_date":"ISO date|null","recency":"today|recent|background","title":"string","description":"string","information_type":"event|opinion|mixed","evidence_ids":"string[]","materiality":"high|medium"},
  "TextBriefImpact": {"id":"string","source_item_ids":"string[]","text":"string","direction":"positive|negative|neutral|mixed|uncertain","time_horizon":"immediate|short|medium|unknown","thesis_effect":"strengthens|weakens|unchanged|uncertain","evidence_ids":"string[]"},
  "TextBriefCondition": {"id":"string","kind":"confirmation|invalidation|risk","trigger":{"metric":"close_vs_ma20|close_vs_ma60|volume_vs_ma5|volume_vs_ma20|foreign_net_daily|foreign_net_10d|trust_net_daily|macd_histogram|rsi_level|named_event","operator":"crosses_above|crosses_below|stays_above|stays_below|turns_positive|turns_negative|occurs","persistence_sessions":"integer 1..5","event_ref":"string|null"},"then":{"effect_on_view":"strengthens|weakens|invalidates","direction":"bullish|mildly_bullish|mixed|neutral|mildly_bearish|bearish|uncertain","within_trading_days":"5|20|40","text":"string"},"rationale":"string","evidence_ids":"string[]","scorable":false},
  "TextBriefForwardView": {"horizon":"short_1_5|swing_6_20|medium_21_40","text":"string","stance":"bullish|mildly_bullish|mixed|neutral|mildly_bearish|bearish|uncertain","confidence":"low|medium|high","basis_item_ids":"string[]","evidence_ids":"string[]","confirmation_condition_ids":"string[]","invalidation_condition_ids":"string[]"},
  "TextBriefThesis": {"statement":"string","status":"new|insufficient_data","evidence_ids":"string[]"}
}"""


def _build_stock_behavior_system_prompt(format_instructions: str = "") -> str:
    if not format_instructions.strip():
        return STOCK_ANALYST_SYSTEM_PROMPT
    return (
        f"{STOCK_ANALYST_SYSTEM_PROMPT.rstrip()}\n\n"
        f"請嚴格遵守以下輸出格式要求：\n{format_instructions.strip()}"
    )


def _coerce_llm_text(content: str | list[Any] | None) -> str:
    if isinstance(content, list):
        return "\n".join(
            str(item.get("text", ""))
            for item in content
            if isinstance(item, dict) and item.get("type") == "text"
        )
    return content if isinstance(content, str) else ""


def _clean_llm_json_text(text: str) -> str:
    cleaned = THINKING_BLOCK_RE.sub("", text).strip()
    return CODE_FENCE_RE.sub("", cleaned).strip()


def _repair_json_numeric_expressions(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        left = float(match.group("left"))
        right = float(match.group("right"))
        if match.group("op") == "/" and right == 0:
            return match.group(0)
        value = left * right if match.group("op") == "*" else left / right
        return f"{match.group('prefix')}{value}{match.group('suffix')}"

    return JSON_NUMERIC_EXPR_RE.sub(replace, text)


def _thinking_extra_body(model: str) -> dict[str, Any]:
    model = model.lower()
    if model.startswith(("deepseek-ai/", "moonshotai/")):
        return {"chat_template_kwargs": {"thinking": False}}
    if model.startswith(("qwen/", "z-ai/")):
        return {"chat_template_kwargs": {"enable_thinking": False}}
    return {}


def _load_json_object(text: str) -> dict[str, Any] | None:
    text = _clean_llm_json_text(text)
    repaired_text = _repair_json_numeric_expressions(text)
    candidates = (text,) if repaired_text == text else (text, repaired_text)

    for candidate in candidates:
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None

    decoder = json.JSONDecoder()
    for candidate in candidates:
        if not candidate.startswith("{"):
            continue
        try:
            parsed, _ = decoder.raw_decode(candidate)
        except json.JSONDecodeError:
            continue
        return parsed if isinstance(parsed, dict) else None
    return None


def _is_projection_payload(value: dict[str, Any]) -> bool:
    return "points" in value and "projection" not in value


def _parse_structured_analysis_payload(content: str | list[Any] | None) -> dict[str, Any]:
    text = _coerce_llm_text(content)
    loaded = _load_json_object(text)
    if loaded is None:
        raise ValueError("LLM output is not a complete root JSON object")
    if _is_projection_payload(loaded):
        parsed_projection = RawProjection.model_validate(loaded)
        return {"projection": parsed_projection.model_dump(mode="python")}
    parsed = RawStructuredAnalysisPayload.model_validate(loaded)
    return parsed.model_dump(mode="python")


class StockBehaviorLlmService:
    def __init__(self, settings: Any) -> None:
        self._settings = settings
        self._model = settings.ADVISOR_LLM_MODEL or "meta/llama-3.1-70b-instruct"
        self._max_completion_tokens = getattr(
            settings,
            "ADVISOR_LLM_MAX_COMPLETION_TOKENS",
            LLM_MAX_COMPLETION_TOKENS,
        )
        self._response_format = getattr(
            settings,
            "ADVISOR_LLM_RESPONSE_FORMAT",
            "json_object",
        )
        self._enabled = bool(
            settings.NIM_API_KEY and settings.NIM_BASE_URL and self._model
        )
        self._client = (
            ChatOpenAI(
                api_key=settings.NIM_API_KEY,
                base_url=settings.NIM_BASE_URL,
                model=self._model,
                temperature=getattr(settings, "ADVISOR_LLM_TEMPERATURE", 0.2),
                timeout=LLM_TIMEOUT_SECONDS,
                max_completion_tokens=self._max_completion_tokens,
                model_kwargs=(
                    {"response_format": {"type": "json_object"}}
                    if self._response_format == "json_object"
                    else {}
                ),
                extra_body=_thinking_extra_body(self._model),
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
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        if not self._enabled or self._client is None:
            print(
                f"[stock_behavior_llm] stage=prefetched_evidence status=fail reason=disabled "
                f"enabled={self._enabled} model={self._model}"
            )
            raise RuntimeError(
                "LLM service is disabled: missing NIM_API_KEY, NIM_BASE_URL, model, or langchain dependencies"
            )

        format_instructions = (
            LLM_ANALYSIS_OUTPUT_PARSER.get_format_instructions()
            if LLM_ANALYSIS_OUTPUT_PARSER is not None
            else json.dumps(RawProjectionResponse.model_json_schema(), ensure_ascii=False)
        )
        system_prompt = _build_stock_behavior_system_prompt(format_instructions)
        payload = json.dumps(task_packet, ensure_ascii=False, default=str)
        user_prompt = (
            f"<prefetched_evidence_payload>\n{payload}\n</prefetched_evidence_payload>"
        )
        messages = [
            ("system", system_prompt),
            ("human", user_prompt),
        ]

        print(
            f"[stock_behavior_llm] stage=prefetched_evidence status=start model={self._model}"
        )
        response = await self._client.ainvoke(messages)
        raw_content = response.content
        raw_text = _coerce_llm_text(raw_content)
        response_metadata = getattr(response, "response_metadata", {}) or {}
        finish_reason = response_metadata.get("finish_reason")
        token_usage = response_metadata.get("token_usage") or {}
        completion_tokens = token_usage.get("completion_tokens")
        if completion_tokens is None:
            completion_tokens = (getattr(response, "usage_metadata", {}) or {}).get(
                "output_tokens"
            )
        meta = {
            "finish_reason": finish_reason,
            "completion_tokens": (
                completion_tokens if isinstance(completion_tokens, int) else None
            ),
            "truncated": finish_reason == "length",
        }

        print(
            "[stock_behavior_llm] stage=prefetched_evidence raw_response",
            {
                "model": self._model,
                "content_type": type(raw_content).__name__,
                "content_len": len(raw_text),
                "content_preview": raw_text[:3000],
            },
        )

        if meta["truncated"]:
            print(
                f"[stock_behavior_llm] stage=prefetched_evidence status=fallback "
                f"reason=truncated model={self._model}"
            )
            return {}, raw_text, meta

        try:
            parsed = _parse_structured_analysis_payload(raw_content)
        except (OutputParserException, ValueError, json.JSONDecodeError) as exc:
            print(
                f"[stock_behavior_llm] stage=prefetched_evidence status=fallback "
                f"reason=structured_parse_failed model={self._model} error={exc}"
            )
            return {}, raw_text, meta

        simplified_chars = detect_simplified_chinese(raw_text)
        if simplified_chars:
            print(
                "[stock_behavior_llm] warn=simplified_chinese "
                f"chars={''.join(simplified_chars)}"
            )

        print(
            f"[stock_behavior_llm] stage=prefetched_evidence status=success model={self._model}"
        )
        return parsed, raw_text, meta

    async def generate_text_brief_from_evidence(
        self,
        *,
        task_packet: dict[str, Any],
    ) -> tuple[dict[str, Any], str, dict[str, Any]]:
        if not self._enabled or self._client is None:
            print(
                f"[stock_behavior_llm] stage=text_brief status=fail reason=disabled "
                f"enabled={self._enabled} model={self._model}"
            )
            raise RuntimeError(
                "LLM service is disabled: missing NIM_API_KEY, NIM_BASE_URL, model, or langchain dependencies"
            )

        payload = json.dumps(task_packet, ensure_ascii=False, default=str)
        user_prompt = (
            f"<prefetched_evidence_payload>\n{payload}\n</prefetched_evidence_payload>\n\n"
            f"<output_schema>\n{TEXT_BRIEF_OUTPUT_SCHEMA}\n</output_schema>\n\n"
            "請依 system 指示產出文字簡報 JSON。"
        )
        messages = [
            ("system", TEXT_BRIEF_SYSTEM_PROMPT),
            ("human", user_prompt),
        ]

        print(f"[stock_behavior_llm] stage=text_brief status=start model={self._model}")
        response = await self._client.ainvoke(messages)
        raw_content = response.content
        raw_text = _coerce_llm_text(raw_content)
        response_metadata = getattr(response, "response_metadata", {}) or {}
        finish_reason = response_metadata.get("finish_reason")
        token_usage = response_metadata.get("token_usage") or {}
        completion_tokens = token_usage.get("completion_tokens")
        if completion_tokens is None:
            completion_tokens = (getattr(response, "usage_metadata", {}) or {}).get(
                "output_tokens"
            )
        meta = {
            "finish_reason": finish_reason,
            "completion_tokens": (
                completion_tokens if isinstance(completion_tokens, int) else None
            ),
            "truncated": finish_reason == "length",
        }

        print(
            "[stock_behavior_llm] stage=text_brief raw_response",
            {
                "model": self._model,
                "content_type": type(raw_content).__name__,
                "content_len": len(raw_text),
                "content_preview": raw_text[:3000],
            },
        )

        if meta["truncated"]:
            print(
                f"[stock_behavior_llm] stage=text_brief status=fallback "
                f"reason=truncated model={self._model}"
            )
            return {}, raw_text, meta

        parsed = _load_json_object(raw_text)
        if parsed is None:
            print(
                f"[stock_behavior_llm] stage=text_brief status=fallback "
                f"reason=structured_parse_failed model={self._model}"
            )
            return {}, raw_text, meta

        print(f"[stock_behavior_llm] stage=text_brief status=success model={self._model}")
        return parsed, raw_text, meta
