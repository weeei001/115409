from __future__ import annotations

from datetime import date, timedelta

from sklearn.preprocessing import StandardScaler

from trend_core.core_mode_ml import (
    build_ml_dataset,
    evaluate_ml_model_with_tss,
    evaluate_rule_based_with_time_series_split,
    train_ml_model,
)
from trend_core.core_mode_types import MarketRow, TimeSeriesMLSettings, normalize_core_mode_params, normalize_time_series_ml_settings


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * 0.28)
        wave = ((idx % 12) - 6) * 0.45
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


def test_enable_model_training_false_skips_training() -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": False,
            "model_type": "logistic_regression",
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

    assert result.enabled is False
    assert result.fold_metrics == []


def test_logistic_regression_uses_pipeline_with_standard_scaler() -> None:
    X, y, _, _ = _build_dataset()

    model, warnings = train_ml_model(
        X_train=X[:200],
        y_train=y[:200],
        model_type="logistic_regression",
    )

    assert warnings == []
    assert model is not None
    assert hasattr(model, "named_steps")
    assert "scaler" in model.named_steps
    assert isinstance(model.named_steps["scaler"], StandardScaler)


def test_logistic_regression_can_train_and_score() -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "logistic_regression",
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
    assert len(result.fold_metrics) > 0


def test_standard_scaler_only_fits_train_fold(monkeypatch) -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "logistic_regression",
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    fit_sizes: list[int] = []
    original_fit = StandardScaler.fit

    def _wrapped_fit(self, X_fit, y_fit=None, **kwargs):  # type: ignore[no-untyped-def]
        fit_sizes.append(len(X_fit))
        return original_fit(self, X_fit, y_fit, **kwargs)

    monkeypatch.setattr(StandardScaler, "fit", _wrapped_fit)

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=feature_names,
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert fit_sizes
    assert all(size < len(X) for size in fit_sizes)


def test_random_forest_can_train_and_output_feature_importance() -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "random_forest",
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
    assert len(result.feature_importance) > 0


def test_gradient_boosting_can_train_and_output_feature_importance() -> None:
    X, y, sample_dates, feature_names = _build_dataset()
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "gradient_boosting",
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
    assert len(result.feature_importance) > 0


def test_time_series_split_train_test_order_is_correct() -> None:
    rows = _make_market_rows(320)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "random_forest",
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)
    model_folds = result.ml_model_validation.fold_metrics

    assert model_folds
    for fold in model_folds:
        assert fold.train_end < fold.test_start


def test_single_class_target_returns_warning_instead_of_crash() -> None:
    sample_dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(120)]
    X = [[float(i), float(i % 5)] for i in range(120)]
    y = [1 for _ in range(120)]
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "random_forest",
            "n_splits": 3,
            "test_size": 20,
            "gap": 5,
            "prediction_horizon": 5,
        }
    )

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=["f1", "f2"],
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert result.fold_metrics == []
    assert any("單一類別" in item for item in result.warnings)


def test_insufficient_sample_returns_warning_instead_of_crash() -> None:
    sample_dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(40)]
    X = [[float(i), float(i % 3)] for i in range(40)]
    y = [0 if i % 2 == 0 else 1 for i in range(40)]
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "enable_model_training": True,
            "model_type": "gradient_boosting",
            "n_splits": 5,
            "test_size": 20,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=["f1", "f2"],
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert result.metrics is not None
    assert result.metrics.fold_count == 0
    assert any("樣本數不足" in item or "無法建立 folds" in item for item in result.warnings)


def test_unsupported_model_type_returns_warning() -> None:
    sample_dates = [date(2025, 1, 1) + timedelta(days=i) for i in range(120)]
    X = [[float(i), float(i % 4)] for i in range(120)]
    y = [0 if i % 2 == 0 else 1 for i in range(120)]
    settings = TimeSeriesMLSettings(
        enabled=True,
        enable_model_training=True,
        model_type="unsupported",  # type: ignore[arg-type]
    )

    result = evaluate_ml_model_with_tss(
        X=X,
        y=y,
        sample_dates=sample_dates,
        feature_names=["f1", "f2"],
        ml_settings=settings,
        target_mode="future_quality",
    )

    assert result.enabled is True
    assert any("不支援的 model_type" in item for item in result.warnings)
