from __future__ import annotations

from datetime import date, timedelta

import pytest

import trend_core.core_mode_ml as core_mode_ml
from trend_core.core_mode_ml import build_ml_dataset, evaluate_ml_model_with_tss
from trend_core.core_mode_types import MarketRow, normalize_core_mode_params, normalize_time_series_ml_settings


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * 0.25)
        wave = ((idx % 12) - 6) * 0.4
        close = base + wave
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.4,
                high=close + 0.9,
                low=close - 0.8,
                close=close,
                volume=1_000_000 + ((idx % 9) * 18_000),
                ma5=close - 0.7,
                ma20=close - 1.5,
                ma60=close - 2.5,
                rsi14=50.0 + ((idx % 9) - 4),
                k_value=55.0 + (idx % 10),
                d_value=52.0 + (idx % 7),
                macd=0.5 + ((idx % 6) * 0.08),
                macd_signal=0.4 + ((idx % 6) * 0.06),
                macd_hist=0.12 + ((idx % 5) * 0.04),
                total_net=1_500.0 + (((idx % 13) - 6) * 120.0),
                news_score=0.0,
            )
        )
    return rows


def _build_dataset() -> tuple[list[list[float]], list[int], list[date], list[str]]:
    rows = _make_market_rows(320)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "prediction_horizon": 20,
            "target_mode": "future_quality",
            "future_quality_threshold": 0.55,
        }
    )
    payload = build_ml_dataset(rows=rows, params=params, ml_settings=settings)
    return payload["X"], payload["y"], payload["sample_dates"], payload["feature_names"]


@pytest.mark.parametrize("model_type", ["random_forest", "gradient_boosting", "logistic_regression"])
def test_feature_importance_is_aggregated_across_folds(model_type: str) -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": model_type,
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=feature_names,
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert result.metrics is not None
    assert result.metrics.fold_count > 0
    assert result.feature_importance
    for item in result.feature_importance:
        assert item.feature
        assert item.importance >= 0.0
        assert item.importance_mean is not None
        assert item.importance_std is not None
        assert item.fold_count is not None
        assert item.fold_count >= 1


def test_skipped_folds_and_low_successful_fold_count_emit_warnings() -> None:
    sample_dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(140)]
    X = [[float(i), float(i % 5), float((i * 3) % 7)] for i in range(140)]
    y = [0 if i < 100 else (1 if i % 2 else 0) for i in range(140)]
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "random_forest",
            "n_splits": 4,
            "test_size": 20,
            "gap": 5,
            "prediction_horizon": 5,
        }
    )

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=["f1", "f2", "f3"],
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert result.metrics is not None
    assert result.metrics.fold_count == 1
    assert any("單一類別" in item for item in result.warnings)
    assert any("成功模型 fold 數過少" in item for item in result.warnings)
    assert any("model metrics fold_count" in item for item in result.warnings)


def test_feature_importance_warns_when_only_available_in_few_successful_folds(monkeypatch) -> None:
    sample_dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(140)]
    X = [[float(i), float(i % 5), float((i * 3) % 7)] for i in range(140)]
    y = [0 if i < 80 else (1 if i % 2 else 0) for i in range(140)]
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "gradient_boosting",
            "n_splits": 4,
            "test_size": 20,
            "gap": 5,
            "prediction_horizon": 5,
        }
    )

    original_extract = core_mode_ml.extract_feature_importance
    call_count = 0

    def _mock_extract_feature_importance(*args, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal call_count
        call_count += 1
        if call_count == 1:
            return [], ["mock: fold importance unavailable"]
        return original_extract(*args, **kwargs)

    monkeypatch.setattr(core_mode_ml, "extract_feature_importance", _mock_extract_feature_importance)

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=["f1", "f2", "f3"],
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert result.metrics is not None
    assert result.metrics.fold_count >= 2
    assert any("feature importance 僅來自" in item for item in result.warnings)
