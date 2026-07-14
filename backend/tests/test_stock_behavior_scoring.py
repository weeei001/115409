import pytest

from stock_behavior.scoring import (
    adjusted_return,
    classify_direction,
    direction_hit,
    dividend_adjustment_factor,
)


def test_dividend_adjustment_factor_uses_sources_in_priority_order():
    assert dividend_adjustment_factor(100, 96, 95, 3) == 0.96
    assert dividend_adjustment_factor(100, None, 95, 3) == 0.97
    assert dividend_adjustment_factor(100, None, 95, None) == 0.95
    assert dividend_adjustment_factor(100, None, None, None) is None
    assert dividend_adjustment_factor(100, None, None, 100) is None


def test_adjusted_return_handles_dividend_factor():
    assert adjusted_return(100, 100, []) == 0
    assert adjusted_return(100, 100, [0.96]) == pytest.approx(0.0416667)


def test_classify_direction_keeps_deadband_boundaries_neutral():
    assert classify_direction(0.0101, 0.01) == "up"
    assert classify_direction(0.01, 0.01) == "neutral"
    assert classify_direction(-0.01, 0.01) == "neutral"
    assert classify_direction(-0.0101, 0.01) == "down"


def test_direction_hit_treats_uncertain_as_unscorable():
    assert direction_hit("uncertain", "up") is None
    assert direction_hit("up", "up") is True
    assert direction_hit("down", "neutral") is False
