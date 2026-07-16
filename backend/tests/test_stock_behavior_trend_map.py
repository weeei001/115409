import pytest
from pydantic import ValidationError

from schemas.stock_behavior import (
    StockBehaviorTextBrief,
    TextBriefForwardView,
    TextBriefTrend,
)
from stock_behavior.trend_map import derive_trend


def _brief(stance: str = "neutral") -> StockBehaviorTextBrief:
    return StockBehaviorTextBrief.model_construct(
        forward_views=[
            TextBriefForwardView(
                horizon="short_1_5",
                text="短線看法",
                stance=stance,
                confidence="medium",
                basis_item_ids=["why_01"],
                evidence_ids=["pv_01", "tc_01"],
                confirmation_condition_ids=["cond_01"],
                invalidation_condition_ids=["cond_02"],
            ),
            TextBriefForwardView(
                horizon="swing_6_20",
                text="波段看法",
                stance="neutral",
                confidence="low",
            ),
            TextBriefForwardView(
                horizon="medium_21_40",
                text="中期看法",
                stance="uncertain",
                confidence="low",
            ),
        ]
    )


@pytest.mark.parametrize(
    ("stance", "direction", "eligible", "reason"),
    [
        ("bullish", "up", True, None),
        ("mildly_bullish", "up", True, None),
        ("neutral", "neutral", True, None),
        ("mildly_bearish", "down", True, None),
        ("bearish", "down", True, None),
        ("mixed", "uncertain", False, "來源分歧"),
        ("uncertain", "uncertain", False, "證據不足"),
    ],
)
def test_stance_mapping_and_score_eligibility(stance, direction, eligible, reason):
    horizon = derive_trend(_brief(stance)).horizons[0]

    assert horizon.directional_band == stance
    assert horizon.score_direction == direction
    assert horizon.score_eligible is eligible
    assert horizon.not_scoreable_reason == reason


def test_horizon_ranges_and_price_forecast_guard():
    trend = derive_trend(_brief())

    assert [
        (item.horizon, item.trading_day_range, item.evaluation_day)
        for item in trend.horizons
    ] == [
        ("short_1_5", [1, 5], 5),
        ("swing_6_20", [6, 20], 20),
        ("medium_21_40", [21, 40], 40),
    ]
    assert trend.contains_price_forecast is False
    payload = trend.model_dump()
    payload["contains_price_forecast"] = True
    with pytest.raises(ValidationError):
        TextBriefTrend.model_validate(payload)
