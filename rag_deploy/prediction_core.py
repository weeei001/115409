import os
"""
共用預測核心
============
從 api_server.py 的 get_trend_predict / trend_predict_stream 抽出的純函式，
讓「即時預測」（rag_deploy/api_server.py）與「歷史回測」（backend/backtest/）
共用同一套迴歸計算、prompt 組裝、LLM 呼叫邏輯，只有資料來源不同。
"""

from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass, field
from datetime import datetime


def normalize_time(t: str) -> str:
    """統一時間格式為 YYYY-MM-DD HH:MM:SS，方便字串比較"""
    if not t:
        return ""
    t = t.replace("T", " ")
    if "+" in t:
        t = t[:t.index("+")]
    if len(t) > 19:
        t = t[:19]
    return t.strip()


def compute_weighted_regression(closes: list, lam: float = 0.1):
    """加權線性回歸（指數衰減權重，近期資料影響力較高）。
    回傳 (regression_history, slope, intercept)。"""
    n = len(closes)
    weights = [math.exp(lam * i) for i in range(n)]
    w_sum = sum(weights)
    x_vals = list(range(n))
    x_mean_w = sum(weights[i] * x_vals[i] for i in range(n)) / w_sum
    y_mean_w = sum(weights[i] * closes[i] for i in range(n)) / w_sum
    num_w = sum(weights[i] * (x_vals[i] - x_mean_w) * (closes[i] - y_mean_w) for i in range(n))
    den_w = sum(weights[i] * (x_vals[i] - x_mean_w) ** 2 for i in range(n))
    slope = num_w / den_w if den_w else 0
    intercept = y_mean_w - slope * x_mean_w
    regression_history = [round(slope * i + intercept, 2) for i in x_vals]
    return regression_history, slope, intercept


def compute_momentum_meanreversion_curve(closes: list, horizon_days: int = 20):
    """短期動能 + 均值回歸曲線，用於推算未來 horizon_days 天的價格路徑。"""
    n = len(closes)
    last_price = closes[-1]
    n5 = min(5, n)
    closes5 = closes[-n5:]
    x5 = list(range(n5))
    w5 = [math.exp(0.2 * i) for i in range(n5)]
    w5s = sum(w5)
    x5mw = sum(w5[i] * x5[i] for i in range(n5)) / w5s
    y5mw = sum(w5[i] * closes5[i] for i in range(n5)) / w5s
    n5d = sum(w5[i] * (x5[i] - x5mw) ** 2 for i in range(n5))
    _, slope, _ = compute_weighted_regression(closes)
    short_slope = sum(w5[i] * (x5[i] - x5mw) * (closes5[i] - y5mw) for i in range(n5)) / n5d if n5d else slope
    ma20 = sum(closes[-20:]) / min(20, n)
    mean_pull_per_day = (ma20 - last_price) / 20

    curve = []
    price = last_price
    for i in range(horizon_days):
        decay = math.exp(-0.18 * i)
        daily_move = decay * short_slope + (1 - decay) * mean_pull_per_day
        price = round(price + daily_move, 2)
        curve.append(price)
    return curve


@dataclass
class StrategyConfig:
    """回測/預測策略變體設定。"""
    name: str
    news_window_days: int = 30
    news_limit: int = 20
    prompt_template: str = "default"
    model_name: str = os.environ.get("RAG_LLM_MODEL", "deepseek-ai/deepseek-v4-pro-0813")


def build_prediction_prompt(stock_id: str, stock_name: str, price_trend_desc: str,
                             news_titles: list, strategy: "StrategyConfig") -> str:
    """組裝預測用 prompt。目前只有一個模板（default），
    strategy.prompt_template 保留供未來擴充不同模板。"""
    news_desc = "\n".join(f"- {t}" for t in news_titles) if news_titles else "（無近期新聞）"
    return f"""你是台股分析師，請根據以下資訊預測 {stock_name}（{stock_id}）未來 20 個交易日（約一個月）的股價走勢。

## 近期價格趨勢
{price_trend_desc}

## 近期相關新聞（最多 {strategy.news_limit} 則）
{news_desc}

請以 JSON 格式回答，不要輸出其他文字：
{{
  "direction": "up 或 down",
  "change_pct_total": 預估兩週後總漲跌幅（數字，例如 2.5 表示漲 2.5%，-1.8 表示跌 1.8%），
  "confidence": 信心指數 1-5（整數），
  "summary": "兩到三句繁體中文分析理由"
}}"""


async def call_llm_for_prediction(openai_client, prompt: str, model_name: str,
                                  extra_body: dict | None = None) -> dict:
    """呼叫 LLM 取得預測 JSON，含 fenced-block fallback 與失敗預設值。
    回傳 {direction, change_pct_total, confidence, summary}。
    extra_body：自架 Gemma 需帶 {"chat_template_kwargs": {"enable_thinking": False}}。"""
    import asyncio

    result = {
        "direction": "up",
        "change_pct_total": 0.0,
        "confidence": 1,
        "summary": "AI 預測服務暫時無法使用。",
    }
    try:
        resp = await asyncio.to_thread(
            openai_client.chat.completions.create,
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            max_tokens=300,
            stream=False,
            extra_body=extra_body or {},
        )
        raw = re.sub(r"<think>.*?</think>\s*", "",
                     (resp.choices[0].message.content or "").strip(), flags=re.DOTALL).strip()
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if m:
            parsed = json.loads(m.group())
            result["direction"] = parsed.get("direction", "up")
            result["change_pct_total"] = float(parsed.get("change_pct_total", 0))
            result["confidence"] = int(parsed.get("confidence", 1))
            result["summary"] = parsed.get("summary", "")
    except Exception as e:
        result["summary"] = f"AI 預測失敗：{e}"
    return result


async def generate_prediction(
    stock_id: str,
    stock_name: str,
    price_records: list,
    news_titles: list,
    strategy: "StrategyConfig",
    openai_client,
    extra_body: dict | None = None,
) -> dict:
    """單一進入點：給定價格歷史 + 新聞標題 + 策略設定，回傳結構化預測結果。
    live 端點與回測腳本都應呼叫這個，而非各自重算迴歸/組 prompt。"""
    closes = [r["close"] for r in price_records]
    n = len(closes)
    price_change_pct = round((closes[-1] - closes[0]) / closes[0] * 100, 2) if closes[0] else 0
    regression_history, slope, intercept = compute_weighted_regression(closes)
    price_trend_desc = (
        f"最近 {n} 個交易日，收盤價從 {closes[0]} 元變化至 {closes[-1]} 元"
        f"（{price_change_pct:+.2f}%），線性回歸斜率每日 {slope:+.2f} 元。"
    )

    prompt = build_prediction_prompt(stock_id, stock_name, price_trend_desc, news_titles, strategy)
    llm_result = await call_llm_for_prediction(openai_client, prompt, strategy.model_name, extra_body)

    return {
        "prompt_used": prompt,
        "news_count": len(news_titles),
        "direction": llm_result["direction"],
        "change_pct_total": llm_result["change_pct_total"],
        "confidence": llm_result["confidence"],
        "summary": llm_result["summary"],
        "regression_history": regression_history,
        "slope": slope,
        "last_price": closes[-1],
    }
