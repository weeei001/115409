from __future__ import annotations

from datetime import date, timedelta

from trend_core.core_mode_ml import build_ml_dataset, evaluate_rule_based_with_time_series_split
from trend_core.core_mode_types import MarketRow, normalize_core_mode_params, normalize_time_series_ml_settings


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * 0.3)
        wave = ((idx % 14) - 7) * 0.35
        close = base + wave
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.4,
                high=close + 1.0,
                low=close - 1.0,
                close=close,
                volume=1_000_000 + ((idx % 9) * 15_000),
                ma5=close - 0.6,
                ma20=close - 1.4,
                ma60=close - 2.2,
                rsi14=52.0 + ((idx % 10) - 5),
                k_value=58.0 + (idx % 12),
                d_value=54.0 + (idx % 8),
                macd=0.6 + ((idx % 7) * 0.08),
                macd_signal=0.5 + ((idx % 7) * 0.06),
                macd_hist=0.1 + ((idx % 5) * 0.05),
                total_net=2_000.0 + (((idx % 15) - 7) * 120.0),
                news_score=0.0,
            )
        )
    return rows


def test_build_ml_dataset_future_quality_outputs_summary_and_arrays() -> None:
    rows = _make_market_rows(160)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "prediction_horizon": 20,
            "target_mode": "future_quality",
        }
    )

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.enabled is True
    assert summary.target_mode == "future_quality"
    assert len(dataset["X"]) == len(dataset["y"]) == summary.sample_count
    assert summary.sample_count == len(rows) - settings.prediction_horizon
    assert summary.feature_count == len(dataset["feature_names"])
    assert summary.positive_count + summary.negative_count == summary.sample_count


def test_build_ml_dataset_has_no_future_leakage_features() -> None:
    rows = _make_market_rows(120)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "prediction_horizon": 15,
            "target_mode": "future_quality",
        }
    )

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    feature_names = dataset["feature_names"]

    assert "future_quality" not in feature_names
    assert all("future" not in name.lower() for name in feature_names)
    assert all("target" not in name.lower() for name in feature_names)
    assert all("label" not in name.lower() for name in feature_names)
    assert all("y_" not in name.lower() for name in feature_names)


def test_build_ml_dataset_drops_constant_features_and_reports_them() -> None:
    rows = _make_market_rows(150)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": True, "prediction_horizon": 20})

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert "breakout_lookback" in summary.dropped_feature_names
    assert "momentum_window" in summary.dropped_feature_names
    assert summary.feature_count > 0


def test_build_ml_dataset_trade_return_returns_warning_without_crash() -> None:
    rows = _make_market_rows(120)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "target_mode": "trade_return",
        }
    )

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.enabled is False
    assert summary.sample_count == 0
    assert any("trade_return target 尚未在目前階段啟用" in item for item in summary.warnings)


def test_build_ml_dataset_trend_label_returns_warning_without_crash() -> None:
    rows = _make_market_rows(120)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "target_mode": "trend_label",
        }
    )

    dataset = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    summary = dataset["dataset_summary"]

    assert summary.enabled is False
    assert summary.sample_count == 0
    assert any("trend_label target 尚未在目前階段啟用" in item for item in summary.warnings)


def test_ml_validation_enabled_includes_dataset_summary() -> None:
    rows = _make_market_rows(260)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
            "target_mode": "future_quality",
        }
    )

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is True
    assert result.dataset_summary is not None
    assert result.dataset_summary.enabled is True
    assert result.dataset_summary.sample_count == len(rows) - settings.prediction_horizon


def test_ml_validation_disabled_keeps_original_flow() -> None:
    rows = _make_market_rows(220)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": False})

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is False
    assert result.dataset_summary is None
    assert result.fold_metrics == []
