"""Two-stage analysis engine.

Stage 1: analyze_technical — LLM produces a technical/quantitative analysis from DB data.
Stage 2: synthesize       — LLM merges technical analysis + RAG news analysis into final AnalysisResult.
"""

from __future__ import annotations

import json
import logging
from datetime import date

from agent.llm_client import LLMClient
from agent.prompt_templates import (
    TECHNICAL_SYSTEM,
    TECHNICAL_USER,
    QUICK_INSIGHTS_SYSTEM,
    QUICK_INSIGHTS_USER,
    FINAL_INTEGRATE_SYSTEM,
    FINAL_INTEGRATE_USER,
    SYNTHESIS_SYSTEM,
    SYNTHESIS_USER,
)
from agent.schemas import AnalysisResult, DBData, NormalizedNewsChunk

logger = logging.getLogger(__name__)


# ── Data formatting helpers ──────────────────────────────────────────────────

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


def _latest_indicator_json(data: DBData) -> str:
    if not data.indicators:
        return "{}"
    return json.dumps(data.indicators[-1], ensure_ascii=False)


def _price_compact_for_quick(data: DBData) -> str:
    if not data.prices:
        return "（無資料）"
    lines = []
    for p in data.prices[-5:]:
        lines.append(
            f"{p.get('date', '')} 收:{p.get('close', 'N/A')} 量:{p.get('volume', 'N/A')} 漲跌:{p.get('change', 'N/A')}"
        )
    return "\n".join(lines)


def _normalize_quick_points(raw: dict) -> list[str]:
    pts = raw.get("points")
    if not isinstance(pts, list):
        return []
    out: list[str] = []
    for p in pts:
        s = str(p).strip()
        if s:
            out.append(s)
    return out[:8]


def _quick_insights_fallback(data: DBData) -> dict:
    """規則化重點，供 LLM 失敗時快速回傳。"""
    pts: list[str] = []
    if data.indicators:
        li = data.indicators[-1]
        d = str(li.get("date") or "")
        if li.get("rsi14") is not None:
            pts.append(f"{d} RSI(14)={li['rsi14']}（規則化摘要）")
        if li.get("k_value") is not None and li.get("d_value") is not None:
            pts.append(f"{d} KD：K={li['k_value']} D={li['d_value']}（規則化摘要）")
        if li.get("macd_hist") is not None:
            pts.append(f"{d} MACD Histogram={li['macd_hist']}（規則化摘要）")
    if data.institutional:
        row = data.institutional[-1]
        pts.append(
            f"{row['date']} 三大法人合計淨額 {row.get('total_net', 0):,} 股（規則化摘要）"
        )
        if len(data.institutional) >= 2:
            a, b = data.institutional[-2], data.institutional[-1]
            da = int(a.get("total_net", 0))
            db = int(b.get("total_net", 0))
            if da != 0 and db != 0 and (da > 0) != (db > 0):
                pts.append(
                    f"{a['date']} 合計淨額 {da:,} → {b['date']} {db:,}，方向轉折（規則化摘要）"
                )
    if not pts:
        pts = ["可分析之技術與籌碼資料不足（規則化摘要）"]
    return {"points": pts[:5], "fallback_mode": True}


async def analyze_quick_insights(llm: LLMClient, data: DBData) -> dict:
    """以小型 LLM 快速掃描「最新技術指標＋法人」特別之處；失敗時規則化 fallback。"""
    if not data.indicators and not data.institutional:
        return {
            "points": ["技術指標與法人資料均不足，無法產出觀察。"],
            "fallback_mode": True,
        }

    user_prompt = QUICK_INSIGHTS_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        latest_indicator_json=_latest_indicator_json(data),
        institutional_compact=_format_institutional(data.institutional),
        price_compact=_price_compact_for_quick(data),
    )

    try:
        raw = await llm.complete_json(
            QUICK_INSIGHTS_SYSTEM,
            user_prompt,
            temperature=0.2,
            max_tokens=512,
        )
        if not isinstance(raw, dict):
            raise ValueError("quick insights root must be object")
        points = _normalize_quick_points(raw)
        if not points:
            return _quick_insights_fallback(data)
        return {"points": points, "fallback_mode": False}
    except Exception:
        logger.exception("Quick insights LLM failed, using rule-based fallback")
        return _quick_insights_fallback(data)


# ── Fallback (no LLM available) ─────────────────────────────────────────────

def _build_fallback(data: DBData, news: list[NormalizedNewsChunk] | None = None) -> AnalysisResult:
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

    return AnalysisResult(
        summary=f"{data.symbol} 於 {data.date_start} 至 {data.date_end} 期間的量化數據摘要。",
        sentiment_score=0.0,
        technical_highlights=highlights or ["目前無足夠的技術指標資料"],
        institutional_data=inst_summary,
        recommendation="中性觀望（LLM 分析暫時無法使用，僅提供原始數據供參考）",
        news_sources=(news or [])[:5],
        fallback_mode=True,
    )


# ── Stage 1: Technical / Quantitative Analysis ──────────────────────────────

async def analyze_technical(llm: LLMClient, data: DBData) -> str:
    """Call LLM to produce a text-based technical + institutional analysis.

    Returns the analysis text, or a formatted summary if LLM fails.
    """
    if not data.prices and not data.indicators:
        return "（無足夠的價量與技術指標資料可供分析）"

    user_prompt = TECHNICAL_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        price_data=_format_prices(data.prices),
        indicator_data=_format_indicators(data.indicators, data.prices),
        institutional_data=_format_institutional(data.institutional),
    )

    try:
        return await llm.complete(TECHNICAL_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Stage-1 LLM (technical analysis) failed, returning formatted data")
        parts = [
            "【收盤價】\n" + _format_prices(data.prices),
            "【技術指標】\n" + _format_indicators(data.indicators, data.prices),
            "【三大法人】\n" + _format_institutional(data.institutional),
        ]
        return "\n\n".join(parts)


# ── Recommendation formatting (merge LLM「依據」條列進單一 recommendation 字串) ─


def _merge_recommendation_parens(recommendation: str, basis: list[str]) -> str:
    """將方向與（可選）依據列表合併為單一「偏多（…）」格式；已含全形括號則保留。"""
    rec = (recommendation or "").strip()
    parts = [str(b).strip() for b in (basis or []) if str(b).strip()]
    inner = "；".join(parts[:4]) if parts else ""

    if "（" in rec and "）" in rec and rec.find("（") < rec.rfind("）"):
        return rec

    for word in ("偏多", "偏空", "中性觀望"):
        if rec == word or (rec.startswith(word) and "（" not in rec):
            fill = inner or "綜合前述技術與籌碼數據"
            return f"{word}（{fill}）"
    if inner:
        return f"{rec}（{inner}）" if rec else f"中性觀望（{inner}）"
    return rec or "中性觀望（綜合研判）"


# ── Final integrate (raw DB ×3 + news, single large-LLM JSON) ────────────────


async def analyze_final_integrated(
    llm: LLMClient,
    data: DBData,
    news_analysis: str,
    news: list[NormalizedNewsChunk] | None = None,
) -> AnalysisResult:
    """僅依價量／指標／法人原始整理與新聞摘要產出整合結果。

    technical_highlights 固定為空，避免與 /analyze/quick-insights 的 points 語意重複。
    """
    user_prompt = FINAL_INTEGRATE_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        price_data=_format_prices(data.prices),
        indicator_data=_format_indicators(data.indicators, data.prices),
        institutional_data=_format_institutional(data.institutional),
        news_analysis=news_analysis or "（新聞情緒資料暫時無法取得）",
    )

    try:
        result = await llm.complete_json(FINAL_INTEGRATE_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Final integrate LLM failed, returning fallback")
        fb = _build_fallback(data, news)
        return AnalysisResult(
            summary=fb.summary,
            sentiment_score=fb.sentiment_score,
            technical_highlights=[],
            institutional_data=fb.institutional_data,
            recommendation=fb.recommendation,
            news_sources=fb.news_sources,
            fallback_mode=True,
        )

    inst_summary = data.institutional[-5:] if data.institutional else []

    sentiment = float(result.get("sentiment_score", 0.0))
    sentiment = max(-1.0, min(1.0, sentiment))

    basis_in = result.get("recommendation_basis")
    basis_list: list[str] = []
    if isinstance(basis_in, list):
        basis_list = [str(b).strip() for b in basis_in if str(b).strip()][:8]
    rec = _merge_recommendation_parens(str(result.get("recommendation", "")), basis_list)

    return AnalysisResult(
        summary=result.get("summary", ""),
        sentiment_score=sentiment,
        technical_highlights=[],
        institutional_data=inst_summary,
        recommendation=rec,
        news_sources=(news or [])[:5],
        fallback_mode=False,
    )


# ── Stage 2: Synthesis ──────────────────────────────────────────────────────

async def synthesize(
    llm: LLMClient,
    data: DBData,
    technical_analysis: str,
    news_analysis: str,
    news: list[NormalizedNewsChunk] | None = None,
) -> AnalysisResult:
    """Call LLM to merge technical analysis + news analysis into final AnalysisResult."""
    user_prompt = SYNTHESIS_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        technical_analysis=technical_analysis,
        news_analysis=news_analysis or "（新聞情緒資料暫時無法取得）",
    )

    try:
        result = await llm.complete_json(SYNTHESIS_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Stage-2 LLM (synthesis) failed, returning fallback")
        return _build_fallback(data, news)

    inst_summary = data.institutional[-5:] if data.institutional else []

    sentiment = float(result.get("sentiment_score", 0.0))
    sentiment = max(-1.0, min(1.0, sentiment))

    basis_in = result.get("recommendation_basis")
    basis_list: list[str] = []
    if isinstance(basis_in, list):
        basis_list = [str(b).strip() for b in basis_in if str(b).strip()][:8]
    rec = _merge_recommendation_parens(str(result.get("recommendation", "")), basis_list)

    return AnalysisResult(
        summary=result.get("summary", ""),
        sentiment_score=sentiment,
        technical_highlights=result.get("technical_highlights", []),
        institutional_data=inst_summary,
        recommendation=rec,
        news_sources=(news or [])[:5],
        fallback_mode=False,
    )
