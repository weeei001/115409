from __future__ import annotations

import json
from datetime import date, timedelta

import pytest

from pydantic import ValidationError

from schemas.core_mode import CoreModeParamsInput, CoreModeRunRequest
from services.core_mode import CoreModeService
from trend_core.core_mode_engine import compute_feature_rows, compute_score_rows
from trend_core.core_mode_presets import CoreModePresetStore
from trend_core.core_mode_types import MarketRow, normalize_core_mode_params
from trend_core.core_mode_validation import _build_weighted_profile_candidates, _dedupe_params


def _make_market_rows(count: int) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        close = 100.0 + (idx * 0.8)
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.3,
                high=close + 0.6,
                low=close - 0.8,
                close=close,
                volume=1_000_000 + (idx * 1_000),
                ma5=close - 0.5,
                ma20=close - 1.0,
                ma60=close - 2.0,
                rsi14=60.0,
                k_value=70.0,
                d_value=55.0,
                macd=1.2,
                macd_signal=0.8,
                macd_hist=0.3,
                total_net=5_000.0 + (idx * 20.0),
                news_score=0.0,
            )
        )
    return rows


def test_normalize_core_mode_params_adds_defaults_and_normalizes_groups() -> None:
    params = normalize_core_mode_params(
        {
            "weighted_technical_weight": 4,
            "weighted_institutional_weight": 3,
            "weighted_news_weight": 1,
            "weighted_momentum_weight": 2,
            "technical_ma_weight": 4,
            "technical_macd_weight": 0,
            "technical_rsi_weight": 0,
            "technical_kd_weight": 0,
        }
    )

    assert params.weighted_technical_weight == pytest.approx(0.4)
    assert params.weighted_institutional_weight == pytest.approx(0.3)
    assert params.weighted_news_weight == pytest.approx(0.1)
    assert params.weighted_momentum_weight == pytest.approx(0.2)
    assert params.technical_ma_weight == pytest.approx(1.0)
    assert params.technical_macd_weight == pytest.approx(0.0)
    assert params.technical_rsi_weight == pytest.approx(0.0)
    assert params.technical_kd_weight == pytest.approx(0.0)
    assert params.state_weighted_score_weight == pytest.approx(0.55)
    assert params.shape_breakout_weight == pytest.approx(0.35)
    assert params.shape_slope_weight == pytest.approx(0.25)
    assert params.shape_efficiency_weight == pytest.approx(0.25)
    assert params.shape_pullback_weight == pytest.approx(0.15)


def test_normalize_shape_weights_when_sum_not_one() -> None:
    params = normalize_core_mode_params(
        {
            "shape_breakout_weight": 3,
            "shape_slope_weight": 2,
            "shape_efficiency_weight": 1,
            "shape_pullback_weight": 4,
        }
    )

    assert params.shape_breakout_weight == pytest.approx(0.3)
    assert params.shape_slope_weight == pytest.approx(0.2)
    assert params.shape_efficiency_weight == pytest.approx(0.1)
    assert params.shape_pullback_weight == pytest.approx(0.4)


def test_normalize_core_mode_params_uses_default_group_when_all_zero() -> None:
    params = normalize_core_mode_params(
        {
            "weighted_technical_weight": 0,
            "weighted_institutional_weight": 0,
            "weighted_news_weight": 0,
            "weighted_momentum_weight": 0,
        }
    )

    assert params.weighted_technical_weight == pytest.approx(0.38)
    assert params.weighted_institutional_weight == pytest.approx(0.30)
    assert params.weighted_news_weight == pytest.approx(0.15)
    assert params.weighted_momentum_weight == pytest.approx(0.17)


def test_normalize_shape_weights_uses_default_group_when_all_zero() -> None:
    params = normalize_core_mode_params(
        {
            "shape_breakout_weight": 0,
            "shape_slope_weight": 0,
            "shape_efficiency_weight": 0,
            "shape_pullback_weight": 0,
        }
    )

    assert params.shape_breakout_weight == pytest.approx(0.35)
    assert params.shape_slope_weight == pytest.approx(0.25)
    assert params.shape_efficiency_weight == pytest.approx(0.25)
    assert params.shape_pullback_weight == pytest.approx(0.15)


def test_core_mode_run_request_rejects_negative_weights() -> None:
    with pytest.raises(ValidationError):
        CoreModeRunRequest.model_validate(
            {
                "symbol": "2330",
                "date_range": {"start_date": "2024-01-01", "end_date": "2024-06-01"},
                "params": {
                    "weighted_technical_weight": -0.1,
                },
            }
        )

    with pytest.raises(ValidationError):
        CoreModeRunRequest.model_validate(
            {
                "symbol": "2330",
                "date_range": {"start_date": "2024-01-01", "end_date": "2024-06-01"},
                "params": {
                    "shape_breakout_weight": -0.1,
                },
            }
        )


def test_service_save_preset_accepts_core_mode_params_input(tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")

    params_model = CoreModeParamsInput(breakout_lookback=30, momentum_window=20)
    result = service.save_preset(
        name="Model Params Preset",
        description="",
        params=params_model,  # type: ignore[arg-type]
    )

    created = next((item for item in result["presets"] if item["name"] == "Model Params Preset"), None)
    assert created is not None
    assert created["params"]["breakout_lookback"] == 30
    assert created["params"]["momentum_window"] == 20


def test_default_weights_match_legacy_formulas() -> None:
    params = normalize_core_mode_params({})
    rows = _make_market_rows(30)

    features = compute_feature_rows(rows, params)
    scores = compute_score_rows(rows, features, params)

    feature = features[-1]
    score = scores[-1]

    legacy_weighted = (
        (0.38 * feature.technical_score)
        + (0.30 * feature.institutional_score)
        + (0.15 * feature.news_score)
        + (0.17 * feature.momentum_score)
    )
    legacy_state = (
        (0.55 * feature.weighted_score)
        + (0.25 * feature.momentum_score)
        + (0.20 * feature.institutional_score)
    )
    legacy_trend = (
        (0.45 * score.state_score)
        + (0.35 * score.trend_shape_score)
        + (0.20 * feature.breakout_strength)
    )

    assert feature.weighted_score == pytest.approx(legacy_weighted, abs=1e-6)
    assert score.state_score == pytest.approx(legacy_state, abs=1e-6)
    assert score.trend_score == pytest.approx(legacy_trend, abs=1e-6)


def test_default_shape_weights_match_legacy_formula() -> None:
    params = normalize_core_mode_params({})
    rows = _make_market_rows(30)

    features = compute_feature_rows(rows, params)
    scores = compute_score_rows(rows, features, params)

    feature = features[-1]
    score = scores[-1]
    ma_slope = (rows[-1].ma20 - rows[-6].ma20) / rows[-6].ma20  # type: ignore[operator]
    slope_score = max(-1.0, min(1.0, ma_slope / 0.03))
    pullback_score = max(-1.0, min(1.0, 1.0 - (feature.pullback_depth / max(params.max_pullback_depth, 1e-6))))
    efficiency_score = max(-1.0, min(1.0, (feature.trend_efficiency - 0.5) / 0.5))
    legacy_shape = (
        (0.35 * feature.breakout_strength)
        + (0.25 * slope_score)
        + (0.25 * efficiency_score)
        + (0.15 * pullback_score)
    )
    legacy_shape = max(-1.0, min(1.0, legacy_shape))

    assert score.trend_shape_score == pytest.approx(legacy_shape, abs=1e-6)


def test_preset_store_backfills_weight_fields_for_legacy_preset(tmp_path) -> None:
    preset_path = tmp_path / "core_mode_presets.json"
    preset_path.write_text(
        json.dumps(
            {
                "active_preset_id": "legacy",
                "presets": [
                    {
                        "id": "legacy",
                        "name": "Legacy",
                        "description": "",
                        "category": "自訂",
                        "params": {
                            "breakout_lookback": 30,
                            "momentum_window": 20,
                            "state_threshold": 0.15,
                            "shape_threshold": 0.15,
                            "trend_threshold": 0.18,
                            "max_pullback_depth": 0.12,
                            "hard_stop_pct": 0.08,
                            "trailing_stop_pct": 0.1,
                        },
                        "source": "user",
                        "created_at": "2026-01-01T00:00:00+00:00",
                        "updated_at": "2026-01-01T00:00:00+00:00",
                    }
                ],
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    store = CoreModePresetStore(preset_path)
    listed = store.list_presets()
    params = listed["active_preset"]["params"]

    assert "weighted_technical_weight" in params
    assert params["weighted_technical_weight"] == pytest.approx(0.38)
    assert params["shape_breakout_weight"] == pytest.approx(0.35)
    assert params["shape_slope_weight"] == pytest.approx(0.25)
    assert params["shape_efficiency_weight"] == pytest.approx(0.25)
    assert params["shape_pullback_weight"] == pytest.approx(0.15)


def test_weighted_profile_candidates_keep_distinct_profiles() -> None:
    base = normalize_core_mode_params({})

    candidates = _build_weighted_profile_candidates([base])
    weighted_groups = {
        (
            item.weighted_technical_weight,
            item.weighted_institutional_weight,
            item.weighted_news_weight,
            item.weighted_momentum_weight,
        )
        for item in candidates
    }

    assert len(candidates) == 6
    assert len(weighted_groups) == 6


def test_dedupe_params_distinguishes_shape_weight_variants() -> None:
    base = normalize_core_mode_params({})
    variant = normalize_core_mode_params(
        {
            **base.__dict__,
            "shape_breakout_weight": 0.50,
            "shape_slope_weight": 0.20,
            "shape_efficiency_weight": 0.20,
            "shape_pullback_weight": 0.10,
        }
    )

    deduped = _dedupe_params([base, variant, base])
    assert len(deduped) == 2


def test_run_core_mode_adds_news_warning_and_ml_validation_payload(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "presets.json")

    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(120))

    result = service.run_core_mode(
        {
            "symbol": "2330",
            "date_range": {
                "start_date": "2024-01-01",
                "end_date": "2024-04-29",
            },
            "params": {},
            "run_optimization": False,
            "ml_settings": {"enabled": True},
        }
    )

    warnings = result["warnings"]
    assert any("news_score 在本次資料窗中皆為 0" in item for item in warnings)
    assert result["ml_validation"]["enabled"] is True
    assert result["ml_validation"]["mode"] == "time_series_split_rule_based"
    assert isinstance(result["ml_validation"]["fold_metrics"], list)
