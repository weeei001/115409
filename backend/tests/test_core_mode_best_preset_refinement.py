from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

from scripts.refine_core_mode_best_preset import (
    RefinementOptions,
    build_options_from_args,
    compute_selection_score,
    generate_local_candidates,
    load_preset_by_name,
    parse_bool,
    resolve_seed_values,
    run_refinement,
)


class FakeRefinementService:
    def __init__(self, *, mode: str = "flat", include_duplicate_improved_name: bool = False) -> None:
        self.mode = mode
        self.calls: list[dict] = []
        self.saved_presets: list[dict] = []
        self.activated = False
        self._presets = [
            {
                "id": "active-1",
                "name": "active",
                "params": {"breakout_lookback": 70, "momentum_window": 40},
                "source": "system",
                "created_at": "2026-01-01T00:00:00+00:00",
                "updated_at": "2026-01-01T00:00:00+00:00",
            },
            {
                "id": "user-old-best",
                "name": "最佳",
                "params": {"breakout_lookback": 24, "momentum_window": 16},
                "source": "user",
                "created_at": "2026-03-01T00:00:00+00:00",
                "updated_at": "2026-03-01T00:00:00+00:00",
            },
            {
                "id": "user-new-best",
                "name": "最佳",
                "params": {"breakout_lookback": 30, "momentum_window": 20},
                "source": "user",
                "created_at": "2026-05-01T00:00:00+00:00",
                "updated_at": "2026-05-02T00:00:00+00:00",
            },
        ]
        if include_duplicate_improved_name:
            self._presets.append(
                {
                    "id": "user-improved-existing",
                    "name": "最佳_v2",
                    "params": {"breakout_lookback": 31, "momentum_window": 20},
                    "source": "user",
                    "created_at": "2026-05-03T00:00:00+00:00",
                    "updated_at": "2026-05-03T00:00:00+00:00",
                }
            )

    def get_presets(self) -> dict:
        return {
            "active_preset_id": "active-1",
            "active_preset": self._presets[0],
            "presets": deepcopy(self._presets),
        }

    def save_preset(self, *, name: str, description: str, params: dict, preset_id=None) -> dict:  # type: ignore[no-untyped-def]
        self.saved_presets.append({"name": name, "description": description, "params": deepcopy(params)})
        self._presets.append(
            {
                "id": f"user-{len(self._presets)}",
                "name": name,
                "params": deepcopy(params),
                "source": "user",
                "created_at": "2026-05-03T01:00:00+00:00",
                "updated_at": "2026-05-03T01:00:00+00:00",
            }
        )
        return self.get_presets()

    def activate_preset(self, preset_id: str) -> dict:  # pragma: no cover - defensive only
        self.activated = True
        return self.get_presets()

    def run_core_mode(self, request: dict) -> dict:  # type: ignore[no-untyped-def]
        self.calls.append(deepcopy(request))
        params = request.get("params") or {}
        breakout = int(params.get("breakout_lookback", 30))
        momentum = int(params.get("momentum_window", 20))

        base_summary = {
            "ac": 0.62,
            "cumulative_return": 0.23,
            "max_drawdown": 0.12,
            "stability": 0.90,
            "win_rate": 0.57,
            "trade_count": 15,
            "profit_factor": 1.8,
        }
        improved_summary = {
            "ac": 0.70,
            "cumulative_return": 0.30,
            "max_drawdown": 0.10,
            "stability": 0.92,
            "win_rate": 0.60,
            "trade_count": 16,
            "profit_factor": 2.2,
        }

        if self.mode == "improve" and breakout == 31 and momentum == 20:
            summary = improved_summary
        elif self.mode == "small_improve" and breakout == 31 and momentum == 20:
            summary = {
                "ac": 0.63,
                "cumulative_return": 0.24,
                "max_drawdown": 0.119,
                "stability": 0.901,
                "win_rate": 0.575,
                "trade_count": 15,
                "profit_factor": 1.81,
            }
        elif self.mode == "conservative_improve" and breakout == 31 and momentum == 20:
            summary = {
                "ac": 0.62,
                "cumulative_return": 0.20,
                "max_drawdown": 0.114,
                "stability": 0.901,
                "win_rate": 0.57,
                "trade_count": 15,
                "profit_factor": 1.81,
            }
        elif self.mode == "low_trade_improve" and breakout == 31 and momentum == 20:
            summary = {
                **improved_summary,
                "trade_count": 8,
                "profit_factor": 2.2,
            }
        elif self.mode == "error_one" and breakout == 26:
            raise RuntimeError("forced failure for one candidate")
        else:
            summary = base_summary

        holdout_summary = {
            "ac": 0.58,
            "trade_count": 6,
            "max_drawdown": 0.11,
        }
        return {
            "summary": summary,
            "warnings": [],
            "walk_forward": {"holdout": holdout_summary},
        }


def _options(tmp_path: Path, **overrides: object) -> RefinementOptions:
    base = RefinementOptions(
        preset_name="最佳",
        symbol="2330",
        start_date="2024-02-23",
        end_date="2026-05-03",
        mode="single_stock_search",
        refinement_level="medium",
        max_candidates=40,
        formal_backtest_top_k=20,
        save_improved_preset=True,
        improved_preset_name="最佳_v2",
        dry_run=False,
        output_dir=tmp_path,
        preset_store_path=tmp_path / "core_mode_presets.json",
        seed=42,
        seeds=None,
        seed_start=None,
        seed_end=None,
        seed_step=1,
        save_each_improved=False,
        stop_on_first_improvement=False,
        min_improvement=0.015,
        allow_conservative_variant=False,
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_load_preset_by_name_selects_newest_duplicate() -> None:
    service = FakeRefinementService()
    preset = load_preset_by_name(service, "最佳")
    assert preset["id"] == "user-new-best"
    assert preset["params"]["breakout_lookback"] == 30


def test_load_preset_by_name_not_found_raises_clear_error() -> None:
    service = FakeRefinementService()
    with pytest.raises(ValueError, match='Preset named "不存在" was not found.'):
        load_preset_by_name(service, "不存在")


def test_generate_local_candidates_contains_base_and_variations() -> None:
    candidates = generate_local_candidates(
        {"breakout_lookback": 30, "momentum_window": 20},
        refinement_level="medium",
        max_candidates=50,
        seed=42,
    )
    assert candidates[0]["candidate_id"] == "BASE"
    assert len(candidates) > 1
    assert any("one_param:breakout_lookback" in item.get("source_tags", []) for item in candidates)
    assert any("paired:breakout_momentum" in item.get("source_tags", []) for item in candidates)


def test_generate_local_candidates_seed_changes_random_jitter() -> None:
    base = {"breakout_lookback": 30, "momentum_window": 20}
    seed_7 = generate_local_candidates(base, refinement_level="medium", max_candidates=300, seed=7)
    seed_42 = generate_local_candidates(base, refinement_level="medium", max_candidates=300, seed=42)
    assert seed_7 != seed_42


def test_resolve_seed_values_precedence() -> None:
    options = RefinementOptions(
        preset_name="最佳",
        symbol="2330",
        start_date="2024-02-23",
        end_date="2026-05-03",
        seed=5,
        seeds=[7, 13, 21],
        seed_start=1,
        seed_end=9,
        seed_step=2,
    )
    assert resolve_seed_values(options) == [7, 13, 21]

    options.seeds = None
    assert resolve_seed_values(options) == [1, 3, 5, 7, 9]

    options.seed_start = None
    options.seed_end = None
    assert resolve_seed_values(options) == [5]


def test_run_refinement_formal_backtest_uses_candidate_params_not_active_and_disables_auto_search(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="flat")
    result = run_refinement(
        _options(tmp_path, max_candidates=8, formal_backtest_top_k=5, save_improved_preset=False),
        service=service,
    )

    assert result["recommendation"] == "keep_current"
    assert len(service.calls) == 5
    assert service.calls[0]["params"]["breakout_lookback"] == 30
    assert service.calls[0]["params"]["breakout_lookback"] != 70
    for call in service.calls:
        assert call["run_optimization"] is False
        assert (call.get("auto_search_settings") or {}).get("enabled") is False


def test_selection_score_not_affected_by_final_holdout_fields() -> None:
    score_a = compute_selection_score(
        ac=0.62,
        cumulative_return=0.23,
        max_drawdown=0.12,
        stability_score=0.90,
        trade_count=15,
        profit_factor=1.8,
    )
    score_b = compute_selection_score(
        ac=0.62,
        cumulative_return=0.23,
        max_drawdown=0.12,
        stability_score=0.90,
        trade_count=15,
        profit_factor=1.8,
    )
    assert score_a == score_b


def test_hard_filter_rejects_low_trade_count_candidate(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="low_trade_improve")
    result = run_refinement(
        _options(tmp_path, max_candidates=20, formal_backtest_top_k=20, save_improved_preset=True),
        service=service,
    )
    assert result["recommendation"] == "keep_current"
    assert service.saved_presets == []


def test_no_meaningful_improvement_does_not_save_preset(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="flat")
    result = run_refinement(_options(tmp_path), service=service)
    assert result["recommendation"] == "keep_current"
    assert result["saved_preset_name"] is None
    assert service.saved_presets == []


def test_meaningful_improvement_saves_improved_preset(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="improve")
    result = run_refinement(_options(tmp_path), service=service)
    assert result["recommendation"] == "save_improved"
    assert result["saved_preset_name"] == "最佳_v2"
    assert len(service.saved_presets) == 1
    assert service.saved_presets[0]["name"] == "最佳_v2"


def test_duplicate_improved_preset_name_gets_seed_suffix(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="improve", include_duplicate_improved_name=True)
    result = run_refinement(_options(tmp_path), service=service)
    assert result["recommendation"] == "save_improved"
    assert (result["saved_preset_name"] or "").startswith("最佳_v2_seed42")


def test_multi_seed_default_saves_only_global_best(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import refine_core_mode_best_preset as mod

    seed_calls: list[int] = []

    def fake_generate(base_params: dict, *, refinement_level: str, max_candidates: int, seed: int) -> list[dict]:
        seed_calls.append(seed)
        base = deepcopy(base_params)
        improved = deepcopy(base_params)
        improved["breakout_lookback"] = 30 + seed
        improved["momentum_window"] = 20
        return [
            {"candidate_id": "BASE", "params": base, "source_tags": ["base"]},
            {"candidate_id": "C001", "params": improved, "source_tags": [f"seed:{seed}"]},
        ]

    monkeypatch.setattr(mod, "generate_local_candidates", fake_generate)

    service = FakeRefinementService(mode="flat")

    def seed_ranked_run_core_mode(request: dict) -> dict:
        params = request.get("params") or {}
        breakout = int(params.get("breakout_lookback", 30))
        delta = max(0, breakout - 30)
        summary = {
            "ac": 0.62 + (delta * 0.01),
            "cumulative_return": 0.23 + (delta * 0.01),
            "max_drawdown": 0.12 - (delta * 0.002),
            "stability": 0.90 + (delta * 0.002),
            "win_rate": 0.57,
            "trade_count": 15,
            "profit_factor": 1.8 + (delta * 0.04),
        }
        return {
            "summary": summary,
            "warnings": [],
            "walk_forward": {"holdout": {"trade_count": 6, "max_drawdown": 0.11}},
        }

    service.run_core_mode = seed_ranked_run_core_mode  # type: ignore[assignment]
    result = run_refinement(
        _options(
            tmp_path,
            seeds=[7, 13, 21],
            max_candidates=2,
            formal_backtest_top_k=2,
            save_each_improved=False,
            stop_on_first_improvement=False,
        ),
        service=service,
    )
    assert seed_calls == [7, 13, 21]
    assert result["seed_mode"] == "multi"
    assert [item["seed"] for item in result["seed_results"]] == [7, 13, 21]
    assert len(service.saved_presets) == 1
    assert service.saved_presets[0]["params"]["breakout_lookback"] == 51
    assert result["saved_preset_name"] == "最佳_v2"
    assert result["global_best_candidate"]["seed"] == 21


def test_save_each_improved_saves_every_seed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import refine_core_mode_best_preset as mod

    def fake_generate(base_params: dict, *, refinement_level: str, max_candidates: int, seed: int) -> list[dict]:
        base = deepcopy(base_params)
        improved = deepcopy(base_params)
        improved["breakout_lookback"] = 30 + seed
        improved["momentum_window"] = 20
        return [
            {"candidate_id": "BASE", "params": base, "source_tags": ["base"]},
            {"candidate_id": "C001", "params": improved, "source_tags": [f"seed:{seed}"]},
        ]

    monkeypatch.setattr(mod, "generate_local_candidates", fake_generate)

    service = FakeRefinementService(mode="flat")

    def seed_ranked_run_core_mode(request: dict) -> dict:
        params = request.get("params") or {}
        breakout = int(params.get("breakout_lookback", 30))
        delta = max(0, breakout - 30)
        summary = {
            "ac": 0.62 + (delta * 0.01),
            "cumulative_return": 0.23 + (delta * 0.01),
            "max_drawdown": 0.12 - (delta * 0.002),
            "stability": 0.90 + (delta * 0.002),
            "win_rate": 0.57,
            "trade_count": 15,
            "profit_factor": 1.8 + (delta * 0.04),
        }
        return {
            "summary": summary,
            "warnings": [],
            "walk_forward": {"holdout": {"trade_count": 6, "max_drawdown": 0.11}},
        }

    service.run_core_mode = seed_ranked_run_core_mode  # type: ignore[assignment]
    result = run_refinement(
        _options(
            tmp_path,
            seeds=[7, 13, 21],
            max_candidates=2,
            formal_backtest_top_k=2,
            save_each_improved=True,
        ),
        service=service,
    )
    assert result["recommendation"] == "save_improved"
    assert len(service.saved_presets) == 3
    assert {item["name"] for item in service.saved_presets} == {"最佳_v2_seed7", "最佳_v2_seed13", "最佳_v2_seed21"}


def test_stop_on_first_improvement_stops_seed_loop(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import refine_core_mode_best_preset as mod

    seed_calls: list[int] = []

    def fake_generate(base_params: dict, *, refinement_level: str, max_candidates: int, seed: int) -> list[dict]:
        seed_calls.append(seed)
        base = deepcopy(base_params)
        improved = deepcopy(base_params)
        improved["breakout_lookback"] = 31
        improved["momentum_window"] = 20
        return [
            {"candidate_id": "BASE", "params": base, "source_tags": ["base"]},
            {"candidate_id": "C001", "params": improved, "source_tags": [f"seed:{seed}"]},
        ]

    monkeypatch.setattr(mod, "generate_local_candidates", fake_generate)

    service = FakeRefinementService(mode="improve")
    result = run_refinement(
        _options(
            tmp_path,
            seeds=[7, 13, 21],
            max_candidates=2,
            formal_backtest_top_k=2,
            stop_on_first_improvement=True,
        ),
        service=service,
    )
    assert result["recommendation"] == "save_improved"
    assert seed_calls == [7]
    assert len(result["seed_results"]) == 1


def test_min_improvement_threshold_controls_save(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="small_improve")
    keep_result = run_refinement(_options(tmp_path), service=service)
    assert keep_result["recommendation"] == "keep_current"
    assert keep_result["saved_preset_name"] is None

    service2 = FakeRefinementService(mode="small_improve")
    save_result = run_refinement(_options(tmp_path, min_improvement=0.005), service=service2)
    assert save_result["recommendation"] == "save_improved"
    assert save_result["saved_preset_name"] == "最佳_v2"


def test_allow_conservative_variant_can_save_when_enabled(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="conservative_improve")
    keep_result = run_refinement(_options(tmp_path), service=service)
    assert keep_result["recommendation"] == "keep_current"
    assert keep_result["saved_preset_name"] is None

    service2 = FakeRefinementService(mode="conservative_improve")
    save_result = run_refinement(_options(tmp_path, allow_conservative_variant=True), service=service2)
    assert save_result["recommendation"] == "save_conservative_variant"
    assert save_result["saved_preset_name"] == "最佳_保守版"


def test_refinement_never_activates_preset(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="improve")
    run_refinement(_options(tmp_path), service=service)
    assert service.activated is False


def test_reports_are_written_with_utf8_bom(tmp_path: Path) -> None:
    service = FakeRefinementService(mode="flat")
    result = run_refinement(_options(tmp_path, seeds=[7, 13, 21]), service=service)
    json_path = Path((result.get("report_paths") or {}).get("json", ""))
    md_path = Path((result.get("report_paths") or {}).get("markdown", ""))
    assert json_path.exists()
    assert md_path.exists()
    assert json_path.read_bytes().startswith(b"\xef\xbb\xbf")
    assert md_path.read_bytes().startswith(b"\xef\xbb\xbf")
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    assert payload["preset_name"] == "最佳"
    assert payload["seed_mode"] == "multi"
    assert payload["seed_results"]


@pytest.mark.parametrize("value", ["true", "false", "1", "0", "yes", "no", "y", "n"])
def test_parse_bool_accepts_required_values(value: str) -> None:
    parsed = parse_bool(value)
    assert isinstance(parsed, bool)


def test_parse_bool_rejects_invalid_value() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        parse_bool("maybe")


def test_build_options_normalizes_backend_relative_paths_when_cwd_is_backend(monkeypatch, tmp_path: Path) -> None:
    backend_dir = tmp_path / "backend"
    backend_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.chdir(backend_dir)
    args = SimpleNamespace(
        preset_name="最佳",
        symbol="2330",
        start_date="2024-02-23",
        end_date="2026-05-03",
        mode="single_stock_search",
        refinement_level="medium",
        max_candidates=120,
        formal_backtest_top_k=30,
        save_improved_preset=True,
        improved_preset_name="最佳_v2",
        dry_run=False,
        output_dir="backend/outputs/core_mode_refinement",
        preset_store_path="backend/data/core_mode_presets.json",
        seed=11,
        seeds="7,13,21",
        seed_start=1,
        seed_end=9,
        seed_step=2,
        save_each_improved=False,
        stop_on_first_improvement=False,
        min_improvement=0.015,
        allow_conservative_variant=False,
    )
    options = build_options_from_args(args)
    assert options.output_dir == Path("outputs/core_mode_refinement")
    assert options.preset_store_path == Path("data/core_mode_presets.json")
    assert options.seed == 11
    assert options.seeds == [7, 13, 21]
    assert options.seed_start == 1
    assert options.seed_end == 9
    assert options.seed_step == 2
