from __future__ import annotations

import json
import logging
from typing import Any, Optional

from openai import AsyncOpenAI, APIConnectionError, APITimeoutError, RateLimitError

logger = logging.getLogger(__name__)

_RETRYABLE = (APIConnectionError, APITimeoutError, RateLimitError)
_MAX_RETRIES = 3


class LLMClient:
    """Thin async wrapper around NVIDIA NIM (OpenAI-compatible endpoint)."""

    def __init__(self, settings: Any) -> None:
        self.client = AsyncOpenAI(
            api_key=settings.NIM_API_KEY,
            base_url=settings.NIM_BASE_URL,
        )
        self.model = settings.NIM_MODEL

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
        raise RuntimeError(f"LLM failed after {_MAX_RETRIES} retries") from last_err

    async def complete_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.1,
        max_tokens: int = 4096,
    ) -> dict:
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
                    response_format={"type": "json_object"},
                )
                raw = resp.choices[0].message.content or "{}"
                return json.loads(raw)
            except _RETRYABLE as exc:
                last_err = exc
                logger.warning("LLM JSON attempt %d/%d failed: %s", attempt, _MAX_RETRIES, exc)
                import asyncio
                await asyncio.sleep(2 ** attempt)
            except json.JSONDecodeError as exc:
                logger.error("LLM returned invalid JSON: %s", exc)
                raise
        raise RuntimeError(f"LLM JSON failed after {_MAX_RETRIES} retries") from last_err
