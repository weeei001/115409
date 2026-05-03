from __future__ import annotations

import json
from pathlib import Path

from scripts.run_core_mode_deep_batch import BatchRunOptions, run_batch


class FakeService:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.saved_presets: list[dict] = []
        self.active_preset = {"id": "active-1", "name": "active"}

    def get_presets(self) -> dict:
        return {
            "active_preset": self.active_preset,
            "presets": [
                self.active_preset,
                {"id": "user-1", "name": "2330_deep_balanced_T1_20240101_20241231", "source": "user"},
            ],
        }

    def save_preset(self, *, name: str, description: str, params: dict, preset_id=None) -> dict:  # type: ignore[no-untyped-def]
        self.saved_presets.append({"name": name, "description": description, "params": dict(params)})
        return self.get_presets()

    def run_core_mode(self, request: dict) -> dict:  # type: ignore[no-untyped-def]
        self.calls.append(request)

        auto_search_enabled = bool((request.get("auto_search_settings") or {}).get("enabled"))
        if auto_search_enabled:
            score_mode = (request.get("auto_search_settings") or {}).get("score_mode")
            if score_mode == "return_score":
                raise RuntimeError("return goal failed")
            if score_mode == "stable_score":
                return {"auto_search_result": {"results": []}}
            return {
                "auto_search_result": {
                    "results": [
                        {
                            "rank": 1,
                            "validation_score": 0.66,
                            "final_holdout_score": 0.61,
                            "params": {
                                "breakout_lookback": 31,
                                "momentum_window": 16,
                            },
                            "summary": {
                                "ac": 0.71,
                                "cumulative_return": 0.22,
                                "max_drawdown": 0.08,
                                "stability_score": 0.65,
                                "trade_count": 7,
                                "profit_factor": 1.6,
                            },
                            "final_holdout_summary": {"cumulative_return": 0.2},
                            "source_tags": ["unit-test"],
                            "warnings": [],
                        }
                    ]
                }
            }

        params = request.get("params") or {}
        if request.get("symbol") == "2330" and params.get("breakout_lookback") == 31:
            if params.get("momentum_window") == 16:
                return {
                    "summary": {
                        "ac": 0.7,
                        "cumulative_return": 0.2,
                        "max_drawdown": 0.07,
                        "stability": 0.62,
                        "win_rate": 0.55,
                        "trade_count": 6,
                        "profit_factor": 1.5,
                    },
                    "trades": [1, 2, 3],
                    "price_chart": {"candles": [1, 2, 3, 4]},
                    "warnings": [],
                }
        raise RuntimeError("unexpected formal request")


def _options(tmp_path: Path, **overrides: object) -> BatchRunOptions:
    base = BatchRunOptions(
        symbol="2330",
        start_date="2024-01-01",
        end_date="2024-12-31",
        output_dir=tmp_path,
        preset_store_path=tmp_path / "core_mode_presets.json",
        goals=("balanced", "return", "stable", "low_drawdown"),
        run_formal_backtest=True,
        save_presets=True,
        dry_run=False,
    )
    for key, value in overrides.items():
        setattr(base, key, value)
    return base


def test_run_batch_runs_formal_with_top1_params_and_continues_on_failure(tmp_path: Path) -> None:
    service = FakeService()
    payload = run_batch(_options(tmp_path), service=service)

    goals = payload["goals"]
    assert len(goals) == 4

    balanced = goals[0]
    assert balanced["formal_backtest"]["success"] is True
    assert balanced["params"]["breakout_lookback"] == 31
    assert balanced["saved"] is True

    assert goals[1]["formal_backtest"]["success"] is False
    assert "return goal failed" in goals[1]["warnings"][0]
    assert goals[2]["formal_backtest"]["success"] is False
    assert "no ranked results" in goals[2]["warnings"][0]
    assert goals[3]["formal_backtest"]["success"] is True

    formal_calls = [c for c in service.calls if not bool((c.get("auto_search_settings") or {}).get("enabled"))]
    assert len(formal_calls) == 2
    for call in formal_calls:
        assert call["params"] == {"breakout_lookback": 31, "momentum_window": 16}
        assert call["run_optimization"] is False
        assert (call.get("auto_search_settings") or {}).get("enabled") is False

    assert len(service.saved_presets) == 2
    saved_names = [item["name"] for item in service.saved_presets]
    assert any(name.startswith("2330_deep_balanced_T1_20240101_20241231") for name in saved_names)

    report_paths = payload["report_paths"]
    json_path = Path(report_paths["json"])
    md_path = Path(report_paths["markdown"])
    assert json_path.exists()
    assert md_path.exists()

    report_obj = json.loads(json_path.read_text(encoding="utf-8-sig"))
    assert "formal_backtest" in report_obj["goals"][0]
    assert report_obj["goals"][0]["formal_backtest"]["success"] is True

    markdown_text = md_path.read_text(encoding="utf-8-sig")
    assert "Formal Backtest Confirmation" in markdown_text


def test_run_batch_respects_flags_dry_run_and_skip_formal(tmp_path: Path) -> None:
    service = FakeService()
    payload = run_batch(
        _options(
            tmp_path,
            run_formal_backtest=False,
            dry_run=True,
            save_presets=True,
            goals=("balanced",),
        ),
        service=service,
    )
    goal = payload["goals"][0]
    assert goal["saved"] is False
    assert goal["formal_backtest"]["enabled"] is False
    assert service.saved_presets == []

    assert len(service.calls) == 1
    assert bool((service.calls[0].get("auto_search_settings") or {}).get("enabled")) is True


class FakeServiceTopN(FakeService):
    def run_core_mode(self, request: dict) -> dict:  # type: ignore[no-untyped-def]
        self.calls.append(request)
        auto_search_enabled = bool((request.get("auto_search_settings") or {}).get("enabled"))
        if auto_search_enabled:
            return {
                "auto_search_result": {
                    "results": [
                        {
                            "rank": 1,
                            "validation_score": 0.71,
                            "final_holdout_score": 0.55,
                            "params": {"breakout_lookback": 31, "momentum_window": 16},
                            "summary": {
                                "ac": 0.72,
                                "cumulative_return": 0.24,
                                "max_drawdown": 0.09,
                                "stability_score": 0.68,
                                "trade_count": 9,
                                "profit_factor": 1.7,
                            },
                            "source_tags": ["unit-test"],
                        },
                        {
                            "rank": 2,
                            "validation_score": 0.69,
                            "final_holdout_score": 0.6,
                            "params": {"breakout_lookback": 29, "momentum_window": 18},
                            "summary": {
                                "ac": 0.7,
                                "cumulative_return": 0.2,
                                "max_drawdown": 0.08,
                                "stability_score": 0.66,
                                "trade_count": 8,
                                "profit_factor": 1.5,
                            },
                            "source_tags": ["unit-test"],
                        },
                    ]
                }
            }

        params = request.get("params") or {}
        if params.get("breakout_lookback") == 31:
            return {
                "summary": {
                    "ac": 0.73,
                    "cumulative_return": 0.26,
                    "max_drawdown": 0.08,
                    "stability": 0.69,
                    "win_rate": 0.57,
                    "trade_count": 9,
                    "profit_factor": 1.8,
                },
                "trades": [1, 2, 3],
                "price_chart": {"candles": [1, 2, 3]},
            }
        raise RuntimeError("unexpected formal request")


def test_run_batch_stores_top_candidates_and_limits_formal_backtest_top_k(tmp_path: Path) -> None:
    service = FakeServiceTopN()
    payload = run_batch(
        _options(
            tmp_path,
            goals=("balanced",),
            save_presets=False,
            top_n=2,
            formal_backtest_top_k=1,
        ),
        service=service,
    )
    goal = payload["goals"][0]
    assert len(goal["top_candidates"]) == 2
    assert goal["top_candidates"][0]["formal_backtest"]["success"] is True
    assert goal["top_candidates"][1]["formal_backtest"]["enabled"] is False
    assert goal["formal_backtest"]["success"] is True
