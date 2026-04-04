from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from openai import APIError, AsyncOpenAI, APIConnectionError, APITimeoutError, RateLimitError

logger = logging.getLogger(__name__)

_RETRYABLE = (APIConnectionError, APITimeoutError, RateLimitError)
_MAX_RETRIES = 3


def _normalize_llm_json_text(content: str | None) -> str:
    """NIM／部分模型在 json_object 模式下仍可能回傳空白、或包在 markdown 程式碼塊內。"""
    if not content:
        return "{}"
    s = content.strip()
    if not s:
        return "{}"
    # ```json ... ``` 或 ``` ... ```
    if s.startswith("```"):
        lines = s.split("\n")
        if len(lines) >= 2:
            body_lines = lines[1:]
            while body_lines and body_lines[-1].strip() == "```":
                body_lines.pop()
            if body_lines and body_lines[-1].rstrip().endswith("```"):
                body_lines[-1] = body_lines[-1].rstrip()[:-3].rstrip()
            s = "\n".join(body_lines).strip()
    if not s:
        return "{}"
    return s


def _log_nim_model_error(model: str, exc: BaseException) -> None:
    """NIM 常見 500：VL 多模態模型與純文字 chat / json_object 不相容（如 NVLM_D2_Config / vocab_size）。"""
    body = getattr(exc, "body", None) or getattr(exc, "response", None)
    body_str = str(body).lower() if body is not None else ""
    msg = str(exc).lower()
    hint = ""
    if "nvlm" in msg or "vocab_size" in msg or "nvlm" in body_str or "vocab_size" in body_str:
        hint = (
            " 可能原因：目前使用的模型為多模態(VL)，與此 API 的純文字推論不相容。"
            " 請在 .env 將 NIM_MODEL_PRIMARY / NIM_MODEL_SECONDARY 改為純文字 instruct 模型"
            "（例如 meta/llama-3.1-8b-instruct 或 meta/llama-3.3-70b-instruct），勿使用 *-vl-* 型號。"
        )
    code = getattr(exc, "status_code", None)
    logger.error("NIM/LLM 請求失敗 model=%s status=%s error=%s body=%s.%s", model, code, exc, body, hint)


class LLMClient:
    """Thin async wrapper around NVIDIA NIM (OpenAI-compatible endpoint)."""

    def __init__(self, settings: Any, model: str | None = None) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.NIM_API_KEY,
            base_url=settings.NIM_BASE_URL,
        )
        # Backward compatibility: prefer explicit model, then legacy NIM_MODEL, then primary.
        self.model = model or settings.NIM_MODEL or settings.NIM_MODEL_PRIMARY

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.3,
        max_tokens: int = 4096,
    ) -> str:
        last_err: Optional[Exception] = None
        for attempt in range(1, _MAX_RETRIES + 1):
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
                logger.warning("LLM attempt %d/%d failed: %s", attempt, _MAX_RETRIES, exc)
                import asyncio
                await asyncio.sleep(2 ** attempt)
            except APIError as exc:
                _log_nim_model_error(self.model, exc)
                raise
        raise RuntimeError(f"LLM failed after {_MAX_RETRIES} retries") from last_err

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> dict:
        """請求 JSON；若解析失敗會重試。第 2 次起改為不帶 response_format（部分 NIM 模型在 json_object 下會回空字串）。"""
        last_err: Optional[Exception] = None
        last_decode_err: Optional[json.JSONDecodeError] = None
        for attempt in range(1, _MAX_RETRIES + 1):
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
                return json.loads(raw_text)
            except _RETRYABLE as exc:
                last_err = exc
                logger.warning("LLM JSON attempt %d/%d failed: %s", attempt, _MAX_RETRIES, exc)
                import asyncio
                await asyncio.sleep(2 ** attempt)
            except json.JSONDecodeError as exc:
                last_decode_err = exc
                logger.warning(
                    "LLM JSON parse failed attempt %d/%d model=%s err=%s preview=%r use_json_object=%s",
                    attempt,
                    _MAX_RETRIES,
                    self.model,
                    exc,
                    raw_text[:400],
                    use_json_object,
                )
                if attempt >= _MAX_RETRIES:
                    logger.error("LLM returned invalid JSON after %d attempts: %s", _MAX_RETRIES, exc)
                    raise
                import asyncio
                await asyncio.sleep(2 ** attempt)
            except APIError as exc:
                _log_nim_model_error(self.model, exc)
                raise
        raise RuntimeError(f"LLM JSON failed after {_MAX_RETRIES} retries") from (last_err or last_decode_err)
