from __future__ import annotations

from collections import Counter, defaultdict
from math import ceil, floor
from statistics import fmean
from typing import Any


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
    overall_by_case: dict[tuple[Any, Any], list[str]] = defaultdict(list)
    latencies: list[float] = []

    for result in results:
        response = _response(result)
        status = response.get("status")
        status_counts[status if status in statuses else "unavailable"] += 1
        verification = response.get("verification") or {}
        hard_runs += bool(verification.get("compliance_violations"))
        soft_hits += len(verification.get("soft_compliance_hits") or [])
        simplified_runs += bool(verification.get("simplified_chars"))

        latency = result.get("latency_ms")
        if isinstance(latency, (int, float)) and not isinstance(latency, bool):
            latencies.append(float(latency))

        brief = response.get("brief")
        if not isinstance(brief, dict):
            continue
        key = _case_key(result)
        stance = brief.get("overall_stance")
        if isinstance(stance, str):
            overall_by_case[key].append(stance)

    total = len(results)
    return {
        "runs_total": total,
        "status_counts": {status: status_counts[status] for status in statuses},
        "unavailable_rate": status_counts["unavailable"] / total if total else 0.0,
        "hard_violation_rate": hard_runs / total if total else 0.0,
        "soft_hits_avg": soft_hits / total if total else 0.0,
        "simplified_char_runs": simplified_runs,
        "stance_agreement": {
            "overall_stance": _agreement(overall_by_case),
        },
        "latency_ms_p50": _percentile(latencies, 0.50),
        "latency_ms_p95": _percentile(latencies, 0.95),
    }
