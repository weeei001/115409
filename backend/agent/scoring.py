from __future__ import annotations

from statistics import mean

from agent.schemas import DBData, NormalizedNewsChunk, ScoreBreakdown, ScoreExplanations, ScoreWeights

WEIGHTS = ScoreWeights(
    technical=0.38,
    institutional=0.30,
    news=0.15,
    momentum=0.17,
)
ANALYSIS_WINDOW_DAYS = 20

_TECHNICAL_SUB_WEIGHTS = {
    "ma": 0.40,
    "macd": 0.25,
    "rsi": 0.20,
    "kd": 0.15,
}

_POSITIVE_KEYWORDS = (
    "利多",
    "成長",
    "上調",
    "獲利",
    "創高",
    "突破",
    "增持",
    "買超",
    "樂觀",
    "看好",
    "上漲",
    "positive",
    "bullish",
    "beat",
    "upgrade",
)
_NEGATIVE_KEYWORDS = (
    "利空",
    "衰退",
    "下調",
    "虧損",
    "創低",
    "跌破",
    "減持",
    "賣超",
    "悲觀",
    "看淡",
    "下跌",
    "negative",
    "bearish",
    "miss",
    "downgrade",
)


def _clamp(value: float, lower: float = -1.0, upper: float = 1.0) -> float:
    return max(lower, min(upper, value))


def _sign(value: float) -> float:
    if value > 0:
        return 1.0
    if value < 0:
        return -1.0
    return 0.0


def _to_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _extract_latest_close_and_indicators(data: DBData) -> tuple[float | None, dict]:
    latest_price = data.prices[-1] if data.prices else {}
    latest_ind = data.indicators[-1] if data.indicators else {}
    return _to_float(latest_price.get("close")), latest_ind


def _score_technical(data: DBData) -> tuple[float, str]:
    if not data.indicators:
        return 0.0, "技術面資料不足（缺少技術指標），本面向分數以 0 計。"

    latest_close, latest_ind = _extract_latest_close_and_indicators(data)

    ma5 = _to_float(latest_ind.get("ma5"))
    ma20 = _to_float(latest_ind.get("ma20"))
    ma60 = _to_float(latest_ind.get("ma60"))
    macd = _to_float(latest_ind.get("macd"))
    macd_signal = _to_float(latest_ind.get("macd_signal"))
    macd_hist = _to_float(latest_ind.get("macd_hist"))
    rsi14 = _to_float(latest_ind.get("rsi14"))
    k_value = _to_float(latest_ind.get("k_value"))
    d_value = _to_float(latest_ind.get("d_value"))

    ma_components: list[float] = []
    if latest_close is not None and ma20 is not None:
        ma_components.append(_sign(latest_close - ma20))
    if ma5 is not None and ma20 is not None:
        ma_components.append(_sign(ma5 - ma20))
    if ma20 is not None and ma60 is not None:
        ma_components.append(_sign(ma20 - ma60))
    ma_score = mean(ma_components) if ma_components else 0.0

    macd_parts: list[float] = []
    if macd is not None and macd_signal is not None:
        macd_parts.append(_sign(macd - macd_signal) * 0.6)
    if macd_hist is not None:
        macd_parts.append(_sign(macd_hist) * 0.4)
    macd_score = sum(macd_parts) if macd_parts else 0.0

    rsi_score = 0.0
    if rsi14 is not None:
        rsi_score = _clamp((rsi14 - 50.0) / 25.0)

    kd_score = 0.0
    if k_value is not None and d_value is not None:
        kd_score = _clamp((k_value - d_value) / 20.0)

    score = _clamp(
        ma_score * _TECHNICAL_SUB_WEIGHTS["ma"]
        + macd_score * _TECHNICAL_SUB_WEIGHTS["macd"]
        + rsi_score * _TECHNICAL_SUB_WEIGHTS["rsi"]
        + kd_score * _TECHNICAL_SUB_WEIGHTS["kd"]
    )

    missing_parts = []
    if not ma_components:
        missing_parts.append("MA")
    if not macd_parts:
        missing_parts.append("MACD")
    if rsi14 is None:
        missing_parts.append("RSI")
    if k_value is None or d_value is None:
        missing_parts.append("KD")

    suffix = ""
    if missing_parts:
        suffix = f"（部分資料不足：{','.join(missing_parts)} 以 0 計）"
    return score, f"技術面綜合分數 {score:.4f}{suffix}"


def _score_institutional(data: DBData) -> tuple[float, str]:
    if not data.institutional:
        return 0.0, "籌碼面資料不足（缺少三大法人資料），本面向分數以 0 計。"

    recent_rows = data.institutional[-ANALYSIS_WINDOW_DAYS:]
    totals = [_to_float(row.get("total_net")) or 0.0 for row in recent_rows]
    sum_sign = _sign(sum(totals))
    latest_sign = _sign(totals[-1] if totals else 0.0)
    score = _clamp(sum_sign * 0.7 + latest_sign * 0.3)
    return (
        score,
        f"籌碼面以近 {len(recent_rows)} 筆合計方向與最新一日方向計分，分數 {score:.4f}。",
    )


def _count_keyword_hits(text: str, keywords: tuple[str, ...]) -> int:
    return sum(text.count(keyword) for keyword in keywords)


def _score_news(rag_summary: str, news: list[NormalizedNewsChunk] | None) -> tuple[float, str]:
    parts: list[str] = []
    if rag_summary:
        parts.append(rag_summary.lower())
    if news:
        for chunk in news:
            parts.append(f"{chunk.title} {chunk.content}".lower())
    corpus = " ".join(parts).strip()

    if not corpus:
        return 0.0, "新聞面資料不足（缺少 RAG/news 文本），本面向分數以 0 計。"

    pos_hits = _count_keyword_hits(corpus, _POSITIVE_KEYWORDS)
    neg_hits = _count_keyword_hits(corpus, _NEGATIVE_KEYWORDS)
    total_hits = pos_hits + neg_hits
    if total_hits == 0:
        return 0.0, "新聞面未命中正負關鍵字，分數以 0 計。"
    score = _clamp((pos_hits - neg_hits) / total_hits)
    return score, f"新聞面關鍵字命中（正:{pos_hits} / 負:{neg_hits}），分數 {score:.4f}。"


def _score_momentum(data: DBData) -> tuple[float, str]:
    valid_rows = [
        row
        for row in data.prices
        if _to_float(row.get("close")) is not None and _to_float(row.get("volume")) is not None
    ]
    if len(valid_rows) < 2:
        return 0.0, f"量價動能資料不足（近 {ANALYSIS_WINDOW_DAYS} 日價格/成交量不足），本面向分數以 0 計。"

    closes = [_to_float(row.get("close")) for row in valid_rows]
    volumes = [_to_float(row.get("volume")) for row in valid_rows]
    closes = [v for v in closes if v is not None]
    volumes = [v for v in volumes if v is not None]
    if len(closes) < 2 or len(volumes) < 2:
        return 0.0, "量價動能資料不足（價格或成交量缺失），本面向分數以 0 計。"

    latest_close = closes[-1]
    ref_idx = -(ANALYSIS_WINDOW_DAYS + 1) if len(closes) >= ANALYSIS_WINDOW_DAYS + 1 else 0
    base_close = closes[ref_idx]
    if base_close == 0:
        return 0.0, "量價動能資料不足（基準價格為 0），本面向分數以 0 計。"

    ret_window = (latest_close - base_close) / base_close
    return_score = _clamp(ret_window / 0.10)

    recent_vol = volumes[-ANALYSIS_WINDOW_DAYS:] if len(volumes) >= ANALYSIS_WINDOW_DAYS else volumes
    prev_vol = (
        volumes[-(ANALYSIS_WINDOW_DAYS * 2):-ANALYSIS_WINDOW_DAYS]
        if len(volumes) >= ANALYSIS_WINDOW_DAYS * 2
        else []
    )
    volume_score = 0.0
    has_volume_compare = bool(prev_vol and mean(prev_vol) > 0)
    if has_volume_compare:
        vol_ratio = mean(recent_vol) / mean(prev_vol)
        vol_amp = _clamp(vol_ratio - 1.0)
        volume_score = _sign(ret_window) * vol_amp

    score = _clamp(return_score * 0.7 + volume_score * 0.3)
    if has_volume_compare:
        message = (
            f"量價動能由近 {ANALYSIS_WINDOW_DAYS} 日報酬與成交量放大方向計分，分數 {score:.4f}。"
        )
    else:
        message = (
            f"量價動能由近 {ANALYSIS_WINDOW_DAYS} 日報酬計分（成交量對照不足），分數 {score:.4f}。"
        )
    return score, message


def compute_score_breakdown(
    data: DBData,
    rag_summary: str,
    news: list[NormalizedNewsChunk] | None,
) -> ScoreBreakdown:
    technical_score, technical_explanation = _score_technical(data)
    institutional_score, institutional_explanation = _score_institutional(data)
    news_score, news_explanation = _score_news(rag_summary, news)
    momentum_score, momentum_explanation = _score_momentum(data)

    weighted_score = _clamp(
        technical_score * WEIGHTS.technical
        + institutional_score * WEIGHTS.institutional
        + news_score * WEIGHTS.news
        + momentum_score * WEIGHTS.momentum
    )

    return ScoreBreakdown(
        technical_score=round(technical_score, 4),
        institutional_score=round(institutional_score, 4),
        news_score=round(news_score, 4),
        momentum_score=round(momentum_score, 4),
        weighted_score=round(weighted_score, 4),
        weights=WEIGHTS,
        explanations=ScoreExplanations(
            technical=technical_explanation,
            institutional=institutional_explanation,
            news=news_explanation,
            momentum=momentum_explanation,
        ),
    )


def recommendation_from_weighted_score(weighted_score: float) -> str:
    if weighted_score >= 0.25:
        return f"偏多（加權分數 {weighted_score:.2f}，高於 0.25 門檻）"
    if weighted_score <= -0.25:
        return f"偏空（加權分數 {weighted_score:.2f}，低於 -0.25 門檻）"
    return f"中性觀望（加權分數 {weighted_score:.2f}，介於 -0.25～0.25）"


def build_recommendation_basis(score_breakdown: ScoreBreakdown) -> list[str]:
    return [
        f"技術面：{score_breakdown.explanations.technical}",
        f"籌碼面：{score_breakdown.explanations.institutional}",
        f"新聞面：{score_breakdown.explanations.news}",
        f"量價動能：{score_breakdown.explanations.momentum}",
    ]
