from __future__ import annotations

from datetime import date, timedelta

from sklearn.model_selection import TimeSeriesSplit

from services.core_mode import CoreModeService
import trend_core.core_mode_ml as core_mode_ml
from trend_core.core_mode_ml import evaluate_rule_based_with_time_series_split, make_time_series_splitter
from trend_core.core_mode_types import MarketRow, normalize_core_mode_params, normalize_time_series_ml_settings


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2023, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        close = 80.0 + (idx * 0.35)
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.2,
                high=close + 0.7,
                low=close - 0.6,
                close=close,
                volume=1_200_000 + (idx * 1500),
                ma5=close - 0.4,
                ma20=close - 1.2,
                ma60=close - 2.3,
                rsi14=58.0,
                k_value=66.0,
                d_value=54.0,
                macd=1.1,
                macd_signal=0.7,
                macd_hist=0.25,
                total_net=3_500.0 + (idx * 18.0),
                news_score=0.0,
            )
        )
    return rows


def test_time_series_split_can_import() -> None:
    splitter = TimeSeriesSplit(n_splits=3, test_size=20, gap=5)
    assert isinstance(splitter, TimeSeriesSplit)


def test_time_series_split_order_and_gap_are_respected() -> None:
    rows = _make_market_rows(300)
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "n_splits": 4,
            "test_size": 30,
            "gap": 10,
            "prediction_horizon": 5,
        }
    )
    splitter, effective_gap, _ = make_time_series_splitter(sample_count=len(rows), ml_settings=settings)
    splits = list(splitter.split(list(range(len(rows)))))

    assert len(splits) > 0
    assert effective_gap == 10
    for train_idx, test_idx in splits:
        assert len(train_idx) > 0
        assert len(test_idx) > 0
        assert max(train_idx) < min(test_idx)
        assert (min(test_idx) - max(train_idx) - 1) >= effective_gap


def test_gap_auto_bump_when_smaller_than_prediction_horizon() -> None:
    rows = _make_market_rows(320)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "n_splits": 4,
            "test_size": 30,
            "gap": 5,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is True
    assert result.effective_gap == 20
    assert any("effective_gap=20" in item for item in result.warnings)


def test_ml_settings_disabled_keeps_validation_payload_without_folds() -> None:
    rows = _make_market_rows(260)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": False})

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is False
    assert result.fold_metrics == []
    assert result.aggregate_metrics.fold_ac_mean == 0.0


def test_ml_settings_disabled_does_not_call_splitter_in_validation(monkeypatch) -> None:
    rows = _make_market_rows(260)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings({"enabled": False})

    def _should_not_call_splitter(**kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("make_time_series_splitter should not be called when ml_settings.enabled=false")

    monkeypatch.setattr(core_mode_ml, "make_time_series_splitter", _should_not_call_splitter)

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is False
    assert result.fold_metrics == []
    assert result.aggregate_metrics.fold_ac_mean == 0.0


def test_ml_settings_enabled_returns_fold_metrics_and_aggregate() -> None:
    rows = _make_market_rows(320)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is True
    assert len(result.fold_metrics) > 0
    assert result.aggregate_metrics.fold_ac_mean >= 0.0
    assert 0.0 <= result.aggregate_metrics.stability_score <= 1.0


def test_insufficient_samples_returns_warning_instead_of_crash() -> None:
    rows = _make_market_rows(60)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": True,
            "n_splits": 5,
            "test_size": 20,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = evaluate_rule_based_with_time_series_split(rows=rows, params=params, ml_settings=settings)

    assert result.enabled is True
    assert result.fold_metrics == []
    assert any("樣本數不足" in item or "無法建立 folds" in item for item in result.warnings)


def test_service_run_core_mode_keeps_original_flow_when_ml_disabled(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(220))

    result = service.run_core_mode(
        {
            "symbol": "2330",
            "date_range": {"start_date": "2023-01-01", "end_date": "2023-08-08"},
            "params": {},
            "run_optimization": False,
            "ml_settings": {"enabled": False},
        }
    )

    assert "summary" in result
    assert "walk_forward" in result
    assert "optimization" in result
    assert result["ml_validation"]["enabled"] is False


def test_service_run_core_mode_ml_disabled_does_not_call_ml_validation_entry(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(220))

    def _should_not_call_ml_validation(**kwargs):  # type: ignore[no-untyped-def]
        raise AssertionError("evaluate_rule_based_with_time_series_split should not be called when ml_settings.enabled=false")

    monkeypatch.setattr("services.core_mode.evaluate_rule_based_with_time_series_split", _should_not_call_ml_validation)

    result = service.run_core_mode(
        {
            "symbol": "2330",
            "date_range": {"start_date": "2023-01-01", "end_date": "2023-08-08"},
            "params": {},
            "run_optimization": False,
            "ml_settings": {"enabled": False, "enable_model_training": True, "enable_candidate_ranking": True},
        }
    )

    assert "summary" in result
    assert result["ml_validation"]["enabled"] is False

