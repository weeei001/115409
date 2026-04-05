"""Pattern detector — scans historical indicators for technical patterns using Python, not LLM."""

from __future__ import annotations

from typing import Optional


def _safe_float(val) -> Optional[float]:
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None


def detect_kd_golden_cross(indicators: list[dict]) -> list[dict]:
    """KD 金叉：前日 K < D 且當日 K >= D"""
    results = []
    for i in range(1, len(indicators)):
        prev_k = _safe_float(indicators[i - 1].get("k_value"))
        prev_d = _safe_float(indicators[i - 1].get("d_value"))
        curr_k = _safe_float(indicators[i].get("k_value"))
        curr_d = _safe_float(indicators[i].get("d_value"))
        if None in (prev_k, prev_d, curr_k, curr_d):
            continue
        if prev_k < prev_d and curr_k >= curr_d:
            low = curr_k < 30
            results.append({
                "date": indicators[i]["date"],
                "pattern": "KD 低檔金叉" if low else "KD 金叉",
                "k": curr_k,
                "d": curr_d,
            })
    return results


def detect_kd_death_cross(indicators: list[dict]) -> list[dict]:
    """KD 死叉：前日 K > D 且當日 K <= D"""
    results = []
    for i in range(1, len(indicators)):
        prev_k = _safe_float(indicators[i - 1].get("k_value"))
        prev_d = _safe_float(indicators[i - 1].get("d_value"))
        curr_k = _safe_float(indicators[i].get("k_value"))
        curr_d = _safe_float(indicators[i].get("d_value"))
        if None in (prev_k, prev_d, curr_k, curr_d):
            continue
        if prev_k > prev_d and curr_k <= curr_d:
            high = curr_k > 70
            results.append({
                "date": indicators[i]["date"],
                "pattern": "KD 高檔死叉" if high else "KD 死叉",
                "k": curr_k,
                "d": curr_d,
            })
    return results


def detect_macd_cross_positive(indicators: list[dict]) -> list[dict]:
    """MACD 柱狀體由負轉正（多方訊號）"""
    results = []
    for i in range(1, len(indicators)):
        prev_h = _safe_float(indicators[i - 1].get("macd_hist"))
        curr_h = _safe_float(indicators[i].get("macd_hist"))
        if prev_h is None or curr_h is None:
            continue
        if prev_h < 0 and curr_h >= 0:
            results.append({
                "date": indicators[i]["date"],
                "pattern": "MACD 柱狀體翻正",
                "macd_hist": curr_h,
            })
    return results


def detect_macd_cross_negative(indicators: list[dict]) -> list[dict]:
    """MACD 柱狀體由正轉負（空方訊號）"""
    results = []
    for i in range(1, len(indicators)):
        prev_h = _safe_float(indicators[i - 1].get("macd_hist"))
        curr_h = _safe_float(indicators[i].get("macd_hist"))
        if prev_h is None or curr_h is None:
            continue
        if prev_h > 0 and curr_h <= 0:
            results.append({
                "date": indicators[i]["date"],
                "pattern": "MACD 柱狀體翻負",
                "macd_hist": curr_h,
            })
    return results


def detect_price_cross_ma(prices: list[dict], indicators: list[dict], ma_key: str = "ma20") -> list[dict]:
    """股價突破/跌破均線"""
    ind_map = {ind["date"]: ind for ind in indicators}
    results = []
    for i in range(1, len(prices)):
        prev_close = _safe_float(prices[i - 1].get("close"))
        curr_close = _safe_float(prices[i].get("close"))
        prev_ind = ind_map.get(prices[i - 1]["date"], {})
        curr_ind = ind_map.get(prices[i]["date"], {})
        prev_ma = _safe_float(prev_ind.get(ma_key))
        curr_ma = _safe_float(curr_ind.get(ma_key))
        if None in (prev_close, curr_close, prev_ma, curr_ma):
            continue

        ma_label = ma_key.upper().replace("MA", "") + "日均線"
        if prev_close < prev_ma and curr_close >= curr_ma:
            results.append({
                "date": prices[i]["date"],
                "pattern": f"股價突破{ma_label}",
                "close": curr_close,
                "ma": curr_ma,
            })
        elif prev_close > prev_ma and curr_close <= curr_ma:
            results.append({
                "date": prices[i]["date"],
                "pattern": f"股價跌破{ma_label}",
                "close": curr_close,
                "ma": curr_ma,
            })
    return results


def detect_rsi_extremes(indicators: list[dict]) -> list[dict]:
    """RSI 進入超買(>70)或超賣(<30)區間"""
    results = []
    for i in range(1, len(indicators)):
        prev_rsi = _safe_float(indicators[i - 1].get("rsi14"))
        curr_rsi = _safe_float(indicators[i].get("rsi14"))
        if prev_rsi is None or curr_rsi is None:
            continue
        if prev_rsi <= 70 and curr_rsi > 70:
            results.append({
                "date": indicators[i]["date"],
                "pattern": "RSI 進入超買區",
                "rsi14": curr_rsi,
            })
        elif prev_rsi >= 30 and curr_rsi < 30:
            results.append({
                "date": indicators[i]["date"],
                "pattern": "RSI 進入超賣區",
                "rsi14": curr_rsi,
            })
    return results


def detect_all_patterns(prices: list[dict], indicators: list[dict]) -> list[dict]:
    """Run all pattern detectors and return a merged, date-sorted list."""
    all_hits: list[dict] = []
    all_hits.extend(detect_kd_golden_cross(indicators))
    all_hits.extend(detect_kd_death_cross(indicators))
    all_hits.extend(detect_macd_cross_positive(indicators))
    all_hits.extend(detect_macd_cross_negative(indicators))
    all_hits.extend(detect_price_cross_ma(prices, indicators, "ma5"))
    all_hits.extend(detect_price_cross_ma(prices, indicators, "ma10"))
    all_hits.extend(detect_price_cross_ma(prices, indicators, "ma20"))
    all_hits.extend(detect_price_cross_ma(prices, indicators, "ma60"))
    all_hits.extend(detect_rsi_extremes(indicators))
    all_hits.sort(key=lambda x: x.get("date", ""))
    return all_hits
