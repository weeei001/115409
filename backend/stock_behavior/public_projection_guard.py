from __future__ import annotations

import re
from typing import Any


FIELD_LABELS = {
    "close": "收盤價",
    "volume_shares": "成交量",
    "volume_ma5": "五日均量",
    "volume_ma20": "二十日均量",
    "foreign_net": "外資買賣超",
    "foreign_net_10d_sum": "外資近十日累計買賣超",
    "trust_net": "投信買賣超",
    "dealer_net": "自營商買賣超",
    "rsi_5": "五日 RSI",
    "kd_k": "KD 指標 K 值",
    "macd_diff": "MACD 差值",
    "macd_histogram": "MACD 柱狀體",
    "ma20": "二十日均線",
    "ma60": "六十日均線",
    "boll_mid20": "布林通道中線",
    "boll_upper20": "布林通道上緣",
    "boll_lower20": "布林通道下緣",
}

FORBIDDEN_REASON_PATTERNS = [
    "price_volume",
    "technical",
    "chip",
    "news",
    "foreign_net",
    "trust_net",
    "dealer_net",
    "volume_ma5",
    "macd_histogram",
    "boll_mid20",
    "evidence_ids",
    "pv_01",
    "tc_01",
    "ch_01",
    "nw_01",
]

UNSUPPORTED_TREND_TERMS = [
    "開始上升",
    "開始下降",
    "近期下降",
    "量能回升",
    "單日回升",
    "轉正",
    "連續下降",
    "回流",
    "被突破",
    "趨勢轉強",
    "趨勢轉弱",
]

CAUSE_WORDS = ["因為", "所以", "代表", "使得", "因此", "反映", "意味著", "顯示"]
MARKET_WORDS = [
    "買盤",
    "賣壓",
    "追價意願",
    "承接力",
    "觀望",
    "壓力區",
    "支撐區",
    "資金態度",
    "籌碼拉扯",
    "量能確認",
    "量能不足",
]
PROJECTION_TERMS = ["價格推演", "量能推演", "推演在", "推演為", "將價格", "將量能"]

MISSING_TREND_LIMITATION = "因缺少外資近 10 日累計與二十日均量，中期資金趨勢與量能趨勢判斷可信度有限。"
DEFAULT_PUBLIC_REASON = (
    "因為目前可用資料不足，無法判斷買盤、賣壓或量能確認是否延續，所以本節點採保守情境推演。"
)


def _index_inventory(data_inventory: dict[str, Any]) -> dict[str, dict[str, Any]]:
    indexed: dict[str, dict[str, Any]] = {}
    for bucket in ("price_volume", "chip", "technical", "news"):
        items = data_inventory.get(bucket)
        if not isinstance(items, list):
            continue
        for item in items:
            if isinstance(item, dict) and isinstance(item.get("field"), str):
                indexed[item["field"]] = item
    return indexed


def _existing_item(indexed: dict[str, dict[str, Any]], field: str) -> dict[str, Any] | None:
    item = indexed.get(field)
    if not item or item.get("value") is None or item.get("value") == "":
        return None
    return item


def _value(indexed: dict[str, dict[str, Any]], field: str) -> Any:
    item = _existing_item(indexed, field)
    return item.get("value") if item else None


def _evidence_ids(indexed: dict[str, dict[str, Any]], fields: list[str]) -> list[str]:
    ids: list[str] = []
    for field in fields:
        item = _existing_item(indexed, field)
        evidence_id = item.get("id") if item else None
        if isinstance(evidence_id, str) and evidence_id not in ids:
            ids.append(evidence_id)
    return ids


def _to_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _format_number(value: Any, *, decimals: int = 4) -> str:
    number = _to_float(value)
    if number is None:
        return str(value)
    if number.is_integer():
        return str(int(number))
    text = f"{number:.{decimals}f}".rstrip("0").rstrip(".")
    return text


def _format_price(value: Any, *, decimals: int = 2) -> str:
    number = _to_float(value)
    if number is None:
        return str(value)
    if number.is_integer():
        return f"{number:.1f}"
    return f"{number:.{decimals}f}".rstrip("0").rstrip(".")


def _format_shares(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return str(value)
    return f"{abs(int(round(number))):,} 股"


def _format_volume_for_reason(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return str(value)
    return str(int(round(number)))


def _chip_sentence(field: str, value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    actor = {
        "foreign_net": "外資",
        "trust_net": "投信",
        "dealer_net": "自營商",
    }[field]
    if number < 0:
        return f"{actor}單日賣超 {_format_shares(number)}"
    if number > 0:
        return f"{actor}單日買超 {_format_shares(number)}"
    return f"{actor}單日買賣超為 0 股"


def _rsi_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    if number < 40:
        state = "短線動能偏弱"
    elif number > 60:
        state = "短線動能偏強"
    else:
        state = "短線動能中性"
    return f"五日 RSI 為 {_format_number(number, decimals=2)}，{state}"


def _kd_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    if number < 30:
        state = "位置偏低"
    elif number > 70:
        state = "位置偏高"
    else:
        state = "位置中性"
    return f"KD 指標 K 值為 {_format_number(number, decimals=2)}，{state}"


def _macd_diff_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"MACD 差值為 {_format_number(number)}，僅代表當日差值狀態"


def _macd_histogram_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    if number < 0:
        state = "仍為負值"
    elif number > 0:
        state = "為正值"
    else:
        state = "接近零軸"
    return f"MACD 柱狀體為 {_format_number(number)}，{state}"


def _close_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"收盤價為 {_format_price(number)}"


def _volume_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"成交量為 {_format_shares(number)}"


def _volume_ma5_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"五日均量約 {_format_shares(number)}，僅能反映近期平均成交水準"


def _volume_ma20_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"二十日均量約 {_format_shares(number)}，可作為中期平均成交水準參考"


def _foreign_net_10d_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    if number < 0:
        return f"外資近十日累計賣超 {_format_shares(number)}"
    if number > 0:
        return f"外資近十日累計買超 {_format_shares(number)}"
    return "外資近十日累計買賣超為 0 股"


def _close_vs_line_sentence(close: Any, line_value: Any, line_label: str) -> str:
    close_number = _to_float(close)
    line_number = _to_float(line_value)
    if close_number is None or line_number is None:
        return ""
    if close_number < line_number:
        relation = f"略低於{line_label}"
    elif close_number > line_number:
        relation = f"高於{line_label}"
    else:
        relation = f"貼近{line_label}"
    return (
        f"收盤價為 {_format_price(close_number)}，"
        f"{line_label}為 {_format_price(line_number)}，收盤價{relation}"
    )


def _boll_upper_sentence(value: Any) -> str:
    number = _to_float(value)
    if number is None:
        return ""
    return f"布林通道上緣為 {_format_price(number)}，屬於上方可能壓力區"


def _has_reference_only_news(data_inventory: dict[str, Any]) -> bool:
    news_items = data_inventory.get("news")
    if not isinstance(news_items, list):
        return False
    return any(isinstance(item, dict) and item.get("reference_only") is True for item in news_items)


def _reference_only_news_ids(data_inventory: dict[str, Any]) -> set[str]:
    news_items = data_inventory.get("news")
    if not isinstance(news_items, list):
        return set()
    return {
        str(item.get("id"))
        for item in news_items
        if isinstance(item, dict) and item.get("reference_only") is True and item.get("id")
    }


def _has_missing_trend_fields(data_inventory: dict[str, Any]) -> bool:
    missing = data_inventory.get("missing_fields")
    if not isinstance(missing, list):
        return False
    missing_text = " ".join(str(item) for item in missing)
    return "foreign_net 近 10 日累計" in missing_text and "volume_ma20" in missing_text


def _has_projection_link(reason: str) -> bool:
    return any(term in reason for term in PROJECTION_TERMS)


def is_low_quality_projection_point(point: dict[str, Any]) -> bool:
    reason = str(point.get("reason") or "")

    if not reason:
        return True

    if not any(word in reason for word in CAUSE_WORDS):
        return True

    if not any(word in reason for word in MARKET_WORDS):
        return True

    if not _has_projection_link(reason):
        return True

    return False


def public_projection_disclaimer(base_disclaimer: str, data_inventory: dict[str, Any]) -> str:
    disclaimer = base_disclaimer.strip() or "以下為 AI 情境推演，非統計預測或報酬率承諾，不構成任何投資建議。"
    if _has_missing_trend_fields(data_inventory) and MISSING_TREND_LIMITATION not in disclaimer:
        disclaimer = f"{disclaimer} {MISSING_TREND_LIMITATION}"
    return disclaimer


def _score(indexed: dict[str, dict[str, Any]], fields: list[str]) -> float:
    score = 0.0
    for field in fields:
        value = _to_float(_value(indexed, field))
        if value is None:
            continue
        if field in {"foreign_net", "trust_net"}:
            score += 1.0 if value > 0 else -1.0 if value < 0 else 0.0
        elif field == "foreign_net_10d_sum":
            score += 1.0 if value > 0 else -1.0 if value < 0 else 0.0
        elif field == "dealer_net":
            score += 0.5 if value > 0 else -0.5 if value < 0 else 0.0
        elif field == "rsi_5":
            score += 1.0 if value > 60 else -1.0 if value < 40 else 0.0
        elif field == "kd_k":
            score += -0.5 if value < 30 else 0.5 if value > 70 else 0.0
        elif field == "macd_histogram":
            score += 1.0 if value > 0 else -1.0 if value < 0 else 0.0
    for field in ("ma20", "boll_mid20"):
        if field in fields:
            close = _to_float(_value(indexed, "close"))
            line_value = _to_float(_value(indexed, field))
        else:
            close = None
            line_value = None
        if close is not None and line_value is not None:
            score += 0.5 if close > line_value else -0.5 if close < line_value else 0.0
    return score


def _direction_from_score(original_direction: Any, score: float) -> str:
    original = str(original_direction or "uncertain").lower()
    if score <= -1.0:
        return "down"
    if score >= 1.5:
        return "up"
    if original not in {"up", "down", "neutral", "uncertain"}:
        return "uncertain"
    if original == "up" and score < 1.0:
        return "neutral"
    if original == "down" and score > -1.0:
        return "neutral"
    return original


def _market_meaning(score: float, direction: Any) -> str:
    normalized_direction = str(direction or "").lower()
    if score <= -1.0 or normalized_direction == "down":
        return "賣壓仍在、追價意願不足"
    if score >= 1.5 or normalized_direction == "up":
        return "買盤仍有承接、資金態度未明顯撤退"
    return "買盤與賣壓呈現籌碼拉扯，市場觀望氣氛較重"


def _direction_scene(direction: Any) -> str:
    normalized_direction = str(direction or "").lower()
    if normalized_direction == "up":
        return "偏強或反彈"
    if normalized_direction == "down":
        return "震盪偏弱"
    return "整理觀望"


def _reason_for_day(
    day: int,
    indexed: dict[str, dict[str, Any]],
    data_inventory: dict[str, Any],
    point: dict[str, Any],
) -> tuple[str, list[str], float]:
    sentences: list[str] = []
    fields: list[str] = []

    def add(sentence: str, *sentence_fields: str) -> None:
        if sentence:
            sentences.append(sentence)
            fields.extend(sentence_fields)

    close = _value(indexed, "close")
    if day == 5:
        add(_close_sentence(close), "close")
        add(_rsi_sentence(_value(indexed, "rsi_5")), "rsi_5")
    elif day == 10:
        add(_kd_sentence(_value(indexed, "kd_k")), "kd_k")
        add(_rsi_sentence(_value(indexed, "rsi_5")), "rsi_5")
        add(_chip_sentence("foreign_net", _value(indexed, "foreign_net")), "foreign_net")
    elif day == 15:
        add(_chip_sentence("foreign_net", _value(indexed, "foreign_net")), "foreign_net")
        add(_chip_sentence("trust_net", _value(indexed, "trust_net")), "trust_net")
        add(_macd_diff_sentence(_value(indexed, "macd_diff")), "macd_diff")
    elif day == 20:
        add(_volume_ma5_sentence(_value(indexed, "volume_ma5")), "volume_ma5")
        add(_volume_ma20_sentence(_value(indexed, "volume_ma20")), "volume_ma20")
        add(_macd_histogram_sentence(_value(indexed, "macd_histogram")), "macd_histogram")
    elif day == 25:
        add(_close_vs_line_sentence(close, _value(indexed, "ma20"), "二十日均線"), "close", "ma20")
        add(_chip_sentence("dealer_net", _value(indexed, "dealer_net")), "dealer_net")
    elif day == 30:
        add(_chip_sentence("foreign_net", _value(indexed, "foreign_net")), "foreign_net")
        add(_foreign_net_10d_sentence(_value(indexed, "foreign_net_10d_sum")), "foreign_net_10d_sum")
        add(_chip_sentence("trust_net", _value(indexed, "trust_net")), "trust_net")
        add(_volume_sentence(_value(indexed, "volume_shares")), "volume_shares")
    elif day == 35:
        add(_close_vs_line_sentence(close, _value(indexed, "boll_mid20"), "布林通道中線"), "close", "boll_mid20")
        add(_macd_histogram_sentence(_value(indexed, "macd_histogram")), "macd_histogram")
    elif day == 40:
        add(_boll_upper_sentence(_value(indexed, "boll_upper20")), "boll_upper20")
        add(_chip_sentence("trust_net", _value(indexed, "trust_net")), "trust_net")
        add(_close_vs_line_sentence(close, _value(indexed, "ma20"), "二十日均線"), "close", "ma20")

    if not sentences:
        add(_close_sentence(close), "close")
        add(_volume_sentence(_value(indexed, "volume_shares")), "volume_shares")

    if _has_reference_only_news(data_inventory) and day == 35:
        sentences.append("舊新聞僅作背景參考，不作為本次預測主要依據")

    evidence_text = "；".join(sentences) if sentences else "目前可用資料不足"
    score = _score(indexed, fields)
    direction = _direction_from_score(point.get("direction"), score)
    market_meaning = _market_meaning(score, direction)
    predicted_close = (
        _format_price(point.get("predicted_close"))
        if point.get("predicted_close") is not None
        else "保守區間"
    )
    predicted_volume = (
        _format_volume_for_reason(point.get("predicted_volume"))
        if point.get("predicted_volume") is not None
        else "保守量能"
    )
    reason = (
        f"因為{evidence_text}，顯示{market_meaning}，所以本節點將價格推演為"
        f"{predicted_close}附近、量能推演為{predicted_volume}附近，代表短線較可能偏向"
        f"{_direction_scene(direction)}。"
    )
    if reason and not reason.endswith("。"):
        reason = f"{reason}。"
    return reason, _evidence_ids(indexed, fields), score


def _contains_forbidden_reason_text(reason: str) -> bool:
    lower_reason = reason.lower()
    if any(pattern.lower() in lower_reason for pattern in FORBIDDEN_REASON_PATTERNS):
        return True
    return any(term in reason for term in UNSUPPORTED_TREND_TERMS)


def _ensure_line_pair_evidence(reason: str, indexed: dict[str, dict[str, Any]], evidence_ids: list[str]) -> list[str]:
    required_fields: list[str] = []
    if "低於二十日均線" in reason:
        required_fields.extend(["close", "ma20"])
    if "低於布林通道中線" in reason:
        required_fields.extend(["close", "boll_mid20"])
    for evidence_id in _evidence_ids(indexed, required_fields):
        if evidence_id not in evidence_ids:
            evidence_ids.append(evidence_id)
    return evidence_ids


def sanitize_public_projection_point(
    point: dict[str, Any],
    *,
    data_inventory: dict[str, Any],
) -> dict[str, Any]:
    indexed = _index_inventory(data_inventory)
    day = int(point.get("day") or 0)
    generated_reason, generated_evidence_ids, score = _reason_for_day(
        day,
        indexed,
        data_inventory,
        point,
    )
    candidate_point = {
        **point,
        "reason": str(point.get("reason") or ""),
    }
    if (
        _contains_forbidden_reason_text(candidate_point["reason"])
        or is_low_quality_projection_point(candidate_point)
    ):
        reason = generated_reason
        evidence_ids = generated_evidence_ids
    else:
        reason = candidate_point["reason"]
        evidence_ids = list(point.get("evidence_ids", []))

    if _contains_forbidden_reason_text(reason):
        reason = re.sub(r"\s+", " ", DEFAULT_PUBLIC_REASON).strip()
        evidence_ids = []
    evidence_ids = _ensure_line_pair_evidence(reason, indexed, evidence_ids)
    reference_only_ids = _reference_only_news_ids(data_inventory)
    evidence_ids = [evidence_id for evidence_id in evidence_ids if evidence_id not in reference_only_ids]
    return {
        **point,
        "direction": _direction_from_score(point.get("direction"), score),
        "reason": reason,
        "evidence_ids": evidence_ids,
    }
