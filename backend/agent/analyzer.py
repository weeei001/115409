"""Reasoning engine — aligns data on timeline and produces the final AnalysisResult."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime, timedelta

from agent.llm_client import LLMClient
from agent.prompt_templates import ANALYSIS_SYSTEM, ANALYSIS_USER
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


def _format_indicators(indicators: list[dict], prices: list[dict] | None = None) -> str:
    if not indicators:
        return "（無資料）"

    latest = indicators[-1]
    sections: list[str] = []

    # ── 最新數值總覽 ──
    d = latest.get("date", "N/A")
    row_parts = [f"日期: {d}"]
    for key in ("ma5", "ma10", "ma20", "ma60", "k_value", "d_value",
                "rsi14", "macd", "macd_signal", "macd_hist",
                "bb_upper", "bb_middle", "bb_lower"):
        val = latest.get(key)
        if val is not None:
            row_parts.append(f"{key}: {val}")
    sections.append("【最新技術指標】\n" + "\n".join(row_parts))

    # ── RSI(14) 月內走勢 ──
    rsi_lines: list[str] = []
    rsi_series = [(i.get("date", ""), i.get("rsi14")) for i in indicators if i.get("rsi14") is not None]
    if rsi_series:
        overbought = [(dt, v) for dt, v in rsi_series if v > 70]
        oversold = [(dt, v) for dt, v in rsi_series if v < 30]
        rsi_lines.append("超買（>70）：" + ("、".join(f"{dt} RSI={v}" for dt, v in overbought) if overbought else "無"))
        rsi_lines.append("超賣（<30）：" + ("、".join(f"{dt} RSI={v}" for dt, v in oversold) if oversold else "無"))
        recent_5 = rsi_series[-5:]
        if len(recent_5) >= 2:
            trend = "上升" if recent_5[-1][1] > recent_5[0][1] else "下降"
            trail = " → ".join(f"{v}" for _, v in recent_5)
            rsi_lines.append(f"近 {len(recent_5)} 日走勢（{trend}）：{trail}")
        sections.append("【RSI(14) 月內走勢】\n" + "\n".join(rsi_lines))

    # ── MACD 月內走勢 ──
    macd_lines: list[str] = []
    macd_series = [
        (i.get("date", ""), i.get("macd"), i.get("macd_signal"), i.get("macd_hist"))
        for i in indicators
        if i.get("macd") is not None and i.get("macd_signal") is not None
    ]
    if len(macd_series) >= 2:
        for idx in range(1, len(macd_series)):
            prev_m, prev_s = macd_series[idx - 1][1], macd_series[idx - 1][2]
            cur_d, cur_m, cur_s, _ = macd_series[idx]
            prev_diff = prev_m - prev_s
            cur_diff = cur_m - cur_s
            if prev_diff <= 0 < cur_diff:
                pos = "零軸上方" if cur_m > 0 else "零軸下方"
                macd_lines.append(f"{cur_d} MACD 金叉（{pos}）：MACD={cur_m} 上穿 Signal={cur_s}")
            elif prev_diff >= 0 > cur_diff:
                pos = "零軸上方" if cur_m > 0 else "零軸下方"
                macd_lines.append(f"{cur_d} MACD 死叉（{pos}）：MACD={cur_m} 下穿 Signal={cur_s}")
        if not macd_lines:
            macd_lines.append("本月無金叉/死叉交叉")
        hist_recent = [(dt, h) for dt, _, _, h in macd_series[-5:] if h is not None]
        if hist_recent:
            trail = " → ".join(f"{h}" for _, h in hist_recent)
            macd_lines.append(f"Histogram 近 {len(hist_recent)} 日：{trail}")
        sections.append("【MACD 月內走勢】\n" + "\n".join(macd_lines))

    # ── KD 月內走勢 ──
    kd_lines: list[str] = []
    kd_series = [
        (i.get("date", ""), i.get("k_value"), i.get("d_value"))
        for i in indicators
        if i.get("k_value") is not None and i.get("d_value") is not None
    ]
    if len(kd_series) >= 2:
        for idx in range(1, len(kd_series)):
            prev_k, prev_d_val = kd_series[idx - 1][1], kd_series[idx - 1][2]
            cur_date, cur_k, cur_d_val = kd_series[idx]
            if prev_k <= prev_d_val and cur_k > cur_d_val:
                zone = "低檔" if cur_k < 30 else ("中檔" if cur_k < 70 else "高檔")
                kd_lines.append(f"{cur_date} KD 金叉（{zone}）：K={cur_k} 上穿 D={cur_d_val}")
            elif prev_k >= prev_d_val and cur_k < cur_d_val:
                zone = "低檔" if cur_k < 30 else ("中檔" if cur_k < 70 else "高檔")
                kd_lines.append(f"{cur_date} KD 死叉（{zone}）：K={cur_k} 下穿 D={cur_d_val}")
        if not kd_lines:
            kd_lines.append("本月無 KD 金叉/死叉交叉")
        last_k, last_d = kd_series[-1][1], kd_series[-1][2]
        state = "多方排列（K > D）" if last_k > last_d else "空方排列（K < D）"
        kd_lines.append(f"目前 K={last_k} / D={last_d}，{state}")
        sections.append("【KD 月內走勢】\n" + "\n".join(kd_lines))

    # ── 股價與均線關係 ──
    if prices:
        ma_lines: list[str] = []
        valid_prices = [p for p in prices if p.get("close") is not None]
        if valid_prices:
            closes = [(p["date"], float(p["close"])) for p in valid_prices]
            high_date, high_val = max(closes, key=lambda x: x[1])
            low_date, low_val = min(closes, key=lambda x: x[1])
            ma_lines.append(f"月內最高收盤：{high_date} {high_val}")
            ma_lines.append(f"月內最低收盤：{low_date} {low_val}")

        ma20_pairs = []
        for p, ind in zip(prices, indicators):
            close = p.get("close")
            ma20 = ind.get("ma20")
            if close is not None and ma20 is not None:
                ma20_pairs.append((p.get("date", ""), float(close), float(ma20)))
        if ma20_pairs:
            latest_close, latest_ma20 = ma20_pairs[-1][1], ma20_pairs[-1][2]
            above = latest_close >= latest_ma20
            streak = 0
            for _, c, m in reversed(ma20_pairs):
                if (c >= m) == above:
                    streak += 1
                else:
                    break
            rel = "站上" if above else "跌破"
            ma_lines.append(f"股價自 {ma20_pairs[-streak][0]} {rel} 20 日均線，已持續 {streak} 個交易日")

        ma_vals = {}
        for label in ("ma5", "ma10", "ma20", "ma60"):
            v = latest.get(label)
            if v is not None:
                ma_vals[label.upper()] = float(v)
        if ma_vals:
            sorted_ma = sorted(ma_vals.items(), key=lambda x: -x[1])
            order = " > ".join(f"{k}({v})" for k, v in sorted_ma)
            if all(sorted_ma[i][1] >= sorted_ma[i + 1][1] for i in range(len(sorted_ma) - 1)):
                if sorted_ma[0][0] == "MA5":
                    order += "，多頭排列"
                elif sorted_ma[-1][0] == "MA5":
                    order += "，空頭排列"
            ma_lines.append(f"均線排列：{order}")

        if ma_lines:
            sections.append("【股價與均線關係】\n" + "\n".join(ma_lines))

    return "\n\n".join(sections)


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


async def analyze(llm: LLMClient, data: FetchedData, focus: str, original_query: str) -> AnalysisResult:
    if not data.prices and not data.indicators:
        return _build_fallback(data)

    user_prompt = ANALYSIS_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        focus=focus,
        original_query=original_query,
        price_data=_format_prices(data.prices),
        indicator_data=_format_indicators(data.indicators, data.prices),
        institutional_data=_format_institutional(data.institutional),
        rag_summary=data.rag_summary or "（無新聞情緒摘要）",
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
