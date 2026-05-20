from __future__ import annotations

import json
from typing import Any

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

from stock_behavior.llm_schema import RawProjection, RawProjectionResponse, RawStructuredAnalysisPayload
from stock_behavior.prompt_templates import (
    STOCK_ANALYST_SYSTEM_PROMPT,
    build_stock_behavior_prefetched_evidence_user_prompt,
)


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
