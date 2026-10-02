"""LangChain model messages, structured output and provider compatibility only."""
from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from typing import Any
from contextlib import aclosing

import httpx
from openai import APIError, APITimeoutError, LengthFinishReasonError
from pydantic import BaseModel, ValidationError

try:
    from langchain_openai import ChatOpenAI
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
except ImportError:
    ChatOpenAI = None

from app.core.errors import ModelUnavailable, ServiceUnavailable, UpstreamTimeout

THINKING_BLOCK_RE = re.compile(r"<think\b[^>]*>.*?</think>\s*", re.IGNORECASE | re.DOTALL)
CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)
JSON_NUMBER_RE = r"-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?"
JSON_NUMERIC_EXPR_RE = re.compile(
    rf"(?P<prefix>:\s*)(?P<left>{JSON_NUMBER_RE})\s*(?P<op>[*/])\s*(?P<right>{JSON_NUMBER_RE})(?P<suffix>\s*[,}}\]])"
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

def _thinking_extra_body(model: str, enable_thinking: bool | None = None) -> dict[str, Any]:
    model = model.lower()
    if model.startswith(("gemini-", "models/gemini-")):
        return {}
    if enable_thinking is False:
        return {"chat_template_kwargs": {"enable_thinking": False}}
    if enable_thinking is True:
        return {"chat_template_kwargs": {"enable_thinking": True}}
    if model.startswith(("deepseek-ai/", "moonshotai/")):
        return {"chat_template_kwargs": {"thinking": False}}
    if model.startswith(("qwen/", "z-ai/", "nvidia/nemotron-3-", "google/gemma")):
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



@dataclass
class LlmResult:
    payload: dict[str, Any]
    raw_text: str
    metadata: dict[str, Any]


@dataclass
class LlmTextChunk:
    text: str
    metadata: dict[str, Any]


class _ReasoningFilter:
    """Strip thinking blocks even when tags are split between provider chunks."""
    def __init__(self):
        self.pending = ""
        self.hidden = False

    def feed(self, text: str) -> str:
        self.pending += text
        visible = []
        while self.pending:
            token = "</think>" if self.hidden else "<think>"
            index = self.pending.lower().find(token)
            if index >= 0:
                if not self.hidden:
                    visible.append(self.pending[:index])
                self.pending = self.pending[index + len(token):]
                self.hidden = not self.hidden
                continue
            keep = next((size for size in range(len(token) - 1, 0, -1)
                         if self.pending.lower().endswith(token[:size])), 0)
            if not self.hidden:
                visible.append(self.pending[:-keep] if keep else self.pending)
            self.pending = self.pending[-keep:] if keep else ""
            break
        return "".join(visible)

    def finish(self) -> str:
        text = self.pending if not self.hidden else ""
        self.pending = ""
        return text


def _text_metadata(message) -> dict[str, Any]:
    response = getattr(message, "response_metadata", {}) or {}
    usage = response.get("token_usage") or {}
    generic_usage = getattr(message, "usage_metadata", {}) or {}
    values = {"finish_reason": response.get("finish_reason"), "model_name": response.get("model_name"),
              "prompt_tokens": usage.get("prompt_tokens", generic_usage.get("input_tokens")),
              "completion_tokens": usage.get("completion_tokens", generic_usage.get("output_tokens")),
              "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens",
                  (generic_usage.get("output_token_details") or {}).get("reasoning"))}
    return {key: value for key, value in values.items() if value is not None}


class LlmClient:
    def __init__(self, settings: Any, http: httpx.AsyncClient | None = None):
        self.settings = settings
        self.http = http
        self.model_name = settings.LLM_MODEL

    @property
    def enabled(self) -> bool:
        return bool(self.settings.LLM_API_KEY and self.settings.LLM_BASE_URL
                    and self.model_name and ChatOpenAI is not None)

    def require_enabled(self) -> None:
        if not self.enabled:
            raise ServiceUnavailable({"code": "llm_unavailable", "message": "AI 服務尚未設定，請稍後重試", "context": {}})

    def _model(self, streaming: bool | None = None):
        self.require_enabled()
        settings = self.settings
        use_stream = settings.LLM_STREAMING if streaming is None else streaming
        return ChatOpenAI(
            api_key=settings.LLM_API_KEY, base_url=settings.LLM_BASE_URL,
            model=self.model_name, temperature=settings.LLM_TEMPERATURE,
            timeout=settings.LLM_TIMEOUT_SECONDS,
            max_retries=settings.LLM_MAX_RETRIES,
            max_completion_tokens=settings.LLM_MAX_TOKENS,
            streaming=use_stream,
            stream_chunk_timeout=settings.LLM_STREAM_CHUNK_TIMEOUT_SECONDS or None,
            stream_usage=use_stream,
            extra_body=_thinking_extra_body(self.model_name, settings.LLM_ENABLE_THINKING),
            http_socket_options=() if self.http is not None else None,
            http_async_client=self.http,
        )

    async def generate(self, *, system_prompt: str, payload: dict[str, Any],
                       schema: type[BaseModel], examples: list[tuple[str, str]] = ()) -> LlmResult:
        settings = self.settings
        method = "json_schema" if settings.LLM_RESPONSE_FORMAT == "json_schema" else "json_mode"
        model = self._model()
        structured = (model.with_structured_output(schema, method=method, include_raw=True)
                      if settings.LLM_RESPONSE_FORMAT != "off" else None)
        messages = [SystemMessage(content=system_prompt + "\nReturn a JSON object matching this schema:\n" + json.dumps(schema.model_json_schema(), ensure_ascii=False))]
        for example_input, example_output in examples:
            messages.extend([HumanMessage(content=example_input), AIMessage(content=example_output)])
        messages.append(HumanMessage(content=json.dumps(payload, ensure_ascii=False, default=str)))
        try:
            async with asyncio.timeout(settings.LLM_TIMEOUT_SECONDS):
                result = (await structured.ainvoke(messages) if structured is not None
                          else {"raw": await model.ainvoke(messages), "parsed": None})
        except LengthFinishReasonError as exc:
            completion = exc.completion
            usage = completion.usage
            meta = {
                "finish_reason": "length", "truncated": True,
                "completion_tokens": usage.completion_tokens if usage else None,
                "prompt_tokens": usage.prompt_tokens if usage else None,
                "model_name": completion.model,
            }
            reasoning = getattr(getattr(usage, "completion_tokens_details", None), "reasoning_tokens", None)
            if reasoning is not None:
                meta["reasoning_tokens"] = reasoning
            return LlmResult({}, completion.choices[0].message.content or "", meta)
        except (TimeoutError, httpx.TimeoutException, APITimeoutError) as exc:
            raise UpstreamTimeout("分析逾時，請稍後重試") from exc
        except (APIError, httpx.HTTPError, ValueError, IndexError, TypeError) as exc:
            code = getattr(exc, "code", None)
            raise ModelUnavailable(
                {"code": "upstream_model_error", "message": "模型服務暫時無法回應，請稍後重試", "context": {}},
                upstream_status_code=getattr(exc, "status_code", None),
                upstream_code=code if code in {"model_not_found", "rate_limit_exceeded", "invalid_api_key"} else None,
            ) from exc
        raw = result.get("raw")
        raw_text = _coerce_llm_text(getattr(raw, "content", None))
        response_metadata = getattr(raw, "response_metadata", {}) or {}
        usage = response_metadata.get("token_usage") or {}
        usage_meta = getattr(raw, "usage_metadata", {}) or {}
        meta = {"finish_reason": response_metadata.get("finish_reason"),
                "completion_tokens": usage.get("completion_tokens", usage_meta.get("output_tokens")),
                "prompt_tokens": usage.get("prompt_tokens", usage_meta.get("input_tokens")),
                "model_name": response_metadata.get("model_name", self.model_name),
                "truncated": response_metadata.get("finish_reason") == "length"}
        if (reasoning := _text_metadata(raw).get("reasoning_tokens")) is not None:
            meta["reasoning_tokens"] = reasoning
        if meta["truncated"]:
            return LlmResult({}, raw_text, meta)
        # LangChain's partial JSON parser can repair a missing closing brace.
        # Require a complete root before accepting even a successfully parsed model.
        complete = _load_json_object(raw_text)
        if complete is None:
            return LlmResult({}, raw_text, meta)
        parsed = result.get("parsed")
        if isinstance(parsed, BaseModel):
            return LlmResult(parsed.model_dump(mode="json"), raw_text, meta)
        # Legacy provider repairs are centralized here and protected by regression checks.
        return LlmResult(complete, raw_text, meta)

    async def text(self, *, system_prompt: str, prompt: str) -> LlmResult:
        model = self._model(streaming=False)
        try:
            async with asyncio.timeout(self.settings.LLM_TIMEOUT_SECONDS):
                result = await model.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=prompt)])
        except (TimeoutError, httpx.TimeoutException, APITimeoutError) as exc:
            raise UpstreamTimeout("LLM service timed out") from exc
        except (APIError, httpx.HTTPError, ValueError, IndexError, TypeError) as exc:
            raise ServiceUnavailable("LLM service unavailable") from exc
        cleaner = _ReasoningFilter()
        visible = cleaner.feed(_coerce_llm_text(result.content)) + cleaner.finish()
        metadata = _text_metadata(result)
        metadata["truncated"] = metadata.get("finish_reason") == "length"
        return LlmResult({}, visible.strip(), metadata)

    async def stream_text(self, *, system_prompt: str, prompt: str):
        self.require_enabled()
        if not self.settings.LLM_STREAMING:
            result = await self.text(system_prompt=system_prompt, prompt=prompt)
            yield LlmTextChunk(result.raw_text, result.metadata)
            return
        model = self._model(streaming=True)
        cleaner = _ReasoningFilter()
        metadata = {}
        try:
            async with asyncio.timeout(self.settings.LLM_TIMEOUT_SECONDS):
                async with aclosing(model.astream([SystemMessage(content=system_prompt), HumanMessage(content=prompt)])) as stream:
                    while True:
                        try:
                            chunk_timeout = self.settings.LLM_STREAM_CHUNK_TIMEOUT_SECONDS or None
                            async with asyncio.timeout(chunk_timeout):
                                chunk = await anext(stream)
                        except StopAsyncIteration:
                            break
                        metadata.update(_text_metadata(chunk))
                        visible = cleaner.feed(_coerce_llm_text(chunk.content))
                        if visible:
                            yield LlmTextChunk(visible, {})
                metadata["truncated"] = metadata.get("finish_reason") == "length"
                yield LlmTextChunk(cleaner.finish(), metadata)
        except (TimeoutError, httpx.TimeoutException, APITimeoutError) as exc:
            raise UpstreamTimeout("LLM service timed out") from exc
        except (APIError, httpx.HTTPError, ValueError, IndexError, TypeError) as exc:
            raise ServiceUnavailable("LLM service unavailable") from exc
