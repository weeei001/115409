from __future__ import annotations

import argparse
import json
from pathlib import Path

import pytest

from scripts.find_core_mode_best_params import (
    BestParamsOptions,
    candidate_fingerprint,
    evaluate_candidates,
    parse_bool,
    run_best_params,
)


class FakeBestService:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.saved_presets: list[dict] = []
        self._existing_names: set[str] = {"2330_best_balanced_deep_20240101_20241231"}

    def get_presets(self) -> dict:
        presets = [
            {"id": "active-1", "name": "active", "source": "system"},
        ]
        for idx, name in enumerate(sorted(self._existing_names), start=1):
            presets.append({"id": f"user-{idx}", "name": name, "source": "user"})
        return {"active_preset": presets[0], "presets": presets}

    def save_preset(self, *, name: str, description: str, params: dict, preset_id=None) -> dict:  # type: ignore[no-untyped-def]
        self.saved_presets.append({"name": name, "description": description, "params": dict(params)})
        self._existing_names.add(name)
        return self.get_presets()

    def run_core_mode(self, request: dict) -> dict:  # type: ignore[no-untyped-def]
        self.calls.append(request)
        auto_search_enabled = bool((request.get("auto_search_settings") or {}).get("enabled"))
        if auto_search_enabled:
            score_mode = (request.get("auto_search_settings") or {}).get("score_mode")
            if score_mode == "balanced_score":
                return {
                    "auto_search_result": {
                        "results": [
                            {
                                "rank": 1,
                                "validation_score": 0.78,
                                "final_holdout_score": 0.41,
                                "params": {"breakout_lookback": 31, "momentum_window": 16},
                                "summary": {
                                    "ac": 0.71,
                                    "cumulative_return": 0.20,
                                    "max_drawdown": 0.13,
                                    "stability_score": 0.66,
                                    "trade_count": 12,
                                    "profit_factor": 1.6,
                                },
                                "source_tags": ["balanced"],
                            },
                            {
                                "rank": 2,
                                "validation_score": 0.74,
                                "final_holdout_score": 0.65,
                                "params": {"breakout_lookback": 29, "momentum_window": 18},
                                "summary": {
                                    "ac": 0.69,
                                    "cumulative_return": 0.17,
                                    "max_drawdown": 0.10,
                                    "stability_score": 0.68,
                                    "trade_count": 11,
                                    "profit_factor": 1.4,
                                },
                                "source_tags": ["balanced"],
                            },
                        ]
                    }
                }
            if score_mode == "return_score":
                return {
                    "auto_search_result": {
                        "results": [
                            {
                                "rank": 1,
                                "validation_score": 0.76,
                                "final_holdout_score": 0.52,
                                "params": {"momentum_window": 16, "breakout_lookback": 31},
                                "summary": {
                                    "ac": 0.70,
                                    "cumulative_return": 0.22,
                                    "max_drawdown": 0.14,
                                    "stability_score": 0.65,
                                    "trade_count": 13,
                                    "profit_factor": 1.55,
                                },
                                "source_tags": ["return"],
                            }
                        ]
                    }
                }
            if score_mode == "stable_score":
                return {
                    "auto_search_result": {
                        "results": [
                            {
                                "rank": 1,
                                "validation_score": 0.75,
                                "final_holdout_score": 0.66,
                                "params": {"breakout_lookback": 40, "momentum_window": 15},
                                "summary": {
                                    "ac": 0.7,
                                    "cumulative_return": 0.16,
                                    "max_drawdown": 0.09,
                                    "stability_score": 0.75,
                                    "trade_count": 14,
                                    "profit_factor": 1.5,
                                },
                                "source_tags": ["stable"],
                            }
                        ]
                    }
                }
            return {"auto_search_result": {"results": []}}

        params = request.get("params") or {}
        if params.get("breakout_lookback") == 31:
            return {
                "summary": {
                    "ac": 0.76,
                    "cumulative_return": 0.33,
                    "max_drawdown": 0.11,
                    "stability": 0.73,
                    "win_rate": 0.57,
                    "trade_count": 18,
                    "profit_factor": 1.9,
                },
                "trades": [1, 2, 3],
            }
        if params.get("breakout_lookback") == 40:
            return {
                "summary": {
                    "ac": 0.72,
                    "cumulative_return": 0.21,
                    "max_drawdown": 0.09,
                    "stability": 0.78,
                    "win_rate": 0.56,
                    "trade_count": 16,
                    "profit_factor": 1.6,
                },
                "trades": [1, 2],
            }
        raise RuntimeError("unexpected formal request")


def _options(tmp_path: Path, **overrides: object) -> BestParamsOptions:
    base = BestParamsOptions(
        symbol="2330",
        symbols=("2330",),
        mode="single_stock_search",
        start_date="2024-01-01",
        end_date="2024-12-31",
        goals=("balanced", "return", "stable"),
        search_quality="deep",
        adaptive=True,
        top_n=2,
        formal_backtest_top_k=1,
        save_best_preset=True,
        save_all_top1_presets=False,
        dry_run=False,
        output_dir=tmp_path,
        preset_store_path=tmp_path / "core_mode_presets.json",
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_candidate_fingerprint_is_deterministic_for_key_order() -> None:
    a = {"a": 1, "b": 2}
    b = {"b": 2, "a": 1}
    assert candidate_fingerprint(a) == candidate_fingerprint(b)


def test_evaluate_candidates_does_not_use_holdout_for_ranking() -> None:
    rows = evaluate_candidates(
        [
            {
                "goal": "balanced",
                "rank": 1,
                "score_mode": "balanced_score",
                "validation_score": 0.82,
                "final_holdout_score": 0.40,
                "summary": {
                    "ac": 0.7,
                    "cumulative_return": 0.25,
                    "max_drawdown": 0.1,
                    "stability_score": 0.7,
                    "trade_count": 15,
                    "profit_factor": 1.7,
                },
                "params": {"breakout_lookback": 30, "momentum_window": 16},
                "origins": [],
                "warnings": [],
                "formal_backtest": {"enabled": False, "success": False},
            },
            {
                "goal": "stable",
                "rank": 1,
                "score_mode": "stable_score",
                "validation_score": 0.70,
                "final_holdout_score": 0.90,
                "summary": {
                    "ac": 0.7,
                    "cumulative_return": 0.25,
                    "max_drawdown": 0.1,
                    "stability_score": 0.7,
                    "trade_count": 15,
                    "profit_factor": 1.7,
                },
                "params": {"breakout_lookback": 35, "momentum_window": 16},
                "origins": [],
                "warnings": [],
                "formal_backtest": {"enabled": False, "success": False},
            },
        ]
    )
    assert rows[0]["validation_score"] == 0.82
    assert rows[0]["final_holdout_score"] == 0.4


def test_evaluate_candidates_prefers_formal_backtest_metrics_when_available() -> None:
    rows = evaluate_candidates(
        [
            {
                "goal": "balanced",
                "rank": 1,
                "score_mode": "balanced_score",
                "validation_score": 0.75,
                "final_holdout_score": 0.6,
                "summary": {
                    "ac": 0.6,
                    "cumulative_return": 0.1,
                    "max_drawdown": 0.2,
                    "stability_score": 0.4,
                    "trade_count": 8,
                    "profit_factor": 1.1,
                },
                "params": {"breakout_lookback": 30, "momentum_window": 20},
                "origins": [],
                "warnings": [],
                "formal_backtest": {
                    "enabled": True,
                    "success": True,
                    "summary": {
                        "ac": 0.8,
                        "cumulative_return": 0.3,
                        "max_drawdown": 0.08,
                        "stability_score": 0.72,
                        "trade_count": 18,
                        "profit_factor": 1.9,
                    },
                },
            }
        ]
    )
    assert rows[0]["summary_metrics_source"] == "formal_backtest"
    assert rows[0]["cumulative_return"] == 0.3


def test_run_best_params_end_to_end_and_report_bom(tmp_path: Path) -> None:
    service = FakeBestService()
    result = run_best_params(_options(tmp_path), service=service)

    assert result["candidate_count"] == 3
    assert result["best"]["goal"] == "balanced"
    assert result["best"]["final_holdout_score"] == 0.41
    assert len(result["saved_presets"]) == 1
    assert len(service.saved_presets) == 1
    assert service.saved_presets[0]["name"].startswith("2330_best_balanced_deep_20240101_20241231_")

    report_paths = result["report_paths"]
    json_path = Path(report_paths["json"])
    md_path = Path(report_paths["markdown"])
    assert json_path.exists()
    assert md_path.exists()
    assert json_path.read_bytes().startswith(b"\xef\xbb\xbf")
    assert md_path.read_bytes().startswith(b"\xef\xbb\xbf")
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    assert payload["best"]["saved"] is True


def test_run_best_params_dry_run_does_not_save_presets(tmp_path: Path) -> None:
    service = FakeBestService()
    result = run_best_params(_options(tmp_path, dry_run=True), service=service)
    assert result["best"]["saved"] is False
    assert result["saved_presets"] == []
    assert service.saved_presets == []


@pytest.mark.parametrize("value", ["true", "false", "1", "0", "yes", "no", "y", "n"])
def test_parse_bool_accepts_common_values(value: str) -> None:
    parsed = parse_bool(value)
    assert isinstance(parsed, bool)


def test_parse_bool_rejects_invalid_value() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        parse_bool("maybe")
