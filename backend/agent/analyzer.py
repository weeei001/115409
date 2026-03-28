"""Reasoning engine — aligns data on timeline and produces the final AnalysisResult."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

from agent.llm_client import LLMClient
from agent.pattern_detector import detect_all_patterns
from agent.prompt_templates import (
    ANALYSIS_SYSTEM,
    ANALYSIS_USER,
    PATTERN_SUMMARY_SYSTEM,
    PATTERN_SUMMARY_USER,
)
from agent.schemas import AnalysisResult, FetchedData, NormalizedNewsChunk

logger = logging.getLogger(__name__)


def _recency_weight(item_date_str: str, ref_date: date) -> float:
    """Weight: 1.0 for today, decaying by age in days."""
    try:
        d = date.fromisoformat(item_date_str)
    except (ValueError, TypeError):
        return 0.4
    delta = (ref_date - d).days
    if delta <= 1:
        return 1.0
    if delta <= 3:
        return 0.7
    return 0.4


def _format_prices(prices: list[dict]) -> str:
    if not prices:
        return "（無資料）"
    lines = []
    for p in prices[-10:]:
        lines.append(
            f"{p['date']}  收:{p.get('close','N/A')}  "
            f"量:{p.get('volume','N/A')}  漲跌:{p.get('change','N/A')}"
        )
    return "\n".join(lines)


def _format_indicators(indicators: list[dict]) -> str:
    if not indicators:
        return "（無資料）"
    latest = indicators[-1]
    parts = [f"日期: {latest.get('date', 'N/A')}"]
    for key in ("ma5", "ma10", "ma20", "ma60", "k_value", "d_value",
                "rsi14", "macd", "macd_signal", "macd_hist",
                "bb_upper", "bb_middle", "bb_lower"):
        val = latest.get(key)
        if val is not None:
            parts.append(f"{key}: {val}")
    return "\n".join(parts)


def _format_institutional(institutional: list[dict]) -> str:
    if not institutional:
        return "（無資料）"
    lines = ["日期 | 外資淨買超 | 投信淨買超 | 自營商淨買超 | 三大法人合計"]
    for row in institutional[-5:]:
        lines.append(
            f"{row['date']} | {row.get('foreign_net', 0):,} | "
            f"{row.get('trust_net', 0):,} | {row.get('dealer_net', 0):,} | "
            f"{row.get('total_net', 0):,}"
        )
    return "\n".join(lines)


def _format_news(news: list[NormalizedNewsChunk]) -> str:
    if not news:
        return "（無相關新聞）"
    lines = []
    for n in news[:5]:
        url_part = f" ({n.url})" if n.url else " (來源不明)"
        lines.append(f"- [{n.timestamp.strftime('%Y-%m-%d')}] {n.title}{url_part}\n  {n.content}")
    return "\n".join(lines)


def _build_fallback(data: FetchedData) -> AnalysisResult:
    """Template-based response when LLM is unavailable."""
    latest_price = data.prices[-1] if data.prices else {}
    latest_ind = data.indicators[-1] if data.indicators else {}

    ind_date = latest_ind.get("date", "N/A")
    price_date = latest_price.get("date", "N/A")

    highlights: list[str] = []
    if latest_ind.get("k_value") is not None and latest_ind.get("d_value") is not None:
        highlights.append(f"{ind_date} KD 值：K={latest_ind['k_value']}, D={latest_ind['d_value']}")
    if latest_ind.get("rsi14") is not None:
        highlights.append(f"{ind_date} RSI(14)：{latest_ind['rsi14']}")
    if latest_ind.get("macd") is not None:
        highlights.append(f"{ind_date} MACD：{latest_ind['macd']}")
    if latest_price.get("close") is not None and latest_ind.get("ma20") is not None:
        relation = "在" if float(latest_price["close"]) >= float(latest_ind["ma20"]) else "低於"
        highlights.append(f"{price_date} 收盤價 {latest_price['close']} {relation} 20日均線 {latest_ind['ma20']}")

    inst_summary: list[dict] = data.institutional[-5:] if data.institutional else []

    fallback_note = "（目前僅參考量化指標，新聞來源暫時無法取得）" if data.news_fallback else ""

    return AnalysisResult(
        summary=f"{data.symbol} 於 {data.date_start} 至 {data.date_end} 期間的量化數據摘要。{fallback_note}",
        sentiment_score=0.0,
        technical_highlights=highlights or ["目前無足夠的技術指標資料"],
        institutional_data=inst_summary,
        recommendation="中性觀望",
        recommendation_basis=["LLM 分析暫時無法使用，僅提供原始數據供參考"],
        news_sources=data.news[:5],
        fallback_mode=True,
    )


def _format_pattern_hits(hits: list[dict]) -> str:
    if not hits:
        return "（未偵測到任何技術訊號）"
    lines: list[str] = []
    for h in hits:
        detail_parts = []
        for k, v in h.items():
            if k in ("date", "pattern"):
                continue
            detail_parts.append(f"{k}={v}")
        detail = ", ".join(detail_parts)
        lines.append(f"- {h['date']}　{h['pattern']}　({detail})" if detail else f"- {h['date']}　{h['pattern']}")
    return "\n".join(lines)


async def analyze_pattern(
    llm: LLMClient,
    data: FetchedData,
    original_query: str,
) -> tuple[AnalysisResult, str]:
    """Run programmatic pattern detection, then let LLM summarize the results.

    Returns (AnalysisResult with empty structured fields, raw_answer text).
    """
    hits = detect_all_patterns(data.prices, data.indicators)
    pattern_text = _format_pattern_hits(hits)

    user_prompt = PATTERN_SUMMARY_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        original_query=original_query,
        total_hits=len(hits),
        pattern_lines=pattern_text,
    )

    try:
        raw_answer = await llm.complete(PATTERN_SUMMARY_SYSTEM, user_prompt, temperature=0.3, max_tokens=2048)
    except Exception:
        logger.exception("Pattern summary LLM call failed, returning raw hits")
        raw_answer = f"偵測期間：{data.date_start} 至 {data.date_end}\n共偵測到 {len(hits)} 筆技術訊號：\n\n{pattern_text}"

    result = AnalysisResult(fallback_mode=False)
    return result, raw_answer


async def analyze(llm: LLMClient, data: FetchedData, focus: str, original_query: str) -> AnalysisResult | tuple[AnalysisResult, str]:
    if focus == "pattern":
        return await analyze_pattern(llm, data, original_query)

    if not data.prices and not data.indicators:
        return _build_fallback(data)

    user_prompt = ANALYSIS_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        focus=focus,
        original_query=original_query,
        price_data=_format_prices(data.prices),
        indicator_data=_format_indicators(data.indicators),
        institutional_data=_format_institutional(data.institutional),
        news_data=_format_news(data.news),
    )

    try:
        result = await llm.complete_json(ANALYSIS_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Analysis LLM call failed, returning fallback")
        return _build_fallback(data)

    inst_summary = data.institutional[-5:] if data.institutional else []

    sentiment = float(result.get("sentiment_score", 0.0))
    sentiment = max(-1.0, min(1.0, sentiment))

    return AnalysisResult(
        summary=result.get("summary", ""),
        sentiment_score=sentiment,
        technical_highlights=result.get("technical_highlights", []),
        institutional_data=inst_summary,
        recommendation=result.get("recommendation", "中性觀望"),
        recommendation_basis=result.get("recommendation_basis", []),
        news_sources=data.news[:5],
        fallback_mode=data.news_fallback and len(data.news) == 0,
    )
