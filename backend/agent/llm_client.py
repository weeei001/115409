from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from openai import APIError, APIConnectionError, APITimeoutError, AsyncOpenAI, RateLimitError

logger = logging.getLogger(__name__)

_RETRYABLE = (APIConnectionError, APITimeoutError, RateLimitError)
_MAX_RETRIES = 3


def _effective_retries(retries: int | None) -> int:
    if retries is None:
        return _MAX_RETRIES
    return max(1, int(retries))


def _normalize_llm_json_text(content: str | None) -> str:
    """Normalize model JSON text that may be wrapped by markdown fences or empty."""
    if not content:
        return "{}"
    s = content.strip()
    if not s:
        return "{}"
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            body_lines = lines[1:]
            while body_lines and body_lines[-1].strip() == "```":
                body_lines.pop()
            if body_lines and body_lines[-1].rstrip().endswith("```"):
                body_lines[-1] = body_lines[-1].rstrip()[:-3].rstrip()
            s = "\n".join(body_lines).strip()
    return s or "{}"


def _parse_json_with_recovery(raw_text: str) -> Any:
    """Parse JSON payload and tolerate trailing non-JSON commentary from models."""
    text = (raw_text or "").lstrip("\ufeff").strip()
    if not text:
        return {}

    try:
        return json.loads(text)
    except json.JSONDecodeError as first_exc:
        decoder = json.JSONDecoder()
        starts = [idx for idx, ch in enumerate(text) if ch in "{["]
        for idx in starts:
            candidate = text[idx:]
            try:
                obj, _end = decoder.raw_decode(candidate)
                return obj
            except json.JSONDecodeError:
                continue
        raise first_exc


def _log_nim_model_error(model: str, exc: BaseException) -> None:
    """Log common NIM model mismatch issues (e.g., using VL model in text endpoint)."""
    body = getattr(exc, "body", None) or getattr(exc, "response", None)
    body_str = str(body).lower() if body is not None else ""
    msg = str(exc).lower()
    hint = ""
    if "nvlm" in msg or "vocab_size" in msg or "nvlm" in body_str or "vocab_size" in body_str:
        hint = (
            " Possible reason: the selected model is multimodal (VL) and incompatible with this text/chat endpoint."
            " Use a text instruct model in ADVISOR_LLM_MODEL."
        )
    code = getattr(exc, "status_code", None)
    logger.error("NIM/LLM request failed model=%s status=%s error=%s body=%s.%s", model, code, exc, body, hint)


class LLMClient:
    """Thin async wrapper around NVIDIA NIM (OpenAI-compatible endpoint)."""

    def __init__(self, settings: Any, model: str | None = None) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.NIM_API_KEY,
            base_url=settings.NIM_BASE_URL,
        )
        # Priority: explicit model > ADVISOR_LLM_MODEL.
        self.model = model or settings.ADVISOR_LLM_MODEL

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
        retries: int | None = None,
    ) -> str:
        max_retries = _effective_retries(retries)
        last_err: Optional[Exception] = None
        for attempt in range(1, max_retries + 1):
            try:
                resp = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return resp.choices[0].message.content or ""
            except _RETRYABLE as exc:
                last_err = exc
                logger.warning("LLM attempt %d/%d failed: %s", attempt, max_retries, exc)
                import asyncio

                await asyncio.sleep(2 ** attempt)
            except APIError as exc:
                _log_nim_model_error(self.model, exc)
                raise
        raise RuntimeError(f"LLM failed after {max_retries} retries") from last_err

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        retries: int | None = None,
    ) -> dict:
        """Request JSON; retries parsing and falls back away from json_object mode after first attempt."""
        max_retries = _effective_retries(retries)
        last_err: Optional[Exception] = None
        last_decode_err: Optional[json.JSONDecodeError] = None

        for attempt in range(1, max_retries + 1):
            use_json_object = attempt == 1
            try:
                req: Dict[str, Any] = {
                    "model": self.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                }
                if use_json_object:
                    req["response_format"] = {"type": "json_object"}

                resp = await self.client.chat.completions.create(**req)
                msg = resp.choices[0].message
                raw_text = _normalize_llm_json_text(getattr(msg, "content", None))
                parsed = _parse_json_with_recovery(raw_text)
                if not isinstance(parsed, dict):
                    raise json.JSONDecodeError("Root JSON value must be object", raw_text, 0)
                return parsed
            except _RETRYABLE as exc:
                last_err = exc
                logger.warning("LLM JSON attempt %d/%d failed: %s", attempt, max_retries, exc)
                import asyncio

                await asyncio.sleep(2 ** attempt)
            except json.JSONDecodeError as exc:
                last_decode_err = exc
                logger.warning(
                    "LLM JSON parse failed attempt %d/%d model=%s err=%s preview=%r use_json_object=%s",
                    attempt,
                    max_retries,
                    self.model,
                    exc,
                    raw_text[:400],
                    use_json_object,
                )
                if attempt >= max_retries:
                    logger.error("LLM returned invalid JSON after %d attempts: %s", max_retries, exc)
                    raise
                import asyncio

                await asyncio.sleep(2 ** attempt)
            except APIError as exc:
                _log_nim_model_error(self.model, exc)
                raise

        raise RuntimeError(f"LLM JSON failed after {max_retries} retries") from (last_err or last_decode_err)
