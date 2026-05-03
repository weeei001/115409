from __future__ import annotations

import json
from datetime import date, timedelta

from services.core_mode import CoreModeService
from trend_core.core_mode_types import MarketRow, normalize_auto_search_settings


def _make_market_rows(count: int, *, drift: float = 0.21) -> list[MarketRow]:
    start = date(2024, 1, 1)
    rows: list[MarketRow] = []
    for idx in range(count):
        base = 100.0 + (idx * drift)
        wave = ((idx % 9) - 4) * 0.5
        close = base + wave
        rows.append(
            MarketRow(
                date=start + timedelta(days=idx),
                open=close - 0.4,
                high=close + 0.7,
                low=close - 0.8,
                close=close,
                volume=1_000_000 + ((idx % 10) * 20_000),
                ma5=close - 0.6,
                ma20=close - 1.2,
                ma60=close - 2.0,
                rsi14=50.0 + ((idx % 7) - 3),
                k_value=54.0 + (idx % 8),
                d_value=51.0 + (idx % 6),
                macd=0.42 + ((idx % 4) * 0.08),
                macd_signal=0.33 + ((idx % 4) * 0.06),
                macd_hist=0.10 + ((idx % 5) * 0.03),
                total_net=900.0 + (((idx % 13) - 6) * 80.0),
                news_score=0.0,
            )
        )
    return rows


def _base_request() -> dict[str, object]:
    return {
        "symbol": "2330",
        "date_range": {"start_date": "2024-01-01", "end_date": "2024-10-31"},
        "params": {},
        "run_optimization": False,
        "ml_settings": {"enabled": False},
    }


def test_normalize_auto_search_settings_clamps_and_dedupes() -> None:
    settings = normalize_auto_search_settings(
        {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330", "2330", "2317", " "],
            "top_n": 999,
            "candidate_pool_size": 9999,
            "ml_prefilter_top_n": 2000,
            "final_verify_top_n": 1500,
            "min_trade_count": 0,
            "adaptive_search_settings": {
                "enabled": True,
                "max_iterations": 99,
                "candidates_per_iteration": 9999,
                "verify_top_n_per_iteration": 8888,
                "keep_elite_n": 7777,
                "patience": 0,
                "min_improvement": 9.9,
                "refinement_strength": "invalid",
                "stop_when_score_reaches": 9.0,
            },
        }
    )
    assert settings.top_n == 20
    assert settings.candidate_pool_size == 1000
    assert settings.ml_prefilter_top_n == 1000
    assert settings.final_verify_top_n == 1000
    assert settings.min_trade_count == 1
    assert settings.symbols == ("2330", "2317")
    assert settings.adaptive_search_settings.enabled is True
    assert settings.adaptive_search_settings.max_iterations == 10
    assert settings.adaptive_search_settings.candidates_per_iteration == 1000
    assert settings.adaptive_search_settings.verify_top_n_per_iteration == 1000
    assert settings.adaptive_search_settings.keep_elite_n == 1000
    assert settings.adaptive_search_settings.patience == 1
    assert settings.adaptive_search_settings.min_improvement == 0.1
    assert settings.adaptive_search_settings.refinement_strength == "medium"
    assert settings.adaptive_search_settings.stop_when_score_reaches == 1.0


def test_auto_search_disabled_returns_empty_payload(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(260))

    result = service.run_core_mode(_base_request())
    auto_search = result["auto_search_result"]
    assert auto_search["enabled"] is False
    assert auto_search["results"] == []
    assert auto_search["adaptive_trace"]["enabled"] is False


def test_single_stock_auto_search_ranks_by_verified_score(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(280))

    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330"],
            "top_n": 3,
            "candidate_pool_size": 80,
            "ml_prefilter_top_n": 8,
            "final_verify_top_n": 5,
            "use_ml_prefilter": True,
            "use_time_series_validation": True,
            "use_holdout_validation": True,
            "min_trade_count": 5,
        },
    }
    result = service.run_core_mode(request)
    auto_search = result["auto_search_result"]
    assert auto_search["enabled"] is True
    assert auto_search["ranking_basis"] == "verified_score"
    assert len(auto_search["results"]) <= 3
    if auto_search["results"]:
        row = auto_search["results"][0]
        assert row["verified_score"] is not None
        assert row["cross_stock_score"] is None
    scores = [float(item["verified_score"] or 0.0) for item in auto_search["results"]]
    assert scores == sorted(scores, reverse=True)


def test_multi_stock_auto_search_returns_cross_stock_score(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")

    def _load_market_rows(*, symbol: str, **_: object) -> list[MarketRow]:
        if symbol == "2330":
            return _make_market_rows(280, drift=0.23)
        if symbol == "2317":
            return _make_market_rows(280, drift=0.18)
        return _make_market_rows(60)

    monkeypatch.setattr(service, "_load_market_rows", _load_market_rows)

    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "multi_stock_search",
            "symbols": ["2330", "2317"],
            "top_n": 2,
            "candidate_pool_size": 70,
            "ml_prefilter_top_n": 6,
            "final_verify_top_n": 4,
            "use_ml_prefilter": False,
        },
    }
    result = service.run_core_mode(request)
    auto_search = result["auto_search_result"]
    assert auto_search["enabled"] is True
    assert auto_search["ranking_basis"] == "cross_stock_score"
    if auto_search["results"]:
        row = auto_search["results"][0]
        assert row["cross_stock_score"] is not None
        assert len(row["symbol_results"]) >= 2
    scores = [float(item["cross_stock_score"] or 0.0) for item in auto_search["results"]]
    assert scores == sorted(scores, reverse=True)


def test_auto_search_symbol_count_validation_returns_warning(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(260))

    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330", "2317"],
        },
    }
    result = service.run_core_mode(request)
    auto_search = result["auto_search_result"]
    assert auto_search["enabled"] is True
    assert auto_search["results"] == []
    assert any("single_stock_search" in item for item in auto_search["warnings"])


def test_auto_search_does_not_modify_preset_file(monkeypatch, tmp_path) -> None:
    preset_path = tmp_path / "core_mode_presets.json"
    service = CoreModeService(preset_store_path=preset_path)
    _ = service.preset_store.list_presets()
    before = preset_path.read_text(encoding="utf-8")
    before_obj = json.loads(before)
    before_active_id = before_obj["active_preset_id"]
    before_system_params = {
        item["id"]: item["params"]
        for item in before_obj["presets"]
        if item.get("source") == "system"
    }

    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(260))
    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330"],
            "top_n": 2,
            "candidate_pool_size": 60,
            "ml_prefilter_top_n": 6,
            "final_verify_top_n": 4,
            "use_ml_prefilter": False,
        },
    }
    _ = service.run_core_mode(request)

    after = preset_path.read_text(encoding="utf-8")
    after_obj = json.loads(after)
    after_system_params = {
        item["id"]: item["params"]
        for item in after_obj["presets"]
        if item.get("source") == "system"
    }
    assert before == after
    assert after_obj["active_preset_id"] == before_active_id
    assert after_system_params == before_system_params


def test_adaptive_auto_search_runs_multiple_iterations(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(300, drift=0.24))
    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330"],
            "top_n": 3,
            "use_ml_prefilter": False,
            "adaptive_search_settings": {
                "enabled": True,
                "max_iterations": 2,
                "candidates_per_iteration": 80,
                "verify_top_n_per_iteration": 20,
                "keep_elite_n": 5,
                "patience": 5,
                "min_improvement": 0.0,
                "refinement_strength": "small",
            },
        },
    }
    result = service.run_core_mode(request)
    auto_search = result["auto_search_result"]
    trace = auto_search["adaptive_trace"]
    assert trace["enabled"] is True
    assert trace["stop_reason"] == "max_iterations"
    assert len(trace["iterations"]) == 2
    assert trace["iterations"][1]["candidate_count"] > 0
    assert len(trace["best_score_progression"]) == len(trace["iterations"])
    if auto_search["results"]:
        scores = [float(item["verified_score"] or 0.0) for item in auto_search["results"]]
        assert scores == sorted(scores, reverse=True)


def test_adaptive_auto_search_patience_stop(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(280, drift=0.22))
    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330"],
            "top_n": 2,
            "use_ml_prefilter": False,
            "adaptive_search_settings": {
                "enabled": True,
                "max_iterations": 5,
                "candidates_per_iteration": 60,
                "verify_top_n_per_iteration": 10,
                "keep_elite_n": 3,
                "patience": 1,
                "min_improvement": 1.0,
                "refinement_strength": "medium",
            },
        },
    }
    result = service.run_core_mode(request)
    trace = result["auto_search_result"]["adaptive_trace"]
    assert trace["enabled"] is True
    assert trace["stop_reason"] == "patience"
    assert len(trace["iterations"]) <= 2


def test_adaptive_auto_search_score_target_stop(monkeypatch, tmp_path) -> None:
    service = CoreModeService(preset_store_path=tmp_path / "core_mode_presets.json")
    monkeypatch.setattr(service, "_load_market_rows", lambda **_: _make_market_rows(280, drift=0.20))
    request = {
        **_base_request(),
        "auto_search_settings": {
            "enabled": True,
            "mode": "single_stock_search",
            "symbols": ["2330"],
            "top_n": 2,
            "use_ml_prefilter": False,
            "adaptive_search_settings": {
                "enabled": True,
                "max_iterations": 4,
                "candidates_per_iteration": 60,
                "verify_top_n_per_iteration": 10,
                "keep_elite_n": 3,
                "patience": 2,
                "min_improvement": 0.01,
                "refinement_strength": "small",
                "stop_when_score_reaches": 0.0,
            },
        },
    }
    result = service.run_core_mode(request)
    trace = result["auto_search_result"]["adaptive_trace"]
    assert trace["enabled"] is True
    assert trace["stop_reason"] == "score_target_reached"
    assert len(trace["iterations"]) == 1
