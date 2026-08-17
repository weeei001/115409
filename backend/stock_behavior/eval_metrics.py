from __future__ import annotations

import re
from collections import Counter, defaultdict
from math import ceil, floor
from statistics import fmean
from typing import Any


PERCENT_IN_TEXT_RE = re.compile(r"\d+(?:\.\d+)?\s*%")

FORWARD_HORIZONS = ("short_1_5", "swing_6_20", "medium_21_40")

# 立場強度：量「這段建議敢不敢下判斷」。0 代表沒給方向。
STANCE_STRENGTH = {
    "bearish": 2.0,
    "mildly_bearish": 1.0,
    "neutral": 0.0,
    "mixed": 0.0,
    "uncertain": 0.0,
    "mildly_bullish": 1.0,
    "bullish": 2.0,
}
DIRECTIONLESS_STANCES = frozenset({"neutral", "mixed", "uncertain"})


def forward_views_map(forward_views: Any) -> dict[str, dict[str, Any]]:
    """把 forward_views 正規化成 {horizon: view}。

    v3 的 shadow 端點輸出 list（每項帶 horizon 欄位），v4 之後改成 dict。
    兩種都要吃，否則跨版本比對會斷在舊報告上。
    """
    if isinstance(forward_views, dict):
        return {
            horizon: view
            for horizon, view in forward_views.items()
            if isinstance(view, dict)
        }
    if isinstance(forward_views, list):
        return {
            item["horizon"]: item
            for item in forward_views
            if isinstance(item, dict) and isinstance(item.get("horizon"), str)
        }
    return {}


def _view_reason(view: dict[str, Any]) -> str:
    """v3 把理由寫在 text，v4 之後拆成 reason。"""
    for field in ("reason", "text"):
        value = view.get(field)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def _has_invalidation(view: dict[str, Any]) -> bool:
    """v3 用 id 參照失效條件，v4 之後直接寫在 invalidation。"""
    invalidation = view.get("invalidation")
    if isinstance(invalidation, str) and invalidation.strip():
        return True
    return bool(view.get("invalidation_condition_ids"))


def _response(result: dict[str, Any]) -> dict[str, Any]:
    response = result.get("response")
    return response if isinstance(response, dict) else result


def _case_key(result: dict[str, Any]) -> tuple[Any, Any]:
    case = result.get("case")
    if isinstance(case, dict):
        return case.get("symbol"), case.get("as_of_date")
    response = _response(result)
    return response.get("symbol"), response.get("as_of_date")


def _modal_share(values: list[str]) -> float:
    return max(Counter(values).values()) / len(values) if values else 0.0


def _agreement(grouped: dict[tuple[Any, Any], list[str]]) -> float:
    shares = [_modal_share(values) for values in grouped.values() if values]
    return fmean(shares) if shares else 0.0


def _mean(values: list[float]) -> float:
    return round(fmean(values), 4) if values else 0.0


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * percentile
    lower, upper = floor(position), ceil(position)
    value = ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)
    return round(value, 2)


def aggregate_eval_results(results: list[dict]) -> dict:
    statuses = ("verified", "limited", "unavailable")
    status_counts = Counter()
    hard_runs = soft_hits = simplified_runs = 0
    clean_evidence_runs = undercount_runs = truncated_runs = jargon_runs = 0
    briefs_total = both_sides_runs = 0
    key_day_numbers = key_day_numbers_verified = 0
    overall_by_case: dict[tuple[Any, Any], list[str]] = defaultdict(list)
    forward_by_case: dict[str, dict[tuple[Any, Any], list[str]]] = {
        horizon: defaultdict(list) for horizon in FORWARD_HORIZONS
    }
    # 每個時間尺度的建議品質樣本，逐則累積後在最後取平均。
    forward_quality: dict[str, dict[str, list[float]]] = {
        horizon: defaultdict(list) for horizon in FORWARD_HORIZONS
    }
    latencies: list[float] = []

    for result in results:
        response = _response(result)
        status = response.get("status")
        status_counts[status if status in statuses else "unavailable"] += 1
        verification = response.get("verification") or {}
        hard_runs += bool(verification.get("compliance_violations"))
        soft_hits += len(verification.get("soft_compliance_hits") or [])
        simplified_runs += bool(verification.get("simplified_chars"))
        clean_evidence_runs += not verification.get("filtered_evidence_ids")
        undercount_runs += bool(verification.get("undercount_sections"))
        truncated_runs += bool(verification.get("truncated_sections"))
        jargon_runs += bool(verification.get("jargon_hits"))

        latency = result.get("latency_ms")
        if isinstance(latency, (int, float)) and not isinstance(latency, bool):
            latencies.append(float(latency))

        brief = response.get("brief")
        if not isinstance(brief, dict):
            continue
        briefs_total += 1
        key = _case_key(result)
        stance = brief.get("overall_stance")
        if isinstance(stance, str):
            overall_by_case[key].append(stance)
        forward_views = forward_views_map(brief.get("forward_views"))
        for horizon in FORWARD_HORIZONS:
            view = forward_views.get(horizon)
            if not isinstance(view, dict):
                continue
            view_stance = view.get("stance")
            if not isinstance(view_stance, str):
                continue
            forward_by_case[horizon][key].append(view_stance)
            samples = forward_quality[horizon]
            samples["strength"].append(STANCE_STRENGTH.get(view_stance, 0.0))
            samples["directionless"].append(
                float(view_stance in DIRECTIONLESS_STANCES)
            )
            samples["evidence_count"].append(float(len(view.get("evidence_ids") or [])))
            samples["invalidation"].append(float(_has_invalidation(view)))
            samples["reason_len"].append(float(len(_view_reason(view))))

        both_sides_runs += bool(brief.get("positive_factors")) and bool(
            brief.get("negative_factors")
        )

        # key_days 的數字對帳率：分母是敘述裡出現的百分比總數，
        # 分子是通過後端對帳的數量（未列入 verification.unverified_numbers）。
        unverified = len(verification.get("unverified_numbers") or [])
        written = sum(
            len(PERCENT_IN_TEXT_RE.findall(item.get("what") or ""))
            for item in brief.get("key_days") or []
            if isinstance(item, dict)
        )
        key_day_numbers += written
        key_day_numbers_verified += max(written - unverified, 0)

    total = len(results)
    return {
        "runs_total": total,
        "status_counts": {status: status_counts[status] for status in statuses},
        "unavailable_rate": status_counts["unavailable"] / total if total else 0.0,
        "hard_violation_rate": hard_runs / total if total else 0.0,
        "soft_hits_avg": soft_hits / total if total else 0.0,
        "simplified_char_runs": simplified_runs,
        "both_sides_coverage": both_sides_runs / briefs_total if briefs_total else 0.0,
        "clean_evidence_rate": clean_evidence_runs / total if total else 0.0,
        "undercount_rate": undercount_runs / total if total else 0.0,
        "truncated_rate": truncated_runs / total if total else 0.0,
        "jargon_rate": jargon_runs / total if total else 0.0,
        "key_day_number_accuracy": (
            key_day_numbers_verified / key_day_numbers if key_day_numbers else 1.0
        ),
        "stance_agreement": {
            "overall_stance": _agreement(overall_by_case),
            "forward_views": {
                horizon: _agreement(grouped)
                for horizon, grouped in forward_by_case.items()
            },
        },
        # 骨架品質：三個時間尺度各自的建議具體度。量的是文字建議本身，
        # 與股價準確度無關——時間拉遠後模型是否退回中性，看這裡。
        "forward_view_quality": {
            horizon: {
                "samples": len(samples["strength"]),
                "directionless_rate": _mean(samples["directionless"]),
                "avg_stance_strength": _mean(samples["strength"]),
                "invalidation_rate": _mean(samples["invalidation"]),
                "evidence_ids_avg": _mean(samples["evidence_count"]),
                "reason_len_avg": _mean(samples["reason_len"]),
            }
            for horizon, samples in forward_quality.items()
        },
        "latency_ms_p50": _percentile(latencies, 0.50),
        "latency_ms_p95": _percentile(latencies, 0.95),
    }
