from __future__ import annotations

from datetime import date, timedelta

import pytest
from pydantic import ValidationError

try:
    from schemas.core_mode import TimeSeriesMLSettingsInput
except ModuleNotFoundError:  # pragma: no cover - fallback for repo-root pytest invocation
    from backend.schemas.core_mode import TimeSeriesMLSettingsInput
from trend_core.core_mode_ml import build_future_quality_target, build_ml_dataset
from trend_core.core_mode_types import (
    DEFAULT_TIME_SERIES_ML_SETTINGS,
    MarketRow,
    normalize_core_mode_params,
    normalize_time_series_ml_settings,
)


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * 0.25)
        wave = ((idx % 10) - 5) * 0.4
        close = base + wave
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.3,
                high=close + 0.8,
                low=close - 0.8,
                close=close,
                volume=900_000 + ((idx % 9) * 20_000),
                ma5=close - 0.5,
                ma20=close - 1.2,
                ma60=close - 2.4,
                rsi14=51.0 + ((idx % 9) - 4),
                k_value=57.0 + (idx % 10),
                d_value=53.0 + (idx % 7),
                macd=0.5 + ((idx % 6) * 0.07),
                macd_signal=0.45 + ((idx % 6) * 0.05),
                macd_hist=0.08 + ((idx % 5) * 0.04),
                total_net=1_800.0 + (((idx % 12) - 6) * 130.0),
                news_score=0.0,
            )
        )
    return rows


def test_future_quality_threshold_default_is_055() -> None:
    assert DEFAULT_TIME_SERIES_ML_SETTINGS.future_quality_threshold == 0.55


def test_future_quality_threshold_can_be_overridden() -> None:
    settings = normalize_time_series_ml_settings({"future_quality_threshold": 0.72})
    assert settings.future_quality_threshold == 0.72


def test_future_quality_threshold_out_of_range_raises_validation_error() -> None:
    with pytest.raises(ValidationError):
        TimeSeriesMLSettingsInput(future_quality_threshold=1.2)

    with pytest.raises(ValidationError):
        TimeSeriesMLSettingsInput(future_quality_threshold=-0.01)


def test_build_future_quality_target_uses_input_threshold() -> None:
    rows = [
        {"available": True, "quality": 0.6, "passed": False},
        {"available": True, "quality": 0.4, "passed": False},
        {"available": True, "quality": 0.5, "passed": False},
    ]

    labels, _, _ = build_future_quality_target(
        future_quality_rows=rows,
        prediction_horizon=20,
        future_quality_threshold=0.5,
    )

    assert labels == [1, 0, 1]


def test_dataset_summary_includes_threshold_and_target_settings() -> None:
    rows = _make_market_rows(140)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "prediction_horizon": 15,
            "future_quality_threshold": 0.66,
            "target_mode": "future_quality",
        }
    )

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.prediction_horizon == 15
    assert summary.future_quality_threshold == 0.66
    assert summary.target_warning is None
    assert summary.unsupported_target_mode is None


def test_trade_return_target_returns_requested_warning_without_crash() -> None:
    rows = _make_market_rows(120)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": True, "target_mode": "trade_return"})

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.enabled is False
    assert summary.unsupported_target_mode == "trade_return"
    assert summary.target_warning == "trade_return target 尚未在目前階段啟用，請先使用 future_quality。"


def test_trend_label_target_returns_requested_warning_without_crash() -> None:
    rows = _make_market_rows(120)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": True, "target_mode": "trend_label"})

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.enabled is False
    assert summary.unsupported_target_mode == "trend_label"
    assert summary.target_warning == "trend_label target 尚未在目前階段啟用，請先使用 future_quality。"
