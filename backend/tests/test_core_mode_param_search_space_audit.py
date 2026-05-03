from __future__ import annotations

import json
from datetime import date, timedelta

from scripts.audit_core_mode_param_search_space import (
    analyze_boundary_hits,
    build_heatmap_matrix,
    build_parameter_inventory,
    compute_strategy_quality_score,
    generate_audit_report,
    normalize_top_candidates_payload,
    run_sensitivity_analysis,
    write_report_files,
)
from trend_core.core_mode_types import MarketRow, normalize_core_mode_params


def _rows(count: int = 80) -> list[MarketRow]:
    start = date(2024, 1, 1)
    out: list[MarketRow] = []
    for i in range(count):
        close = 100 + i * 0.2
        out.append(
            MarketRow(
                date=start + timedelta(days=i),
                open=close - 0.3,
                high=close + 0.6,
                low=close - 0.7,
                close=close,
                volume=1_000_000 + i * 1000,
                ma5=close - 0.1,
                ma20=close - 0.5,
                ma60=close - 1.1,
                rsi14=55,
                k_value=57,
                d_value=54,
                macd=0.4,
                macd_signal=0.2,
                macd_hist=0.2,
                total_net=1200,
                news_score=0.0,
            )
        )
    return out


def _candidates() -> list[dict]:
    return [
        {
            "rank": 1,
            "params": {"breakout_lookback": 90, "momentum_window": 20, "state_threshold": 0.15},
            "validation_score": 0.72,
            "final_holdout_score": 0.51,
            "summary": {
                "ac": 0.73,
                "profit_factor": 1.5,
                "cumulative_return": 0.21,
                "max_drawdown": 0.12,
                "trade_count": 20,
                "stability_score": 0.7,
            },
        },
        {
            "rank": 2,
            "params": {"breakout_lookback": 88, "momentum_window": 19, "state_threshold": 0.14},
            "validation_score": 0.68,
            "final_holdout_score": 0.55,
            "summary": {
                "ac": 0.69,
                "profit_factor": 1.3,
                "cumulative_return": 0.18,
                "max_drawdown": 0.1,
                "trade_count": 16,
                "stability_score": 0.66,
            },
        },
    ]


def test_inventory_includes_core_weight_and_search_settings() -> None:
    inventory = build_parameter_inventory()
    names = {item["name"] for item in inventory}
    assert "breakout_lookback" in names
    assert "weighted_technical_weight" in names
    assert "candidate_pool_size" in names
    assert "train_ratio" in names


def test_boundary_analysis_detects_upper_bound_bias() -> None:
    result = analyze_boundary_hits(_candidates())
    by_param = {row["parameter"]: row for row in result}
    assert by_param["breakout_lookback"]["top_candidates_near_max_pct"] >= 0.5


def test_sensitivity_analysis_changes_one_parameter() -> None:
    base_params = normalize_core_mode_params({})
    report = run_sensitivity_analysis(
        rows=_rows(),
        base_params=base_params,
        parameter_name="state_threshold",
        test_values=[0.12, 0.15, 0.18],
        validation_score_lookup={"0.12": 0.61, "0.15": 0.66, "0.18": 0.64},
        final_holdout_score_lookup={"0.12": 0.6, "0.15": 0.58, "0.18": 0.55},
    )
    assert report["parameter"] == "state_threshold"
    assert len(report["tests"]) == 3
    assert report["tests"][1]["generalization_gap"] == 0.08


def test_strategy_quality_score_and_gap_are_reported_not_ranking_input() -> None:
    score = compute_strategy_quality_score(
        ac=0.7,
        profit_factor=1.6,
        max_drawdown=0.12,
        stability_score=0.68,
        validation_score=0.71,
        trade_count=20,
    )
    assert 0.0 <= score <= 1.0
    matrix = build_heatmap_matrix(_candidates())
    assert matrix[0]["generalization_gap"] == 0.21
    assert matrix[0]["validation_score"] >= matrix[1]["validation_score"]


def test_report_json_and_markdown_generation(tmp_path) -> None:
    report = generate_audit_report(top_candidates=_candidates(), inventory=build_parameter_inventory())
    json_path, md_path = write_report_files(report, output_dir=tmp_path, symbol="2330")
    payload = json.loads(json_path.read_text(encoding="utf-8-sig"))
    assert payload["notes"][1].startswith("final_holdout_score is observation only")
    assert md_path.read_text(encoding="utf-8-sig").startswith("# Core Mode Parameter Search Space Audit Summary")


def test_normalize_top_candidates_payload_supports_runs_and_prefers_formal_metrics() -> None:
    payload = {
        "symbol": "2330",
        "runs": [
            {
                "goal": "balanced",
                "score_mode": "balanced_score",
                "rank": 1,
                "params": {"breakout_lookback": 31, "momentum_window": 16},
                "auto_search": {
                    "validation_score": 0.7,
                    "final_holdout_score": 0.5,
                    "summary": {
                        "ac": 0.61,
                        "cumulative_return": 0.12,
                        "max_drawdown": 0.2,
                        "stability_score": 0.5,
                        "trade_count": 8,
                        "profit_factor": 1.1,
                    },
                },
                "formal_backtest": {
                    "summary": {
                        "ac": 0.76,
                        "cumulative_return": 0.32,
                        "max_drawdown": 0.1,
                        "stability_score": 0.72,
                        "trade_count": 20,
                        "profit_factor": 1.9,
                    }
                },
            }
        ],
    }
    normalized = normalize_top_candidates_payload(payload)
    assert len(normalized) == 1
    summary = normalized[0]["summary"]
    assert summary["cumulative_return"] == 0.32
    assert summary["max_drawdown"] == 0.1
