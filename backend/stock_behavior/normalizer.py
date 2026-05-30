from __future__ import annotations

from typing import Any

from schemas.stock_behavior import SCENARIO_PROJECTION_DAYS


TREND_STATES = {
    "bullish",
    "mildly_bullish",
    "neutral",
    "mildly_bearish",
    "bearish",
    "uncertain",
}
CONFIDENCE_LEVELS = {"low", "medium", "high"}
RISK_LEVELS = {"low", "medium", "high"}
RAG_SENTIMENTS = {"bullish", "neutral", "bearish", "mixed", "unknown"}
PROJECTION_DIRECTIONS = {"up", "down", "neutral", "uncertain"}
DEFAULT_LINE_DISCLAIMER = "此趨勢線為 AI 情境推演，非統計預測，不構成投資建議。"
FALLBACK_LIMITATION = "LLM 結構化輸出失敗，請視為占位結果。"
FALLBACK_SUMMARY = "此為 fallback 結果，代表 LLM 結構化輸出失敗，非有效分析結果。"


def _text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _list_of_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [_text(item) for item in value if _text(item)]
    text = _text(value)
    return [text] if text else []


def _optional_float(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        parsed = float(value)
        return parsed if parsed >= 0 else None
    if isinstance(value, str):
        normalized = value.strip().lower().replace(",", "")
        if not normalized or normalized in {"unknown", "n/a", "na", "none", "null", "-"}:
            return None
        try:
            parsed = float(normalized)
        except ValueError:
            return None
        return parsed if parsed >= 0 else None
    return None


def _normalize_enum(value: Any, allowed: set[str], default: str) -> str:
    normalized = _text(value).lower()
    return normalized if normalized in allowed else default


def _coerce_int(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _normalize_direction(value: Any) -> str:
    normalized = _text(value).lower()
    if normalized in {"sideways", "flat", "hold"}:
        return "neutral"
    return normalized if normalized in PROJECTION_DIRECTIONS else "uncertain"


def _projection_points_candidates(raw: dict[str, Any]) -> list[Any]:
    projection = raw.get("projection")
    if isinstance(projection, dict):
        for key in ("points", "projection_points", "base_line", "base"):
            candidate = projection.get(key)
            if isinstance(candidate, list):
                return candidate

    trend_line = raw.get("llm_scenario_trend_line")
    if isinstance(trend_line, dict):
        for key in ("base_line", "base"):
            candidate = trend_line.get(key)
            if isinstance(candidate, list):
                return candidate

    scenario_projections = raw.get("scenario_projections")
    if isinstance(scenario_projections, dict):
        scenarios = scenario_projections.get("scenarios")
        if isinstance(scenarios, list):
            for scenario in scenarios:
                if not isinstance(scenario, dict):
                    continue
                candidate = scenario.get("projection_points")
                if isinstance(candidate, list):
                    return candidate

    return []


def normalize_trend_assessment(raw: dict[str, Any]) -> dict[str, Any]:
    trend = raw.get("current_trend_assessment")
    if not isinstance(trend, dict):
        trend = {}
    return {
        "state": _normalize_enum(trend.get("state"), TREND_STATES, "uncertain"),
        "confidence_level": _normalize_enum(
            trend.get("confidence_level") or trend.get("confidence"),
            CONFIDENCE_LEVELS,
            "low",
        ),
        "summary": _text(trend.get("summary")),
    }


def normalize_projection_points(points: Any, *, fallback_reason: str) -> list[dict[str, Any]]:
    source = points if isinstance(points, list) else []
    by_day: dict[int, dict[str, Any]] = {}

    for item in source:
        if not isinstance(item, dict):
            continue
        day = _coerce_int(item.get("day"))
        if day is None or day not in SCENARIO_PROJECTION_DAYS:
            continue
        by_day[day] = item

    normalized_points: list[dict[str, Any]] = []
    for day in SCENARIO_PROJECTION_DAYS:
        item = by_day.get(day, {})
        reason = _text(item.get("reason") or item.get("description")) or fallback_reason
        normalized_points.append(
            {
                "day": day,
                "relative_price": _optional_float(item.get("relative_price")) or 1.0,
                "predicted_close": _optional_float(
                    item.get("predicted_close") or item.get("price") or item.get("close")
                ),
                "predicted_volume": _optional_float(
                    item.get("predicted_volume") or item.get("volume") or item.get("volume_shares")
                ),
                "direction": _normalize_direction(item.get("direction")),
                "reason": reason,
                "evidence_ids": _list_of_text(item.get("evidence_ids")),
            }
        )

    return normalized_points


def normalize_projection(raw: dict[str, Any], *, horizon_days: int) -> dict[str, Any]:
    projection = raw.get("projection")
    if not isinstance(projection, dict):
        projection = {}

    scenario_projections = raw.get("scenario_projections")
    primary_scenario: dict[str, Any] = {}
    summary_for_user = ""
    if isinstance(scenario_projections, dict):
        summary_for_user = _text(scenario_projections.get("summary_for_user"))
        scenarios = scenario_projections.get("scenarios")
        if isinstance(scenarios, list):
            for scenario in scenarios:
                if not isinstance(scenario, dict):
                    continue
                key = _text(scenario.get("scenario_key") or scenario.get("scenario_role")).lower()
                if key == "primary" or not primary_scenario:
                    primary_scenario = scenario
                    if key == "primary":
                        break

    trend_line = raw.get("llm_scenario_trend_line")
    trend_line_disclaimer = ""
    if isinstance(trend_line, dict):
        trend_line_disclaimer = _text(trend_line.get("line_disclaimer"))

    fallback_reason = "資料不足，系統已補齊保守情境點。"
    return {
        "horizon_days": _coerce_int(projection.get("horizon_days")) or horizon_days,
        "scenario_key": _text(projection.get("scenario_key")) or _text(primary_scenario.get("scenario_key")) or "primary",
        "scenario_name": _text(projection.get("scenario_name")) or _text(primary_scenario.get("scenario_name")) or "主情境",
        "user_interpretation": _text(projection.get("user_interpretation"))
        or _text(primary_scenario.get("user_interpretation")),
        "summary_for_user": _text(projection.get("summary_for_user")) or summary_for_user,
        "trigger_conditions": _list_of_text(projection.get("trigger_conditions"))
        or _list_of_text(primary_scenario.get("trigger_conditions")),
        "invalidation_conditions": _list_of_text(projection.get("invalidation_conditions"))
        or _list_of_text(primary_scenario.get("invalidation_conditions")),
        "points": normalize_projection_points(
            projection.get("points")
            if isinstance(projection.get("points"), list)
            else _projection_points_candidates(raw),
            fallback_reason=fallback_reason,
        ),
        "line_disclaimer": _text(projection.get("line_disclaimer")) or trend_line_disclaimer or DEFAULT_LINE_DISCLAIMER,
    }


def normalize_risk_level(value: Any) -> str:
    return _normalize_enum(value, RISK_LEVELS, "medium")


def normalize_risk_analysis(raw: dict[str, Any]) -> list[dict[str, Any]]:
    risk_analysis = raw.get("risk_analysis")
    if isinstance(risk_analysis, dict):
        items = risk_analysis.get("major_risks")
    else:
        items = risk_analysis

    if not isinstance(items, list):
        return []

    normalized_items: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        normalized_items.append(
            {
                "risk_type": _text(item.get("risk_type")),
                "description": _text(item.get("description")),
                "watch_condition": _text(item.get("watch_condition")),
            }
        )
    return normalized_items


def normalize_rag_reference_analysis(raw: dict[str, Any]) -> dict[str, Any]:
    rag = raw.get("rag_reference_analysis")
    if not isinstance(rag, dict):
        rag = {}
    notes = rag.get("notes")
    return {
        "raw_answer_used_as": "reference_only",
        "rag_sentiment": _normalize_enum(rag.get("rag_sentiment"), RAG_SENTIMENTS, "unknown"),
        "rag_summary": _text(rag.get("rag_summary")),
        "news_sources_count": _coerce_int(rag.get("news_sources_count")) or 0,
        "is_confirmed_by_price_volume": bool(rag.get("is_confirmed_by_price_volume", False)),
        "is_confirmed_by_chip": bool(rag.get("is_confirmed_by_chip", False)),
        "is_confirmed_by_technical": bool(rag.get("is_confirmed_by_technical", False)),
        "conflicts": _list_of_text(rag.get("conflicts")),
        "notes": _list_of_text(notes),
    }


def _normalize_evidence_items(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []

    items: list[dict[str, Any]] = []
    for item in value:
        if isinstance(item, dict):
            items.append(
                {
                    "field": _text(item.get("field")),
                    "date": _text(item.get("date") or item.get("date_range")),
                    "value": item.get("value"),
                    "usage": _text(item.get("usage")),
                }
            )
            continue
        text = _text(item)
        if text:
            items.append({"field": text, "date": "", "value": None, "usage": ""})
    return items


def normalize_evidence_used(raw: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    evidence_used = raw.get("evidence_used")
    if isinstance(evidence_used, list):
        return {
            "price_volume": [],
            "chip": [],
            "technical": [],
            "news": [],
        }

    evidence_used = evidence_used if isinstance(evidence_used, dict) else {}
    return {
        "price_volume": _normalize_evidence_items(evidence_used.get("price_volume")),
        "chip": _normalize_evidence_items(evidence_used.get("chip")),
        "technical": _normalize_evidence_items(evidence_used.get("technical")),
        "news": _normalize_evidence_items(evidence_used.get("news")),
    }


def build_stock_behavior_analysis_fallback(reason: str, *, horizon_days: int = 40) -> dict[str, Any]:
    fallback_reason = _text(reason) or "LLM 結構化輸出失敗。"
    return {
        "data_gap": [fallback_reason],
        "observations": [],
        "inferences": [],
        "summary": FALLBACK_SUMMARY,
        "current_trend_assessment": {
            "state": "uncertain",
            "confidence_level": "low",
            "summary": "",
        },
        "projection": {
            "horizon_days": horizon_days,
            "scenario_key": "primary",
            "scenario_name": "主情境",
            "user_interpretation": "目前僅提供 fallback 占位情境，非有效分析結果。",
            "summary_for_user": "目前僅提供 fallback 占位情境，非有效分析結果。",
            "trigger_conditions": [],
            "invalidation_conditions": [],
            "points": [
                {
                    "day": day,
                    "relative_price": 1.0,
                    "predicted_close": None,
                    "predicted_volume": None,
                    "direction": "uncertain",
                    "reason": fallback_reason,
                    "evidence_ids": [],
                }
                for day in SCENARIO_PROJECTION_DAYS
            ],
            "line_disclaimer": DEFAULT_LINE_DISCLAIMER,
        },
        "risk_level": "high",
        "risk_analysis": [],
        "rag_reference_analysis": {
            "raw_answer_used_as": "reference_only",
            "rag_sentiment": "unknown",
            "rag_summary": "",
            "news_sources_count": 0,
            "is_confirmed_by_price_volume": False,
            "is_confirmed_by_chip": False,
            "is_confirmed_by_technical": False,
            "conflicts": [],
            "notes": [],
        },
        "evidence_used": {
            "price_volume": [],
            "chip": [],
            "technical": [],
            "news": [],
        },
        "limitations": [FALLBACK_LIMITATION],
    }


def normalize_llm_analysis_payload(raw: dict[str, Any], *, horizon_days: int = 40) -> dict[str, Any]:
    if not isinstance(raw, dict):
        return build_stock_behavior_analysis_fallback("LLM 未回傳可解析的物件。", horizon_days=horizon_days)
    if not raw:
        return build_stock_behavior_analysis_fallback("LLM 未回傳可解析的結構化內容。", horizon_days=horizon_days)

    normalized = {
        "data_gap": _list_of_text(raw.get("data_gap")),
        "observations": _list_of_text(raw.get("observations")),
        "inferences": _list_of_text(raw.get("inferences")),
        "summary": _text(raw.get("summary")),
        "current_trend_assessment": normalize_trend_assessment(raw),
        "projection": normalize_projection(raw, horizon_days=horizon_days),
        "risk_level": normalize_risk_level(raw.get("risk_level")),
        "risk_analysis": normalize_risk_analysis(raw),
        "rag_reference_analysis": normalize_rag_reference_analysis(raw),
        "evidence_used": normalize_evidence_used(raw),
        "limitations": _list_of_text(raw.get("limitations")),
    }

    if not normalized["limitations"] and normalized["data_gap"]:
        normalized["limitations"] = list(normalized["data_gap"])

    return normalized
