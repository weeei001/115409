from datetime import date

import pytest

from stock_behavior.backtest_stats import (
    coefficient_of_variation,
    direction_modal_share,
    mean_abs_pct_error,
    select_weekly_dates,
    skill_score,
    wilson_interval,
)


def test_select_weekly_dates_handles_iso_year_boundaries_and_single_day_weeks():
    dates = [
        date(2023, 12, 28),
        date(2023, 12, 29),
        date(2024, 1, 1),
        date(2024, 1, 2),
        date(2024, 1, 8),
    ]

    assert select_weekly_dates(dates) == [
        date(2023, 12, 29),
        date(2024, 1, 2),
        date(2024, 1, 8),
    ]


def test_wilson_interval_handles_empty_and_known_sample():
    assert wilson_interval(0, 0) == (0.0, 1.0)
    low, high = wilson_interval(10, 20)
    assert low == pytest.approx(0.299, abs=1e-3)
    assert high == pytest.approx(0.701, abs=1e-3)


def test_direction_modal_share_handles_empty_and_ties():
    assert direction_modal_share([]) == 0.0
    assert direction_modal_share(["up", "up", "down"]) == pytest.approx(2 / 3)
    assert direction_modal_share(["up", "down"]) == 0.5


def test_coefficient_of_variation_handles_short_and_zero_mean_samples():
    assert coefficient_of_variation([1.0]) == 0.0
    assert coefficient_of_variation([-1.0, 1.0]) == 0.0
    assert coefficient_of_variation([1.0, 3.0]) == 0.5


def test_mean_abs_pct_error_skips_zero_actuals():
    assert mean_abs_pct_error([]) is None
    assert mean_abs_pct_error([(10.0, 0.0)]) is None
    assert mean_abs_pct_error([(110.0, 100.0), (10.0, 0.0)]) == pytest.approx(0.1)


def test_skill_score_propagates_missing_or_zero_baseline():
    assert skill_score(0.1, 0.2) == 0.5
    assert skill_score(None, 0.2) is None
    assert skill_score(0.1, None) is None
    assert skill_score(0.1, 0.0) is None
