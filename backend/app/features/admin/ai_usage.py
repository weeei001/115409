"""Administrator summary of what AI features cost.

Text-brief tokens, latency and retries come from the saved briefs; per-feature call usage
(AI chat, briefs, news impact) comes from ai_usage_logs, which never stores prompts or answers.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import case, func, inspect, or_, select
from sqlalchemy.orm import Session

from app.clients.llm import token_cost
from app.db.models.ai_usage import AiUsageLog
from app.db.models.llm_response import LLM_RESPONSE_KIND_TEXT_BRIEF, LlmResponse

_METADATA = {
    "prompt_total": "$.model_metadata.usage_total.prompt_tokens",
    "completion_total": "$.model_metadata.usage_total.completion_tokens",
    # Only the last call's usage: all that older snapshots kept, or a total left out because a call went unreported.
    "prompt_last": "$.model_metadata.prompt_tokens",
    "completion_last": "$.model_metadata.completion_tokens",
    "attempts": "$.model_metadata.validation_attempts",
}

# ai_usage_logs feature codes in display order; any other code follows alphabetically.
_FEATURE_ORDER = ("chat", "analysis", "news_impact")


class AIFeatureUsage(BaseModel):
    feature: str = Field(description="ai_usage_logs 的功能代號：chat（AI 對話與小燈）、analysis（AI 摘要）、news_impact（新聞事件判讀）。")
    requests: int = Field(description="期間內的請求數；同一次提問或同一份分析裡的多次模型呼叫算一次。")
    calls: int = Field(description="模型呼叫次數。")
    failed_calls: int = Field(description="沒有完成的呼叫（失敗或中斷）；這些也可能已經計費。")
    measured_requests: int = Field(description="每次呼叫都有回報輸入與輸出 token 的請求數；平均與成本只用這些計算。")
    avg_prompt_tokens: float | None = Field(default=None, description="每次請求平均輸入 token。")
    avg_completion_tokens: float | None = Field(default=None, description="每次請求平均輸出 token。")
    avg_cost_usd: float | None = Field(default=None, description="每次請求估算成本（美元）。")
    total_cost_usd: float | None = Field(default=None, description="measured_requests 的估算成本合計（美元）。")


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
    features: list[AIFeatureUsage] = Field(
        default_factory=list,
        description="依功能彙整 ai_usage_logs 的模型呼叫用量；後台 AI 回測與 AI 摘要的過往檢討不寫這張表，沒有列入。",
    )


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


def _feature_usage(db: Session, cutoff: datetime, settings: Any) -> list[AIFeatureUsage]:
    # The brief summary keeps working during a rollout before init-schema has created the table.
    if not inspect(db.connection()).has_table(AiUsageLog.__tablename__):
        return []
    unmeasured = or_(AiUsageLog.input_tokens.is_(None), AiUsageLog.output_tokens.is_(None))
    # One row per request: a chat question groups its intent and answer calls under one request_id.
    rows = db.execute(select(
        AiUsageLog.feature, func.count().label("calls"),
        func.sum(case((AiUsageLog.status != "completed", 1), else_=0)).label("failed"),
        func.sum(case((unmeasured, 1), else_=0)).label("unmeasured"),
        func.sum(AiUsageLog.input_tokens).label("prompt"), func.sum(AiUsageLog.output_tokens).label("completion"),
    ).where(AiUsageLog.created_at >= cutoff).group_by(AiUsageLog.feature, AiUsageLog.request_id)).mappings().all()
    requests_by_feature: dict[str, list] = {}
    for row in rows:
        requests_by_feature.setdefault(row["feature"], []).append(row)
    order = {feature: index for index, feature in enumerate(_FEATURE_ORDER)}
    features = []
    for feature in sorted(requests_by_feature, key=lambda name: (order.get(name, len(order)), name)):
        requests = requests_by_feature[feature]
        # A request counts only when every call reported usage; a partial sum would understate it.
        tokens = [(float(row["prompt"]), float(row["completion"])) for row in requests if not row["unmeasured"]]
        costs = [float(token_cost(prompt, completion, settings)) for prompt, completion in tokens]
        features.append(AIFeatureUsage(
            feature=feature, requests=len(requests), calls=sum(int(row["calls"]) for row in requests),
            failed_calls=sum(int(row["failed"] or 0) for row in requests), measured_requests=len(tokens),
            avg_prompt_tokens=_mean([prompt for prompt, _ in tokens], 1),
            avg_completion_tokens=_mean([completion for _, completion in tokens], 1),
            avg_cost_usd=_mean(costs, 6), total_cost_usd=round(sum(costs), 4) if costs else None,
        ))
    return features


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
        features=_feature_usage(db, cutoff, settings),
    )
