"""Bob's weighted trend prediction core, adapted to the v2 backend clients."""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from app.clients.llm import LlmClient
from app.core.errors import AppError


class PredictionOutput(BaseModel):
    direction: Literal["up", "down"]
    change_pct_total: float = Field(gt=-100, le=100, allow_inf_nan=False)
    confidence: int = Field(ge=1, le=5)
    summary: str = Field(min_length=1, max_length=2000)


class WeeklyPredictionOutput(BaseModel):
    pct: float = Field(gt=-100, le=100, allow_inf_nan=False)
    reason: str = Field(default="", max_length=2000)


class TrendPredictionResponse(BaseModel):
    stock_id: str
    stock_name: str
    history_dates: list[str]
    regression_history: list[float]
    regression_upper: list[float]
    regression_lower: list[float]
    future_dates: list[str]
    regression_future: list[float]
    ai_future: list[float]
    ai_direction: Literal["up", "down"]
    ai_change_pct: float = Field(gt=-100, le=100, allow_inf_nan=False)
    ai_confidence: int = Field(ge=1, le=5)
    ai_summary: str
    last_price: float = Field(gt=0, allow_inf_nan=False)
    target_price: float = Field(gt=0, allow_inf_nan=False)
    daily_sigma_pct: float = Field(ge=0, allow_inf_nan=False)


class AnalysisDigestResponse(BaseModel):
    stock_id: str
    as_of_date: str
    period: Literal["week", "month"]
    digest: dict
    technical: dict
    analyst_count: int = Field(ge=0)
    news_count: int = Field(ge=0)
    generated_by: Literal["prebuilt", "on_demand"]


@dataclass
class StrategyConfig:
    name: str
    news_window_days: int = 30
    news_limit: int = 20
    horizon_days: int = 20
    regression_lambda: float = 0.1
    momentum_lambda: float = 0.2
    mean_reversion_decay: float = 0.18
    trading_days_per_week: int = 5
    model_name: str = ""


def compute_weighted_regression(closes: list[float], lam: float = 0.1):
    """Weighted linear regression with exponentially higher recent weights."""
    if not closes:
        return [], 0.0, 0.0
    if len(closes) == 1:
        return [round(closes[0], 2)], 0.0, float(closes[0])
    weights = [math.exp(lam * i) for i in range(len(closes))]
    weight_sum = sum(weights)
    x_values = list(range(len(closes)))
    x_mean = sum(weight * x for weight, x in zip(weights, x_values)) / weight_sum
    y_mean = sum(weight * y for weight, y in zip(weights, closes)) / weight_sum
    numerator = sum(weight * (x - x_mean) * (y - y_mean)
                    for weight, x, y in zip(weights, x_values, closes))
    denominator = sum(weight * (x - x_mean) ** 2 for weight, x in zip(weights, x_values))
    slope = numerator / denominator if denominator else 0.0
    intercept = y_mean - slope * x_mean
    history = [round(slope * i + intercept, 2) for i in x_values]
    return history, slope, intercept


def compute_momentum_meanreversion_curve(
    closes: list[float], horizon_days: int = 20, *, momentum_lambda: float = 0.2,
    mean_reversion_decay: float = 0.18,
):
    """Bob's short-term momentum plus mean-reversion price path."""
    if not closes or horizon_days <= 0:
        return []
    last_price = closes[-1]
    n5 = min(5, len(closes))
    short_closes = closes[-n5:]
    x_values = list(range(n5))
    weights = [math.exp(momentum_lambda * i) for i in x_values]
    weight_sum = sum(weights)
    x_mean = sum(weight * x for weight, x in zip(weights, x_values)) / weight_sum
    y_mean = sum(weight * y for weight, y in zip(weights, short_closes)) / weight_sum
    denominator = sum(weight * (x - x_mean) ** 2 for weight, x in zip(weights, x_values))
    _, slope, _ = compute_weighted_regression(closes)
    short_slope = (sum(weight * (x - x_mean) * (y - y_mean)
                       for weight, x, y in zip(weights, x_values, short_closes)) / denominator
                   if denominator else slope)
    moving_average = sum(closes[-20:]) / min(20, len(closes))
    mean_pull_per_day = (moving_average - last_price) / 20

    curve = []
    price = last_price
    for i in range(horizon_days):
        decay = math.exp(-mean_reversion_decay * i)
        price = round(price + decay * short_slope + (1 - decay) * mean_pull_per_day, 2)
        curve.append(price)
    return curve


def build_prediction_prompt(stock_id: str, stock_name: str, price_trend_desc: str,
                            news_titles: list[str], strategy: StrategyConfig) -> str:
    news_desc = "\n".join(f"- {title}" for title in news_titles) if news_titles else "（無近期新聞）"
    return f"""你是台股分析師，請根據以下資訊預測 {stock_name}（{stock_id}）未來 {strategy.horizon_days} 個交易日的股價走勢。

## 近期價格趨勢
{price_trend_desc}

## 近期相關新聞（最多 {strategy.news_limit} 則）
{news_desc}

請以 JSON 格式回答，不要輸出其他文字：
{{
  "direction": "up 或 down",
  "change_pct_total": 預估期間總漲跌幅（數字，例如 2.5 表示漲 2.5%，-1.8 表示跌 1.8%），
  "confidence": 信心指數 1-5（整數），
  "summary": "兩到三句繁體中文分析理由"
}}"""


async def call_llm_for_prediction(llm: LlmClient, prompt: str) -> dict:
    fallback = {
        "direction": "up", "change_pct_total": 0.0, "confidence": 1,
        "summary": "AI 預測服務暫時無法使用。",
    }
    try:
        result = await llm.generate(system_prompt=prompt, payload={}, schema=PredictionOutput)
        return PredictionOutput.model_validate(result.payload).model_dump(mode="json")
    except (AppError, ValidationError, TypeError, ValueError):
        return fallback


async def generate_prediction(
    stock_id: str, stock_name: str, price_records: list[dict], news_titles: list[str],
    strategy: StrategyConfig, llm: LlmClient,
) -> dict:
    """Single entry point shared by the live trend endpoints."""
    closes = [float(record["close"]) for record in price_records]
    if not closes:
        raise ValueError("price_records must not be empty")
    change_pct = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else 0.0
    regression_history, slope, _ = compute_weighted_regression(closes, strategy.regression_lambda)
    trend = (f"最近 {len(closes)} 個交易日，收盤價從 {closes[0]} 元變化至 {closes[-1]} 元"
             f"（{change_pct:+.2f}%），線性回歸斜率每日 {slope:+.2f} 元。")
    prompt = build_prediction_prompt(stock_id, stock_name, trend, news_titles, strategy)
    llm_result = await call_llm_for_prediction(llm, prompt)
    return {
        "prompt_used": prompt,
        "news_count": len(news_titles),
        **llm_result,
        "regression_history": regression_history,
        "slope": slope,
        "last_price": closes[-1],
    }


def next_trading_days(last_date: str, horizon_days: int) -> list[str]:
    current = date.fromisoformat(last_date) + timedelta(days=1)
    dates = []
    while len(dates) < horizon_days:
        if current.weekday() < 5:
            dates.append(current.isoformat())
        current += timedelta(days=1)
    return dates


def build_chart_payload(records: list[dict], prediction: dict, strategy: StrategyConfig) -> dict:
    closes = [float(record["close"]) for record in records]
    last_price = closes[-1]
    history = prediction["regression_history"]
    residuals = [close - fitted for close, fitted in zip(closes, history)]
    residual_std = math.sqrt(sum(residual * residual for residual in residuals) / len(residuals))
    upper = [round(value + residual_std, 2) for value in history]
    lower = [round(value - residual_std, 2) for value in history]
    returns = [(closes[i] - closes[i - 1]) / closes[i - 1] for i in range(1, len(closes))]
    mean_return = sum(returns) / len(returns) if returns else 0.0
    variance = (sum((value - mean_return) ** 2 for value in returns) / len(returns)
                if returns else 0.0)
    change_pct = prediction["change_pct_total"]
    target_price = round(last_price * (1 + change_pct / 100), 2)
    horizon = strategy.horizon_days
    ai_future = [round(last_price + (target_price - last_price) * (i + 1) / horizon, 2)
                 for i in range(horizon)]
    return {
        "history_dates": [record["date"] for record in records],
        "regression_history": history,
        "regression_upper": upper,
        "regression_lower": lower,
        "future_dates": next_trading_days(records[-1]["date"], horizon),
        "regression_future": compute_momentum_meanreversion_curve(
            closes, horizon, momentum_lambda=strategy.momentum_lambda,
            mean_reversion_decay=strategy.mean_reversion_decay),
        "ai_future": ai_future,
        "last_price": last_price,
        "target_price": target_price,
        "daily_sigma_pct": round(math.sqrt(variance) * 100, 2),
    }


def weekly_prompt(stock_name: str, stock_id: str, last_price: float, trend: str,
                  news_desc: str, week: int, prior_nodes: list[dict],
                  trading_days_per_week: int) -> str:
    prior = ""
    if prior_nodes:
        prior = "\n\n## 前幾週已預測結果\n" + "\n".join(
            f"  第{node['week']}週末：{node['pct']:+.2f}%，{node['reason']}"
            for node in prior_nodes
        )
    horizon = week * trading_days_per_week
    return f"""你是台股分析師。請根據以下資訊，獨立預測 {stock_name}（{stock_id}）第 {week} 週末（未來第 {horizon} 個交易日）的漲跌幅。

## 當前資訊
- 最新收盤價：{last_price} 元
- {trend}

## 近期相關新聞
{news_desc}{prior}

請只回答 JSON，不要其他文字：
{{"pct": "漲跌幅數字（例如 1.5 或 -2.0）", "reason": "一句話說明本週關鍵判斷依據"}}"""
