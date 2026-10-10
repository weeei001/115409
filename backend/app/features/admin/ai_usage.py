"""Administrator summary of what text-brief generation costs: tokens, latency and an estimated price."""

from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clients.llm import token_cost
from app.db.models.llm_response import LLM_RESPONSE_KIND_TEXT_BRIEF, LlmResponse

_METADATA = {
    "prompt_total": "$.model_metadata.usage_total.prompt_tokens",
    "completion_total": "$.model_metadata.usage_total.completion_tokens",
    # Only the last call's usage: all that older snapshots kept, or a total left out because a call went unreported.
    "prompt_last": "$.model_metadata.prompt_tokens",
    "completion_last": "$.model_metadata.completion_tokens",
    "attempts": "$.model_metadata.validation_attempts",
}


class AIUsageSummary(BaseModel):
    days: int
    briefs: int = Field(description="期間內產生的 AI 摘要份數，含沒有通過檢查、未產出內容的。")
    unavailable: int = Field(description="其中沒有通過檢查、未產出內容的份數；這些也已經呼叫過模型。")
    measured: int = Field(description="有記錄 token 數的份數；平均與成本只用這些計算。")
    avg_prompt_tokens: float | None = Field(default=None, description="每份平均輸入 token。")
    avg_completion_tokens: float | None = Field(default=None, description="每份平均輸出 token。")
    avg_latency_seconds: float | None = Field(default=None, description="每份平均產生時間（秒），含重試。")
    retry_rate: float | None = Field(default=None, description="需要第二次呼叫的份數比例，0–1。")
    input_price_per_m: float = Field(description="估算用的輸入單價（美元／百萬 token），來自 LLM_INPUT_PRICE_PER_M。")
    output_price_per_m: float = Field(description="估算用的輸出單價（美元／百萬 token），來自 LLM_OUTPUT_PRICE_PER_M。")
    avg_cost_usd: float | None = Field(default=None, description="每份估算成本（美元）。")
    total_cost_usd: float | None = Field(default=None, description="measured 份數的估算成本合計（美元）。")


def _number(value) -> float | None:
    # MySQL JSON_EXTRACT returns JSON text; SQLite returns the bare value.
    if value is None:
        return None
    try:
        return float(str(value).strip('"'))
    except ValueError:
        return None


def _mean(values: list[float], digits: int) -> float | None:
    return round(sum(values) / len(values), digits) if values else None


def summary(db: Session, days: int, settings: Any) -> AIUsageSummary:
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    rows = db.execute(select(
        LlmResponse.is_fallback, LlmResponse.latency_ms,
        *(func.json_extract(LlmResponse.normalized_json, path).label(key) for key, path in _METADATA.items()),
    ).where(LlmResponse.kind == LLM_RESPONSE_KIND_TEXT_BRIEF, LlmResponse.created_at >= cutoff)).mappings().all()
    tokens, latencies, attempts = [], [], []
    for row in rows:
        attempt = _number(row["attempts"])
        prompt, completion = _number(row["prompt_total"]), _number(row["completion_total"])
        if prompt is None and completion is None and (attempt is None or attempt < 2):
            # Without a total, the last call's usage is the whole cost only when it was the only call.
            prompt, completion = _number(row["prompt_last"]), _number(row["completion_last"])
        if prompt is not None and completion is not None:
            tokens.append((prompt, completion))
        if row["latency_ms"] is not None:
            latencies.append(row["latency_ms"] / 1000)
        if attempt is not None:
            attempts.append(attempt)
    costs = [float(token_cost(prompt, completion, settings)) for prompt, completion in tokens]
    return AIUsageSummary(
        days=days, briefs=len(rows), unavailable=sum(bool(row["is_fallback"]) for row in rows), measured=len(tokens),
        avg_prompt_tokens=_mean([prompt for prompt, _ in tokens], 1),
        avg_completion_tokens=_mean([completion for _, completion in tokens], 1),
        avg_latency_seconds=_mean(latencies, 1),
        retry_rate=_mean([float(attempt >= 2) for attempt in attempts], 4),
        input_price_per_m=settings.LLM_INPUT_PRICE_PER_M, output_price_per_m=settings.LLM_OUTPUT_PRICE_PER_M,
        avg_cost_usd=_mean(costs, 6), total_cost_usd=round(sum(costs), 4) if costs else None,
    )
