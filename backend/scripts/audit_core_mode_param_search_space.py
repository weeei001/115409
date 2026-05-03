from __future__ import annotations

import argparse
import json
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from trend_core.core_mode_auto_search import run_auto_parameter_search
from trend_core.core_mode_engine import run_core_mode_pipeline
from trend_core.core_mode_types import (
    CORE_MODE_PARAM_SCHEMA,
    CORE_MODE_WEIGHT_GROUPS,
    DEFAULT_AUTO_SEARCH_SETTINGS,
    DEFAULT_TIME_SERIES_ML_SETTINGS,
    AutoSearchSettings,
    CoreModeParams,
    MarketRow,
    TimeSeriesMLSettings,
    clip,
    normalize_auto_search_settings,
    normalize_core_mode_params,
    normalize_time_series_ml_settings,
    params_to_dict,
)
from trend_core.core_mode_validation import ValidationConfig


def build_parameter_inventory() -> list[dict[str, Any]]:
    category_by_key: dict[str, str] = {
        "breakout_lookback": "core_strategy",
        "momentum_window": "core_strategy",
        "state_threshold": "core_strategy",
        "shape_threshold": "core_strategy",
        "trend_threshold": "core_strategy",
        "max_pullback_depth": "core_strategy",
        "hard_stop_pct": "core_strategy",
        "trailing_stop_pct": "core_strategy",
    }
    for group_name, keys in CORE_MODE_WEIGHT_GROUPS.items():
        for key in keys:
            category_by_key[key] = f"weights.{group_name}"

    inventory: list[dict[str, Any]] = []
    for name, cfg in CORE_MODE_PARAM_SCHEMA.items():
        inventory.append(
            {
                "name": name,
                "category": category_by_key.get(name, "core"),
                "current_default": cfg.get("default"),
                "current_min": cfg.get("min"),
                "current_max": cfg.get("max"),
                "normalization_or_clamp": "normalize_core_mode_params -> schema min/max clamp; weights normalized by group sum",
                "where_defined": "trend_core/core_mode_types.py:CORE_MODE_PARAM_SCHEMA",
                "where_used": "trend_core/core_mode_engine.py, trend_core/core_mode_auto_search.py",
                "risk_if_too_low": "under-sensitive threshold/weight may generate noisy signals",
                "risk_if_too_high": "over-restrictive threshold/weight may reduce opportunity coverage",
            }
        )

    inventory.extend(
        [
            {
                "name": "future_quality_threshold",
                "category": "ml_ranking",
                "current_default": DEFAULT_TIME_SERIES_ML_SETTINGS.future_quality_threshold,
                "current_min": 0.0,
                "current_max": 1.0,
                "normalization_or_clamp": "normalize_time_series_ml_settings bounded float",
                "where_defined": "trend_core/core_mode_types.py:TimeSeriesMLSettings",
                "where_used": "trend_core/core_mode_ml.py",
                "risk_if_too_low": "label too loose",
                "risk_if_too_high": "label too strict",
            },
            {
                "name": "prediction_horizon",
                "category": "ml_ranking",
                "current_default": DEFAULT_TIME_SERIES_ML_SETTINGS.prediction_horizon,
                "current_min": 1,
                "current_max": None,
                "normalization_or_clamp": "normalize_time_series_ml_settings min=1",
                "where_defined": "trend_core/core_mode_types.py:TimeSeriesMLSettings",
                "where_used": "trend_core/core_mode_ml.py",
                "risk_if_too_low": "too short-term target",
                "risk_if_too_high": "target noise and sparse events",
            },
            {
                "name": "candidate_pool_size",
                "category": "auto_search",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.candidate_pool_size,
                "current_min": 50,
                "current_max": 1000,
                "normalization_or_clamp": "normalize_auto_search_settings bounded int",
                "where_defined": "trend_core/core_mode_types.py:AutoSearchSettings",
                "where_used": "trend_core/core_mode_auto_search.py",
                "risk_if_too_low": "insufficient exploration",
                "risk_if_too_high": "runtime cost and over-search risk",
            },
            {
                "name": "ml_prefilter_top_n",
                "category": "auto_search",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.ml_prefilter_top_n,
                "current_min": 1,
                "current_max": "candidate_pool_size",
                "normalization_or_clamp": "normalize_auto_search_settings clipped to candidate_pool_size",
                "where_defined": "trend_core/core_mode_types.py:AutoSearchSettings",
                "where_used": "trend_core/core_mode_auto_search.py",
                "risk_if_too_low": "good candidates filtered out",
                "risk_if_too_high": "weak prefilter utility",
            },
            {
                "name": "final_verify_top_n",
                "category": "auto_search",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.final_verify_top_n,
                "current_min": 1,
                "current_max": "ml_prefilter_top_n",
                "normalization_or_clamp": "normalize_auto_search_settings clipped to ml_prefilter_top_n",
                "where_defined": "trend_core/core_mode_types.py:AutoSearchSettings",
                "where_used": "trend_core/core_mode_auto_search.py",
                "risk_if_too_low": "insufficient final verification",
                "risk_if_too_high": "runtime increase",
            },
            {
                "name": "train_ratio",
                "category": "final_holdout",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.train_ratio,
                "current_min": 0.0,
                "current_max": 1.0,
                "normalization_or_clamp": "normalize_auto_search_settings bounded ratio",
                "where_defined": "trend_core/core_mode_types.py:FinalHoldoutSettings",
                "where_used": "trend_core/core_mode_splits.py",
                "risk_if_too_low": "insufficient train coverage",
                "risk_if_too_high": "validation/holdout too small",
            },
            {
                "name": "validation_ratio",
                "category": "final_holdout",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.validation_ratio,
                "current_min": 0.0,
                "current_max": 1.0,
                "normalization_or_clamp": "normalize_auto_search_settings bounded ratio",
                "where_defined": "trend_core/core_mode_types.py:FinalHoldoutSettings",
                "where_used": "trend_core/core_mode_splits.py",
                "risk_if_too_low": "weak ranking reliability",
                "risk_if_too_high": "less training history",
            },
            {
                "name": "final_holdout_ratio",
                "category": "final_holdout",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.final_holdout_ratio,
                "current_min": 0.0,
                "current_max": 1.0,
                "normalization_or_clamp": "normalize_auto_search_settings bounded ratio",
                "where_defined": "trend_core/core_mode_types.py:FinalHoldoutSettings",
                "where_used": "trend_core/core_mode_splits.py",
                "risk_if_too_low": "weak unknown-zone check",
                "risk_if_too_high": "ranking set too small",
            },
            {
                "name": "min_final_holdout_days",
                "category": "final_holdout",
                "current_default": DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.min_final_holdout_days,
                "current_min": 1,
                "current_max": None,
                "normalization_or_clamp": "normalize_auto_search_settings min=1",
                "where_defined": "trend_core/core_mode_types.py:FinalHoldoutSettings",
                "where_used": "trend_core/core_mode_splits.py",
                "risk_if_too_low": "unstable holdout statistics",
                "risk_if_too_high": "holdout may be unavailable",
            },
        ]
    )
    return inventory


def compute_strategy_quality_score(
    *,
    ac: float,
    profit_factor: float,
    max_drawdown: float,
    stability_score: float,
    validation_score: float,
    trade_count: int,
) -> float:
    ac_score = clip(ac, 0.0, 1.0)
    profit_factor_score = clip(profit_factor / 3.0, 0.0, 1.0)
    drawdown_score = clip(1.0 - (abs(max_drawdown) / 0.35), 0.0, 1.0)
    stable_score = clip(stability_score, 0.0, 1.0)
    valid_score = clip(validation_score, 0.0, 1.0)
    trade_count_score = clip(float(trade_count) / 30.0, 0.0, 1.0)
    return round(
        (0.20 * ac_score)
        + (0.20 * profit_factor_score)
        + (0.20 * drawdown_score)
        + (0.15 * stable_score)
        + (0.15 * valid_score)
        + (0.10 * trade_count_score),
        6,
    )


def analyze_boundary_hits(
    top_candidates: list[dict[str, Any]],
    *,
    boundary_tolerance_ratio: float = 0.05,
) -> list[dict[str, Any]]:
    if not top_candidates:
        return []
    analysis: list[dict[str, Any]] = []
    for name, cfg in CORE_MODE_PARAM_SCHEMA.items():
        min_v = float(cfg["min"])
        max_v = float(cfg["max"])
        span = max(max_v - min_v, 1e-9)
        values = [float((item.get("params") or {}).get(name, cfg["default"])) for item in top_candidates]
        near_min = sum(1 for value in values if (value - min_v) <= (span * boundary_tolerance_ratio))
        near_max = sum(1 for value in values if (max_v - value) <= (span * boundary_tolerance_ratio))
        value_std = 0.0
        avg = sum(values) / len(values)
        if len(values) > 1:
            value_std = (sum((value - avg) ** 2 for value in values) / len(values)) ** 0.5
        suggestion = "range appears healthy"
        if near_max / len(values) >= 0.5:
            suggestion = "consider expanding upper bound carefully"
        elif near_min / len(values) >= 0.5:
            suggestion = "consider lowering minimum bound carefully"
        elif value_std <= (span * 0.03):
            suggestion = "low variation; candidate influence may be limited"
        analysis.append(
            {
                "parameter": name,
                "min": min_v,
                "max": max_v,
                "top_candidates_near_min_pct": round(near_min / len(values), 6),
                "top_candidates_near_max_pct": round(near_max / len(values), 6),
                "variation_std": round(value_std, 6),
                "suggestion": suggestion,
                "risk": "range changes can increase overfitting if holdout quality degrades",
            }
        )
    return analysis


def run_sensitivity_analysis(
    *,
    rows: list[MarketRow],
    base_params: CoreModeParams,
    parameter_name: str,
    test_values: list[float | int],
    validation_score_lookup: dict[str, float] | None = None,
    final_holdout_score_lookup: dict[str, float] | None = None,
) -> dict[str, Any]:
    tests: list[dict[str, Any]] = []
    validation_score_lookup = validation_score_lookup or {}
    final_holdout_score_lookup = final_holdout_score_lookup or {}
    for value in test_values:
        raw = params_to_dict(base_params)
        raw[parameter_name] = value
        params = normalize_core_mode_params(raw)
        summary = run_core_mode_pipeline(rows, params)["summary"]
        validation_score = float(validation_score_lookup.get(str(value), clip(float(summary.ac), 0.0, 1.0)))
        final_holdout_score = final_holdout_score_lookup.get(str(value))
        generalization_gap = (
            round(validation_score - float(final_holdout_score), 6) if final_holdout_score is not None else None
        )
        tests.append(
            {
                "value": value,
                "validation_score": round(validation_score, 6),
                "final_holdout_score": round(float(final_holdout_score), 6) if final_holdout_score is not None else None,
                "generalization_gap": generalization_gap,
                "formal_backtest": {
                    "cumulative_return": round(float(summary.cumulative_return), 6),
                    "max_drawdown": round(float(summary.max_drawdown), 6),
                    "trade_count": int(summary.trade_count),
                    "profit_factor": round(float(summary.profit_factor), 6),
                    "stability_score": round(float(summary.stability), 6),
                },
            }
        )
    return {"base_params": params_to_dict(base_params), "parameter": parameter_name, "tests": tests}


def build_heatmap_matrix(top_candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in top_candidates:
        if not isinstance(item, dict):
            continue
        summary = item.get("summary") or {}
        validation_score = float(item.get("validation_score") or item.get("verified_score") or 0.0)
        final_holdout_score_raw = item.get("final_holdout_score")
        final_holdout_score = float(final_holdout_score_raw) if final_holdout_score_raw is not None else None
        generalization_gap = (
            round(validation_score - final_holdout_score, 6) if final_holdout_score is not None else None
        )
        strategy_quality_score = compute_strategy_quality_score(
            ac=float(summary.get("ac") or 0.0),
            profit_factor=float(summary.get("profit_factor") or 0.0),
            max_drawdown=float(summary.get("max_drawdown") or 0.0),
            stability_score=float(summary.get("stability_score") or 0.0),
            validation_score=validation_score,
            trade_count=int(summary.get("trade_count") or 0),
        )
        rows.append(
            {
                "rank": item.get("rank"),
                "name": item.get("preset_name") or f"candidate_{item.get('rank')}",
                "validation_score": round(validation_score, 6),
                "final_holdout_score": round(final_holdout_score, 6) if final_holdout_score is not None else None,
                "generalization_gap": generalization_gap,
                "cumulative_return": round(float(summary.get("cumulative_return") or 0.0), 6),
                "max_drawdown": round(float(summary.get("max_drawdown") or 0.0), 6),
                "stability_score": round(float(summary.get("stability_score") or 0.0), 6),
                "trade_count": int(summary.get("trade_count") or 0),
                "profit_factor": round(float(summary.get("profit_factor") or 0.0), 6),
                "strategy_quality_score": strategy_quality_score,
            }
        )
    return rows


def _merge_summary(
    *,
    formal_summary: dict[str, Any],
    auto_summary: dict[str, Any],
) -> dict[str, Any]:
    fields = (
        "ac",
        "cumulative_return",
        "max_drawdown",
        "stability_score",
        "win_rate",
        "trade_count",
        "profit_factor",
    )
    merged: dict[str, Any] = {}
    for key in fields:
        if key in formal_summary and formal_summary.get(key) is not None:
            merged[key] = formal_summary.get(key)
            continue
        # formal backtest payload may use "stability" key
        if key == "stability_score" and formal_summary.get("stability") is not None:
            merged[key] = formal_summary.get("stability")
            continue
        merged[key] = auto_summary.get(key)
    return merged


def _convert_run_like_item_to_candidates(item: dict[str, Any]) -> list[dict[str, Any]]:
    auto_search = item.get("auto_search") if isinstance(item.get("auto_search"), dict) else {}
    formal_backtest = item.get("formal_backtest") if isinstance(item.get("formal_backtest"), dict) else {}
    formal_summary = formal_backtest.get("summary") if isinstance(formal_backtest.get("summary"), dict) else {}
    auto_summary = auto_search.get("summary") if isinstance(auto_search.get("summary"), dict) else {}
    merged_summary = _merge_summary(formal_summary=formal_summary, auto_summary=auto_summary)

    def _build(raw_candidate: dict[str, Any]) -> dict[str, Any]:
        merged_from_top = _merge_summary(
            formal_summary=(
                raw_candidate.get("formal_backtest", {}).get("summary")
                if isinstance(raw_candidate.get("formal_backtest"), dict)
                else {}
            ),
            auto_summary=(raw_candidate.get("summary") if isinstance(raw_candidate.get("summary"), dict) else merged_summary),
        )
        return {
            "rank": raw_candidate.get("rank", item.get("rank")),
            "goal": item.get("goal"),
            "score_mode": item.get("score_mode"),
            "preset_name": item.get("preset_name"),
            "params": raw_candidate.get("params") if isinstance(raw_candidate.get("params"), dict) else (item.get("params") or {}),
            "summary": merged_from_top,
            "validation_score": raw_candidate.get("validation_score", auto_search.get("validation_score")),
            "final_holdout_score": raw_candidate.get("final_holdout_score", auto_search.get("final_holdout_score")),
            "final_holdout_summary": raw_candidate.get(
                "final_holdout_summary", auto_search.get("final_holdout_summary")
            ),
            "source_tags": list(raw_candidate.get("source_tags") or auto_search.get("source_tags") or []),
            "warnings": list(raw_candidate.get("warnings") or item.get("warnings") or []),
        }

    top_candidates = item.get("top_candidates")
    if isinstance(top_candidates, list) and top_candidates:
        out: list[dict[str, Any]] = []
        for candidate in top_candidates:
            if isinstance(candidate, dict):
                out.append(_build(candidate))
        if out:
            return out

    return [_build({"rank": item.get("rank"), "params": item.get("params")})]


def normalize_top_candidates_payload(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return payload

    if not isinstance(payload, dict):
        return []

    results = payload.get("results")
    if isinstance(results, list):
        return [item for item in results if isinstance(item, dict)]

    normalized: list[dict[str, Any]] = []
    for key in ("goals", "runs"):
        entries = payload.get(key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            normalized.extend(_convert_run_like_item_to_candidates(entry))
        if normalized:
            return normalized
    return []


def generate_audit_report(
    *,
    top_candidates: list[dict[str, Any]],
    inventory: list[dict[str, Any]],
) -> dict[str, Any]:
    heatmap_rows = build_heatmap_matrix(top_candidates)
    warnings: list[str] = []
    for row in heatmap_rows:
        gap = row.get("generalization_gap")
        if gap is not None and gap > 0.20:
            warnings.append(f"rank {row['rank']}: generalization_gap={gap} > 0.20")
        if row.get("trade_count", 0) < 10:
            warnings.append(f"rank {row['rank']}: trade_count below 10")
        if row.get("max_drawdown", 0.0) > 0.20:
            warnings.append(f"rank {row['rank']}: max_drawdown above 0.20")
        if row.get("profit_factor", 0.0) < 1.2:
            warnings.append(f"rank {row['rank']}: profit_factor below 1.2")
    return {
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "parameter_inventory": inventory,
        "boundary_analysis": analyze_boundary_hits(top_candidates),
        "heatmap_matrix": heatmap_rows,
        "warnings": sorted(set(warnings)),
        "notes": [
            "Ranking basis remains validation_score/verified_score only.",
            "final_holdout_score is observation only and not used for ranking.",
        ],
    }


def write_report_files(report: dict[str, Any], *, output_dir: Path, symbol: str) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"{stamp}_{symbol}_param_audit_summary.json"
    md_path = output_dir / f"{stamp}_{symbol}_param_audit_summary.md"

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8-sig")
    md_lines = [
        "# Core Mode Parameter Search Space Audit Summary",
        "",
        f"- generated_at: {report['generated_at']}",
        f"- candidate_count: {len(report.get('heatmap_matrix') or [])}",
        f"- warnings: {len(report.get('warnings') or [])}",
        "",
        "## Heatmap Matrix",
        "",
        "| rank | validation | holdout | gap | return | mdd | stability | trades | pf | quality |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in report.get("heatmap_matrix") or []:
        md_lines.append(
            f"| {row['rank']} | {row['validation_score']} | {row['final_holdout_score']} | {row['generalization_gap']} | {row['cumulative_return']} | {row['max_drawdown']} | {row['stability_score']} | {row['trade_count']} | {row['profit_factor']} | {row['strategy_quality_score']} |"
        )
    md_path.write_text("\n".join(md_lines) + "\n", encoding="utf-8-sig")
    return json_path, md_path


def run_audit_with_auto_search(
    *,
    rows_by_symbol: dict[str, list[MarketRow]],
    symbol: str,
    params: CoreModeParams,
    ml_settings: TimeSeriesMLSettings,
    auto_search_settings: AutoSearchSettings,
) -> dict[str, Any]:
    result = run_auto_parameter_search(
        settings=auto_search_settings,
        rows_by_symbol=rows_by_symbol,
        active_params=params,
        base_params=params,
        ml_settings=ml_settings,
        validation_config=ValidationConfig(),
    )
    return generate_audit_report(
        top_candidates=list(result.get("results") or []),
        inventory=build_parameter_inventory(),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audit Core Mode parameter search space")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--output-dir", default="./outputs/core_mode_param_audit")
    parser.add_argument("--results-json", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    inventory = build_parameter_inventory()
    if args.results_json:
        raw = json.loads(Path(args.results_json).read_text(encoding="utf-8-sig"))
        top_candidates = normalize_top_candidates_payload(raw)
    else:
        top_candidates = []
    report = generate_audit_report(top_candidates=top_candidates, inventory=inventory)
    if args.dry_run:
        print(json.dumps({"inventory_count": len(inventory), "candidate_count": len(top_candidates)}, ensure_ascii=False))
        return
    json_path, md_path = write_report_files(report, output_dir=Path(args.output_dir), symbol=args.symbol)
    print(json.dumps({"json": str(json_path), "markdown": str(md_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
