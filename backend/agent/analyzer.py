"""LLM analysis: quick-insights (points) and final integrate (summary + recommendation + news)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import date

from agent.llm_client import LLMClient
from agent.prompt_templates import (
    QUICK_INSIGHTS_SYSTEM,
    QUICK_INSIGHTS_USER,
    FINAL_INTEGRATE_SYSTEM,
    FINAL_INTEGRATE_USER,
)
from agent.scoring import (
    build_recommendation_basis,
    compute_score_breakdown,
    recommendation_from_weighted_score,
)
from agent.schemas import AnalysisResult, DBData, NormalizedNewsChunk, ScoreBreakdown

logger = logging.getLogger(__name__)

_DATE_RE = re.compile(r"\b\d{4}[-/]\d{2}[-/]\d{2}\b")
_NUMBER_RE = re.compile(r"-?\d+(?:\.\d+)?")
_QUICK_INSIGHTS_TIMEOUT_SEC = 10.0
_QUICK_INSIGHTS_MAX_TOKENS = 256
_LLM_ANALYSIS_WINDOW_DAYS = 20


# ── Data formatting helpers ──────────────────────────────────────────────────

def _format_prices(prices: list[dict]) -> str:
    if not prices:
        return "（無資料）"
    lines = []
    for p in prices[-_LLM_ANALYSIS_WINDOW_DAYS:]:
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
        recent = rsi_series[-_LLM_ANALYSIS_WINDOW_DAYS:]
        if len(recent) >= 2:
            trend = "上升" if recent[-1][1] > recent[0][1] else "下降"
            trail = " → ".join(f"{v}" for _, v in recent)
            rsi_lines.append(f"近 {len(recent)} 日走勢（{trend}）：{trail}")
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
        hist_recent = [(dt, h) for dt, _, _, h in macd_series[-_LLM_ANALYSIS_WINDOW_DAYS:] if h is not None]
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
    for row in institutional[-_LLM_ANALYSIS_WINDOW_DAYS:]:
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
    for p in data.prices[-_LLM_ANALYSIS_WINDOW_DAYS:]:
        lines.append(
            f"{p.get('date', '')} 收:{p.get('close', 'N/A')} 量:{p.get('volume', 'N/A')} 漲跌:{p.get('change', 'N/A')}"
        )
    return "\n".join(lines)


def _latest_reference_date(data: DBData) -> str:
    for rows in (data.indicators, data.prices, data.institutional):
        if rows and rows[-1].get("date"):
            return str(rows[-1]["date"])
    return data.date_end.isoformat()


def _normalize_quick_points(raw: dict, *, default_date: str) -> list[str]:
    pts = raw.get("points")
    if isinstance(pts, str):
        pts = [s for s in (line.strip() for line in pts.splitlines()) if s]
    if not isinstance(pts, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for p in pts:
        s = str(p).strip().lstrip("-• ").strip()
        if not s:
            continue
        s = " ".join(s.split())

        has_date = bool(_DATE_RE.search(s))
        has_number = bool(_NUMBER_RE.search(s))
        if not has_date and has_number:
            s = f"{default_date} {s}"
            has_date = True

        if not has_date and not has_number:
            continue
        if s in seen:
            continue
        seen.add(s)
        out.append(s)
        if len(out) >= 5:
            break
    return out


def _normalize_summary(summary: str) -> str:
    s = " ".join((summary or "").strip().split())
    if not s:
        return "資料不足，無法產生摘要。"
    if len(s) > 320:
        s = s[:320].rstrip("，,。.；; ") + "。"
    return s


def _quick_insights_fallback(data: DBData, *, include_rule_tag: bool = True) -> dict:
    """規則化重點，供 LLM 失敗時快速回傳。"""
    rule_tag = "（規則化摘要）" if include_rule_tag else ""
    pts: list[str] = []
    if data.indicators:
        li = data.indicators[-1]
        d = str(li.get("date") or "")
        if li.get("rsi14") is not None:
            pts.append(f"{d} RSI(14)={li['rsi14']}{rule_tag}")
        if li.get("k_value") is not None and li.get("d_value") is not None:
            pts.append(f"{d} KD：K={li['k_value']} D={li['d_value']}{rule_tag}")
        if li.get("macd_hist") is not None:
            pts.append(f"{d} MACD Histogram={li['macd_hist']}{rule_tag}")
    if data.institutional:
        row = data.institutional[-1]
        pts.append(
            f"{row['date']} 三大法人合計淨額 {row.get('total_net', 0):,} 股{rule_tag}"
        )
        if len(data.institutional) >= 2:
            a, b = data.institutional[-2], data.institutional[-1]
            da = int(a.get("total_net", 0))
            db = int(b.get("total_net", 0))
            if da != 0 and db != 0 and (da > 0) != (db > 0):
                pts.append(
                    f"{a['date']} 合計淨額 {da:,} → {b['date']} {db:,}，方向轉折{rule_tag}"
                )
    if not pts:
        pts = [f"可分析之技術與籌碼資料不足{rule_tag}"]
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
        raw = await asyncio.wait_for(
            llm.complete_json(
                QUICK_INSIGHTS_SYSTEM,
                user_prompt,
                temperature=0.2,
                max_tokens=_QUICK_INSIGHTS_MAX_TOKENS,
                retries=2,
            ),
            timeout=_QUICK_INSIGHTS_TIMEOUT_SEC,
        )
        if not isinstance(raw, dict):
            raise ValueError("quick insights root must be object")
        points = _normalize_quick_points(raw, default_date=_latest_reference_date(data))
        if not points:
            return _quick_insights_fallback(data)
        if len(points) < 3:
            fb = _quick_insights_fallback(data, include_rule_tag=False)
            for point in fb["points"]:
                if point in points:
                    continue
                points.append(point)
                if len(points) >= 5:
                    break
            return {"points": points, "fallback_mode": True}
        return {"points": points, "fallback_mode": False}
    except asyncio.TimeoutError:
        logger.warning("Quick insights LLM timed out, using rule-based fallback")
        return _quick_insights_fallback(data)
    except Exception:
        logger.exception("Quick insights LLM failed, using rule-based fallback")
        return _quick_insights_fallback(data)


# ── Fallback (no LLM available) ─────────────────────────────────────────────

def _build_fallback(
    data: DBData,
    score_breakdown: ScoreBreakdown,
    recommendation: str,
    news: list[NormalizedNewsChunk] | None = None,
) -> AnalysisResult:
    """Template-based response when LLM is unavailable."""
    inst_summary: list[dict] = data.institutional[-_LLM_ANALYSIS_WINDOW_DAYS:] if data.institutional else []
    weighted = score_breakdown.weighted_score
    basis = build_recommendation_basis(score_breakdown)

    return AnalysisResult(
        summary=(
            f"{data.symbol} 於 {data.date_start} 至 {data.date_end} 的加權分數為 {weighted:.2f}。"
            "LLM 解釋暫時不可用，改由後端規則化輸出。"
        ),
        sentiment_score=weighted,
        technical_highlights=[],
        institutional_data=inst_summary,
        recommendation=recommendation,
        recommendation_basis=basis,
        news_sources=(news or [])[:5],
        score_breakdown=score_breakdown,
        fallback_mode=True,
    )


def _normalize_recommendation_basis(
    basis_in: object,
    score_breakdown: ScoreBreakdown,
) -> list[str]:
    fallback = build_recommendation_basis(score_breakdown)
    if not isinstance(basis_in, list):
        return fallback

    parsed = [str(item).strip() for item in basis_in if str(item).strip()]
    parsed = parsed[:4]
    if len(parsed) < 4:
        parsed.extend(fallback[len(parsed):4])
    return parsed[:4]


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
    score_breakdown = compute_score_breakdown(data, news_analysis or "", news)
    recommendation = recommendation_from_weighted_score(score_breakdown.weighted_score)

    score_breakdown_payload = json.dumps(
        {
            "technical_score": score_breakdown.technical_score,
            "institutional_score": score_breakdown.institutional_score,
            "news_score": score_breakdown.news_score,
            "momentum_score": score_breakdown.momentum_score,
            "weighted_score": score_breakdown.weighted_score,
            "weights": score_breakdown.weights.model_dump(),
            "backend_recommendation": recommendation,
            "backend_explanations": score_breakdown.explanations.model_dump(),
        },
        ensure_ascii=False,
    )

    user_prompt = FINAL_INTEGRATE_USER.format(
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        price_data=_format_prices(data.prices),
        indicator_data=_format_indicators(data.indicators, data.prices),
        institutional_data=_format_institutional(data.institutional),
        news_analysis=news_analysis or "（新聞情緒資料暫時無法取得）",
        score_breakdown=score_breakdown_payload,
    )

    try:
        result = await llm.complete_json(FINAL_INTEGRATE_SYSTEM, user_prompt)
    except Exception:
        logger.exception("Final integrate LLM failed, returning fallback")
        return _build_fallback(data, score_breakdown, recommendation, news)

    inst_summary = data.institutional[-_LLM_ANALYSIS_WINDOW_DAYS:] if data.institutional else []

    summary = _normalize_summary(result.get("summary", ""))
    basis_list = _normalize_recommendation_basis(result.get("recommendation_basis"), score_breakdown)

    return AnalysisResult(
        summary=summary,
        sentiment_score=score_breakdown.weighted_score,
        technical_highlights=[],
        institutional_data=inst_summary,
        recommendation=recommendation,
        recommendation_basis=basis_list,
        news_sources=(news or [])[:5],
        score_breakdown=score_breakdown,
        fallback_mode=False,
    )
