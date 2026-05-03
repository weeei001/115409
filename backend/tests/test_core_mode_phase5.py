from __future__ import annotations

from datetime import date, timedelta

import pytest

from services.core_mode import CoreModeService
from trend_core.core_mode_ml import (
    build_candidate_dataset,
    build_candidate_target,
    evaluate_rule_based_with_time_series_split,
    rank_candidates_with_ml,
)
from trend_core.core_mode_types import (
    CoreModeParams,
    MarketRow,
    TimeSeriesMLSettings,
    normalize_core_mode_params,
    normalize_time_series_ml_settings,
)


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * 0.21)
        wave = ((idx % 10) - 5) * 0.55
        close = base + wave
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.5,
                high=close + 0.8,
                low=close - 0.9,
                close=close,
                volume=1_000_000 + ((idx % 11) * 22_000),
                ma5=close - 0.7,
                ma20=close - 1.4,
                ma60=close - 2.2,
                rsi14=50.0 + ((idx % 8) - 4),
                k_value=54.0 + (idx % 9),
                d_value=51.0 + (idx % 6),
                macd=0.45 + ((idx % 5) * 0.09),
                macd_signal=0.35 + ((idx % 5) * 0.07),
                macd_hist=0.1 + ((idx % 6) * 0.03),
                total_net=1_200.0 + (((idx % 15) - 7) * 105.0),
                news_score=0.0,
            )
        )
    return rows


def _candidate_pool() -> list[CoreModeParams]:
    base = normalize_core_mode_params({})
    return [
        base,
        normalize_core_mode_params({**base.__dict__, "breakout_lookback": 24, "momentum_window": 14}),
        normalize_core_mode_params({**base.__dict__, "state_threshold": 0.22, "trend_threshold": 0.24}),
        normalize_core_mode_params({**base.__dict__, "hard_stop_pct": 0.06, "trailing_stop_pct": 0.08}),
    ]


def test_candidate_ranking_disabled_returns_empty_payload() -> None:
    rows = _make_market_rows(260)
    settings = normalize_time_series_ml_settings({"enable_candidate_ranking": False})
    result = rank_candidates_with_ml(rows=rows, candidate_params=_candidate_pool(), ml_settings=settings)
    assert result.enabled is False
    assert result.ranked_candidates == []


def test_candidate_ranking_outputs_predicted_and_verified_scores() -> None:
    rows = _make_market_rows(280)
    settings = normalize_time_series_ml_settings(
        {
            "enable_candidate_ranking": True,
            "candidate_ranking_top_n": 3,
            "candidate_ranking_model_type": "random_forest",
            "candidate_ranking_score_mode": "balanced_score",
            "n_splits": 3,
            "test_size": 40,
            "gap": 20,
            "prediction_horizon": 20,
        }
    )

    result = rank_candidates_with_ml(rows=rows, candidate_params=_candidate_pool(), ml_settings=settings)
    assert result.enabled is True
    assert result.candidate_count >= 4
    assert len(result.ranked_candidates) <= 3
    assert result.ranked_candidates
    for item in result.ranked_candidates:
        assert 0.0 <= item.predicted_score <= 1.0
        assert 0.0 <= item.verified_score <= 1.0
        assert item.verified_summary.trade_count >= 0


def test_candidate_ranking_top_n_is_clamped_to_20() -> None:
    settings = normalize_time_series_ml_settings({"candidate_ranking_top_n": 999})
    assert settings.candidate_ranking_top_n == 20


def test_candidate_pool_too_small_returns_warning_not_crash() -> None:
    rows = _make_market_rows(220)
    settings = normalize_time_series_ml_settings({"enable_candidate_ranking": True})
    result = rank_candidates_with_ml(rows=rows, candidate_params=[normalize_core_mode_params({})], ml_settings=settings)
    assert result.enabled is True
    assert result.ranked_candidates == []
    assert any("candidate pool 太少" in item for item in result.warnings)


def test_build_candidate_dataset_does_not_mix_target_into_features() -> None:
    rows = _make_market_rows(220)
    settings = normalize_time_series_ml_settings(
        {
            "enable_candidate_ranking": True,
            "candidate_ranking_score_mode": "balanced_score",
            "n_splits": 2,
            "test_size": 30,
            "gap": 10,
            "prediction_horizon": 10,
        }
    )
    dataset = build_candidate_dataset(rows=rows, candidate_params=_candidate_pool(), ml_settings=settings)
    feature_names = dataset["feature_names"]
    assert "predicted_score" not in feature_names
    assert "verified_score" not in feature_names
    assert "balanced_score" not in feature_names
    assert "return_score" not in feature_names
    assert "drawdown_score" not in feature_names


def test_balanced_score_normalization_matches_formula() -> None:
    score, warnings = build_candidate_target(
        ac=0.6,
        cumulative_return=0.2,
        max_drawdown=-0.1,
        trade_count=24,
        stability=0.5,
        score_mode="balanced_score",
    )
    expected = (0.25 * 0.6) + (0.25 * 0.5) + (0.20 * 0.5) + (0.15 * (1 - (0.1 / 0.35))) + (0.15 * (24 / 30))
    assert warnings == []
    assert score == pytest.approx(round(expected, 6), abs=1e-6)


def test_service_ranking_does_not_call_preset_mutations(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(260))

    monkeypatch.setattr(service.preset_store, "create_or_update_preset", lambda **_: (_ for _ in ()).throw(RuntimeError("must not call save")))
    monkeypatch.setattr(service.preset_store, "activate", lambda *_: (_ for _ in ()).throw(RuntimeError("must not call activate")))
    monkeypatch.setattr(
        service.preset_store,
        "replace_system_candidates",
        lambda **_: (_ for _ in ()).throw(RuntimeError("must not call replace_system_candidates")),
    )

    result = service.run_core_mode(
        {
            "symbol": "2330",
            "date_range": {"start_date": "2024-01-01", "end_date": "2024-09-30"},
            "params": {},
            "run_optimization": False,
            "ml_settings": {
                "enabled": True,
                "enable_candidate_ranking": True,
                "candidate_ranking_top_n": 5,
                "candidate_ranking_model_type": "random_forest",
                "candidate_ranking_score_mode": "balanced_score",
            },
        }
    )
    ranking = result["ml_validation"]["ml_candidate_ranking"]
    assert ranking["enabled"] is True
    assert any("run_optimization=false" in item for item in ranking["warnings"])


def test_service_run_core_mode_does_not_modify_preset_file(monkeypatch, tmp_path) -> None:
    preset_path = tmp_path / "core_mode_presets.json"
    service = CoreModeService(preset_store_path=preset_path)
    _ = service.preset_store.list_presets()
    before = preset_path.read_text(encoding="utf-8")

    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(260))
    _ = service.run_core_mode(
        {
            "symbol": "2330",
            "date_range": {"start_date": "2024-01-01", "end_date": "2024-09-30"},
            "params": {},
            "run_optimization": False,
            "ml_settings": {
                "enabled": True,
                "enable_candidate_ranking": True,
                "candidate_ranking_top_n": 5,
                "candidate_ranking_model_type": "random_forest",
                "candidate_ranking_score_mode": "balanced_score",
            },
        }
    )

    after = preset_path.read_text(encoding="utf-8")
    assert after == before


def test_ml_settings_disabled_skips_candidate_ranking_even_if_flag_is_true() -> None:
    rows = _make_market_rows(280)
    params = normalize_core_mode_params({})
    settings = normalize_time_series_ml_settings(
        {
            "enabled": False,
            "enable_model_training": True,
            "enable_candidate_ranking": True,
            "candidate_ranking_top_n": 5,
        }
    )

    result = evaluate_rule_based_with_time_series_split(
        rows=rows,
        params=params,
        ml_settings=settings,
        candidate_params=_candidate_pool(),
    )
    assert result.enabled is False
    assert result.ml_model_validation.enabled is False
    assert result.ml_model_validation.warnings == []
    assert result.ml_candidate_ranking.enabled is False
    assert result.ml_candidate_ranking.warnings == []


def test_unsupported_candidate_ranking_model_or_score_mode_returns_warning_not_crash() -> None:
    rows = _make_market_rows(280)
    settings = TimeSeriesMLSettings(
        enabled=True,
        enable_candidate_ranking=True,
        candidate_ranking_model_type="unsupported",  # type: ignore[arg-type]
        candidate_ranking_score_mode="unsupported",  # type: ignore[arg-type]
    )
    result = rank_candidates_with_ml(rows=rows, candidate_params=_candidate_pool(), ml_settings=settings)

    assert result.enabled is True
    assert result.ranked_candidates == []
    assert any("不支援的 candidate_ranking_model_type" in item for item in result.warnings)


def test_unsupported_candidate_ranking_score_mode_returns_warning_not_crash() -> None:
    rows = _make_market_rows(280)
    settings = TimeSeriesMLSettings(
        enabled=True,
        enable_candidate_ranking=True,
        candidate_ranking_model_type="random_forest",
        candidate_ranking_score_mode="unsupported",  # type: ignore[arg-type]
    )
    result = rank_candidates_with_ml(rows=rows, candidate_params=_candidate_pool(), ml_settings=settings)

    assert result.enabled is True
    assert result.ranked_candidates == []
    assert any("不支援的 candidate_ranking_score_mode" in item for item in result.warnings)
