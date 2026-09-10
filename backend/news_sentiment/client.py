from __future__ import annotations

from dataclasses import dataclass
import json
import re
import time
from typing import Any, Optional

from openai import OpenAI, APIError, AuthenticationError, RateLimitError, APITimeoutError

from config import get_settings
from news_sentiment.constants import (
    DEFAULT_API_TIMEOUT_SECONDS,
    DEFAULT_MODEL,
    INPUT_PRICE_PER_M,
    MAX_COMPLETION_TOKENS,
    OUTPUT_PRICE_PER_M,
)

CODE_FENCE_RE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


@dataclass
class LLMUsage:
    input_tokens: int | None
    output_tokens: int | None
    reasoning_tokens: int | None
    estimated_cost_usd: float | None

    def to_dict(self) -> dict[str, Any]:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "reasoning_tokens": self.reasoning_tokens,
            "estimated_cost_usd": self.estimated_cost_usd,
        }


def calculate_cost(
    input_tokens: int | None,
    output_tokens: int | None,
    input_price_per_m: float = INPUT_PRICE_PER_M,
    output_price_per_m: float = OUTPUT_PRICE_PER_M,
) -> float | None:
    if input_tokens is None or output_tokens is None:
        return None
    cost = (input_tokens / 1_000_000.0 * input_price_per_m) + (
        output_tokens / 1_000_000.0 * output_price_per_m
    )
    return round(cost, 8)


class SentimentLLMClient:
    """
    專用新聞情緒分類 LLM 用戶端。
    針對 gpt-5.6-luna 與 OpenAI-compatible 閘道進行適配。
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: int = DEFAULT_API_TIMEOUT_SECONDS,
        max_completion_tokens: int = MAX_COMPLETION_TOKENS,
    ):
        settings = get_settings()
        self.api_key = api_key or settings.NIM_API_KEY
        self.base_url = base_url or settings.NIM_BASE_URL
        self.model = model or settings.ADVISOR_LLM_MODEL or DEFAULT_MODEL
        self.timeout = timeout
        self.max_completion_tokens = max_completion_tokens

        self._client: Optional[OpenAI] = None
        if self.api_key:
            self._client = OpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=float(self.timeout),
            )

    def is_available(self) -> bool:
        return self._client is not None and bool(self.api_key)

    def call_classifier(
        self,
        *,
        system_prompt: str,
        user_message: str,
        extra_user_prompt: str | None = None,
    ) -> tuple[dict[str, Any] | None, str, LLMUsage, float, str | None]:
        """
        調用模型進行情緒分類。
        回傳: (parsed_json, raw_text, usage, latency_ms, error_code)
        """
        if not self._client:
            return (
                None,
                "",
                LLMUsage(None, None, None, None),
                0.0,
                "client_uninitialized",
            )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message},
        ]
        if extra_user_prompt:
            messages.append({"role": "user", "content": extra_user_prompt})

        start_time = time.perf_counter()
        raw_text = ""
        error_code: str | None = None
        usage = LLMUsage(None, None, None, None)

        try:
            # 依規格：針對 gpt-5.6-luna 使用最低推理設定（reasoning_effort="none"），不帶非預設 temperature
            kwargs: dict[str, Any] = {
                "model": self.model,
                "messages": messages,
                "response_format": {"type": "json_object"},
                "max_completion_tokens": self.max_completion_tokens,
            }
            if "luna" in self.model.lower() or "gpt-5" in self.model.lower():
                kwargs["reasoning_effort"] = "none"

            response = self._client.chat.completions.create(**kwargs)

            latency_ms = (time.perf_counter() - start_time) * 1000.0
            message = response.choices[0].message
            raw_text = message.content or ""

            # 擷取 Token 用量
            if response.usage:
                in_tokens = response.usage.prompt_tokens
                out_tokens = response.usage.completion_tokens
                res_tokens = None
                if hasattr(response.usage, "completion_tokens_details") and response.usage.completion_tokens_details:
                    res_tokens = getattr(response.usage.completion_tokens_details, "reasoning_tokens", None)
                cost = calculate_cost(in_tokens, out_tokens)
                usage = LLMUsage(
                    input_tokens=in_tokens,
                    output_tokens=out_tokens,
                    reasoning_tokens=res_tokens,
                    estimated_cost_usd=cost,
                )

            # 解析 JSON
            cleaned_text = CODE_FENCE_RE.sub("", raw_text.strip()).strip()
            parsed = json.loads(cleaned_text)
            return parsed, raw_text, usage, latency_ms, None

        except AuthenticationError:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return None, raw_text, usage, latency_ms, "auth_error_401"
        except RateLimitError:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return None, raw_text, usage, latency_ms, "rate_limit_429"
        except APITimeoutError:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return None, raw_text, usage, latency_ms, "timeout"
        except APIError as e:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            code = f"api_error_{e.code or e.status_code or 'unknown'}"
            return None, raw_text, usage, latency_ms, code
        except json.JSONDecodeError:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return None, raw_text, usage, latency_ms, "invalid_json_output"
        except Exception as e:
            latency_ms = (time.perf_counter() - start_time) * 1000.0
            return None, raw_text, usage, latency_ms, f"unknown_error_{type(e).__name__}"


class MockSentimentLLMClient(SentimentLLMClient):
    """用於測試的 Mock LLM 客戶端，不耗費真實 API 額度"""

    def __init__(
        self,
        mock_response: dict[str, Any] | None = None,
        mock_error_code: str | None = None,
        mock_usage: LLMUsage | None = None,
    ):
        super().__init__(api_key="mock-key", model="gpt-5.6-luna")
        self.mock_response = mock_response
        self.mock_error_code = mock_error_code
        self.mock_usage = mock_usage or LLMUsage(
            input_tokens=500,
            output_tokens=80,
            reasoning_tokens=0,
            estimated_cost_usd=0.000196,
        )
        self.call_count = 0

    def call_classifier(
        self,
        *,
        system_prompt: str,
        user_message: str,
        extra_user_prompt: str | None = None,
    ) -> tuple[dict[str, Any] | None, str, LLMUsage, float, str | None]:
        self.call_count += 1
        if self.mock_error_code:
            return None, "", self.mock_usage, 50.0, self.mock_error_code

        response_data = self.mock_response
        if response_data is None:
            # 預設回傳 neutral，依據 user_message 嘗試尋找引用
            first_line = user_message.splitlines()[0] if user_message else "中性公告"
            response_data = {
                "label": "neutral",
                "reason": "新聞為一般客觀事實公告，無明確正負面情緒。",
                "evidence": [{"field": "title", "quote": "公告"}],
            }

        raw_text = json.dumps(response_data, ensure_ascii=False)
        return response_data, raw_text, self.mock_usage, 50.0, None
