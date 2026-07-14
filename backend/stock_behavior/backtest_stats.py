from __future__ import annotations

from collections import Counter
from datetime import date
from math import sqrt
from statistics import fmean, pstdev


def select_weekly_dates(dates: list[date]) -> list[date]:
    weekly: dict[tuple[int, int], date] = {}
    for value in dates:
        iso = value.isocalendar()
        weekly[(iso.year, iso.week)] = value
    return list(weekly.values())


def wilson_interval(hits: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    proportion = hits / n
    z_squared = z * z
    denominator = 1 + z_squared / n
    center = (proportion + z_squared / (2 * n)) / denominator
    margin = (
        z
        * sqrt(proportion * (1 - proportion) / n + z_squared / (4 * n * n))
        / denominator
    )
    return center - margin, center + margin


def direction_modal_share(directions: list[str]) -> float:
    return max(Counter(directions).values(), default=0) / len(directions) if directions else 0.0


def coefficient_of_variation(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = fmean(values)
    return pstdev(values) / mean if mean != 0 else 0.0


def mean_abs_pct_error(pairs: list[tuple[float, float]]) -> float | None:
    errors = [abs(predicted - actual) / abs(actual) for predicted, actual in pairs if actual != 0]
    return fmean(errors) if errors else None


def skill_score(mape_model: float | None, mape_baseline: float | None) -> float | None:
    if mape_model is None or mape_baseline in (None, 0):
        return None
    return 1 - mape_model / mape_baseline
