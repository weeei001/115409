from __future__ import annotations

from schemas.stock_behavior import StockBehaviorTextBrief, TextBriefTrend


TREND_DERIVATION_VERSION = "trend-map-v1"
STANCE_TO_SCORE_DIRECTION = {
    "bullish": "up",
    "mildly_bullish": "up",
    "neutral": "neutral",
    "mildly_bearish": "down",
    "bearish": "down",
    "mixed": "uncertain",
    "uncertain": "uncertain",
}
HORIZON_TO_RANGE = {
    "short_1_5": ([1, 5], 5),
    "swing_6_20": ([6, 20], 20),
    "medium_21_40": ([21, 40], 40),
}


def derive_trend(brief: StockBehaviorTextBrief) -> TextBriefTrend:
    horizons = []
    for view in brief.forward_views:
        score_direction = STANCE_TO_SCORE_DIRECTION[view.stance]
        trading_day_range, evaluation_day = HORIZON_TO_RANGE[view.horizon]
        horizons.append(
            {
                "horizon": view.horizon,
                "trading_day_range": list(trading_day_range),
                "evaluation_day": evaluation_day,
                "directional_band": view.stance,
                "score_direction": score_direction,
                "confidence": view.confidence,
                "basis_item_ids": list(view.basis_item_ids),
                "evidence_ids": list(view.evidence_ids),
                "confirmation_condition_ids": list(
                    view.confirmation_condition_ids
                ),
                "invalidation_condition_ids": list(
                    view.invalidation_condition_ids
                ),
                "score_eligible": score_direction != "uncertain",
                "not_scoreable_reason": (
                    "來源分歧"
                    if view.stance == "mixed"
                    else "證據不足" if score_direction == "uncertain" else None
                ),
            }
        )
    return TextBriefTrend(
        derivation_version=TREND_DERIVATION_VERSION,
        horizons=horizons,
    )
