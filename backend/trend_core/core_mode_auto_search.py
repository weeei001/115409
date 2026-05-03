from __future__ import annotations

import random
from statistics import mean, pstdev
from typing import Any

from .core_mode_engine import run_core_mode_pipeline
from .core_mode_ml import rank_candidates_with_ml
from .core_mode_splits import (
    build_final_holdout_metadata,
    get_final_holdout_rows,
    get_search_rows,
    get_validation_rows,
    split_train_validation_final_holdout,
)
from .core_mode_types import (
    CORE_MODE_WEIGHT_GROUPS,
    AdaptiveSearchSettings,
    AutoSearchSettings,
    CoreModeParams,
    MarketRow,
    TimeSeriesMLSettings,
    clip,
    normalize_core_mode_params,
    normalize_time_series_ml_settings,
    params_to_dict,
)
from .core_mode_validation import ValidationConfig, evaluate_params_with_walk_forward

THRESHOLD_REFINEMENT_KEYS = (
    "state_threshold",
    "shape_threshold",
    "trend_threshold",
    "max_pullback_depth",
)
LOOKBACK_REFINEMENT_KEYS = ("breakout_lookback", "momentum_window")
STOP_REFINEMENT_KEYS = ("hard_stop_pct", "trailing_stop_pct")


def _merge_candidate(
    out: dict[tuple[Any, ...], dict[str, Any]],
    *,
    params: CoreModeParams,
    source_tag: str,
) -> None:
    key = tuple(params_to_dict(params).items())
    if key not in out:
        out[key] = {"params": params, "source_tags": {source_tag}}
        return
    out[key]["source_tags"].add(source_tag)


def _key_for_params(params: CoreModeParams) -> tuple[Any, ...]:
    return tuple(params_to_dict(params).items())


def _norm_score_mode_score(
    *,
    balanced_score: float,
    return_score: float,
    drawdown_score: float,
    stability_score: float,
    score_mode: str,
) -> float:
    if score_mode == "return_score":
        return return_score
    if score_mode == "low_drawdown_score":
        return drawdown_score
    if score_mode == "stable_score":
        return stability_score
    return balanced_score


def generate_weight_variations(base_params: CoreModeParams) -> list[tuple[CoreModeParams, str]]:
    base = params_to_dict(base_params)
    candidates: list[tuple[CoreModeParams, str]] = []

    weighted_profiles = [
        {"weighted_technical_weight": 0.55, "weighted_institutional_weight": 0.20, "weighted_news_weight": 0.05, "weighted_momentum_weight": 0.20},
        {"weighted_technical_weight": 0.25, "weighted_institutional_weight": 0.50, "weighted_news_weight": 0.05, "weighted_momentum_weight": 0.20},
        {"weighted_technical_weight": 0.30, "weighted_institutional_weight": 0.25, "weighted_news_weight": 0.10, "weighted_momentum_weight": 0.35},
    ]
    for profile in weighted_profiles:
        candidates.append((normalize_core_mode_params({**base, **profile}), "weighted_profile"))

    technical_profiles = [
        {"technical_ma_weight": 0.50, "technical_macd_weight": 0.20, "technical_rsi_weight": 0.18, "technical_kd_weight": 0.12},
        {"technical_ma_weight": 0.30, "technical_macd_weight": 0.32, "technical_rsi_weight": 0.22, "technical_kd_weight": 0.16},
        {"technical_ma_weight": 0.28, "technical_macd_weight": 0.24, "technical_rsi_weight": 0.30, "technical_kd_weight": 0.18},
    ]
    for profile in technical_profiles:
        candidates.append((normalize_core_mode_params({**base, **profile}), "technical_profile"))

    state_trend_variations = [
        {"state_weighted_score_weight": 0.60, "state_momentum_weight": 0.25, "state_institutional_weight": 0.15, "trend_state_weight": 0.50, "trend_shape_weight": 0.30, "trend_breakout_weight": 0.20},
        {"state_weighted_score_weight": 0.45, "state_momentum_weight": 0.30, "state_institutional_weight": 0.25, "trend_state_weight": 0.35, "trend_shape_weight": 0.45, "trend_breakout_weight": 0.20},
    ]
    for profile in state_trend_variations:
        candidates.append((normalize_core_mode_params({**base, **profile}), "state_trend_variation"))

    shape_variations = [
        {"shape_breakout_weight": 0.45, "shape_slope_weight": 0.20, "shape_efficiency_weight": 0.20, "shape_pullback_weight": 0.15},
        {"shape_breakout_weight": 0.25, "shape_slope_weight": 0.30, "shape_efficiency_weight": 0.30, "shape_pullback_weight": 0.15},
    ]
    for profile in shape_variations:
        candidates.append((normalize_core_mode_params({**base, **profile}), "shape_variation"))

    return candidates


def generate_core_param_variations(
    base_params: CoreModeParams,
    *,
    runtime_level: str,
) -> list[tuple[CoreModeParams, str]]:
    base = params_to_dict(base_params)
    candidates: list[tuple[CoreModeParams, str]] = []
    span_int = 12 if runtime_level == "deep" else 8
    span_float = 0.05 if runtime_level == "deep" else 0.03

    grid_breakout = sorted({max(10, base_params.breakout_lookback - span_int), base_params.breakout_lookback, min(90, base_params.breakout_lookback + span_int)})
    grid_momentum = sorted({max(5, base_params.momentum_window - span_int), base_params.momentum_window, min(60, base_params.momentum_window + span_int)})
    grid_state = sorted({round(max(0.05, base_params.state_threshold - span_float), 4), base_params.state_threshold, round(min(0.60, base_params.state_threshold + span_float), 4)})
    grid_shape = sorted({round(max(0.05, base_params.shape_threshold - span_float), 4), base_params.shape_threshold, round(min(0.60, base_params.shape_threshold + span_float), 4)})
    grid_trend = sorted({round(max(0.05, base_params.trend_threshold - span_float), 4), base_params.trend_threshold, round(min(0.80, base_params.trend_threshold + span_float), 4)})
    grid_pullback = sorted({round(max(0.03, base_params.max_pullback_depth - span_float), 4), base_params.max_pullback_depth, round(min(0.40, base_params.max_pullback_depth + span_float), 4)})
    grid_hard_stop = sorted({round(max(0.01, base_params.hard_stop_pct - span_float), 4), base_params.hard_stop_pct, round(min(0.30, base_params.hard_stop_pct + span_float), 4)})
    grid_trailing = sorted({round(max(0.01, base_params.trailing_stop_pct - span_float), 4), base_params.trailing_stop_pct, round(min(0.30, base_params.trailing_stop_pct + span_float), 4)})

    max_grid_count = 420 if runtime_level == "deep" else 220
    for breakout in grid_breakout:
        for momentum in grid_momentum:
            for state in grid_state:
                for shape in grid_shape:
                    for trend in grid_trend:
                        for pullback in grid_pullback:
                            if len(candidates) >= max_grid_count:
                                break
                            candidates.append(
                                (
                                    normalize_core_mode_params(
                                        {
                                            **base,
                                            "breakout_lookback": breakout,
                                            "momentum_window": momentum,
                                            "state_threshold": state,
                                            "shape_threshold": shape,
                                            "trend_threshold": trend,
                                            "max_pullback_depth": pullback,
                                        }
                                    ),
                                    "coarse_grid",
                                )
                            )
                        if len(candidates) >= max_grid_count:
                            break
                    if len(candidates) >= max_grid_count:
                        break
                if len(candidates) >= max_grid_count:
                    break
            if len(candidates) >= max_grid_count:
                break
        if len(candidates) >= max_grid_count:
            break

    for hard_stop in grid_hard_stop:
        for trailing_stop in grid_trailing:
            candidates.append(
                (
                    normalize_core_mode_params(
                        {
                            **base,
                            "hard_stop_pct": hard_stop,
                            "trailing_stop_pct": trailing_stop,
                        }
                    ),
                    "coarse_grid",
                )
            )
    return candidates


def generate_candidate_pool(
    *,
    settings: AutoSearchSettings,
    active_params: CoreModeParams,
    base_params: CoreModeParams,
    seed: int = 42,
) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    _merge_candidate(merged, params=active_params, source_tag="active_base")
    _merge_candidate(merged, params=base_params, source_tag="active_base")

    for start in (active_params, base_params):
        start_map = params_to_dict(start)
        local_steps = [(-2, -1, 1, 2), (-0.02, -0.01, 0.01, 0.02)]
        for delta in local_steps[0]:
            _merge_candidate(
                merged,
                params=normalize_core_mode_params(
                    {
                        **start_map,
                        "breakout_lookback": start.breakout_lookback + delta,
                        "momentum_window": start.momentum_window + delta,
                    }
                ),
                source_tag="local_variation",
            )
        for delta in local_steps[1]:
            _merge_candidate(
                merged,
                params=normalize_core_mode_params(
                    {
                        **start_map,
                        "state_threshold": start.state_threshold + delta,
                        "shape_threshold": start.shape_threshold + delta,
                        "trend_threshold": start.trend_threshold + delta,
                    }
                ),
                source_tag="local_variation",
            )

    for candidate, tag in generate_core_param_variations(base_params, runtime_level=settings.max_runtime_level):
        _merge_candidate(merged, params=candidate, source_tag=tag)
    for candidate, tag in generate_weight_variations(base_params):
        _merge_candidate(merged, params=candidate, source_tag=tag)

    rng = random.Random(seed)
    perturb_rounds = 120 if settings.max_runtime_level == "deep" else 60
    for _ in range(perturb_rounds):
        raw = params_to_dict(base_params)
        raw["breakout_lookback"] = raw["breakout_lookback"] + rng.randint(-8, 8)
        raw["momentum_window"] = raw["momentum_window"] + rng.randint(-6, 6)
        raw["state_threshold"] = raw["state_threshold"] + rng.uniform(-0.03, 0.03)
        raw["shape_threshold"] = raw["shape_threshold"] + rng.uniform(-0.03, 0.03)
        raw["trend_threshold"] = raw["trend_threshold"] + rng.uniform(-0.03, 0.03)
        raw["max_pullback_depth"] = raw["max_pullback_depth"] + rng.uniform(-0.02, 0.02)
        raw["hard_stop_pct"] = raw["hard_stop_pct"] + rng.uniform(-0.02, 0.02)
        raw["trailing_stop_pct"] = raw["trailing_stop_pct"] + rng.uniform(-0.02, 0.02)
        _merge_candidate(
            merged,
            params=normalize_core_mode_params(raw),
            source_tag="random_perturbation",
        )

    pool = list(merged.values())
    if len(pool) <= settings.candidate_pool_size:
        return pool

    head = pool[: min(32, len(pool))]
    rest = pool[len(head) :]
    needed = settings.candidate_pool_size - len(head)
    if needed <= 0:
        return head[: settings.candidate_pool_size]
    stride = max(1, len(rest) // needed)
    sampled = rest[::stride][:needed]
    return head + sampled


def _adaptive_sample_candidates(
    candidates: list[dict[str, Any]],
    *,
    limit: int,
) -> list[dict[str, Any]]:
    if len(candidates) <= limit:
        return candidates

    head = candidates[: min(24, len(candidates))]
    rest = candidates[len(head) :]
    needed = limit - len(head)
    if needed <= 0:
        return head[:limit]
    stride = max(1, len(rest) // needed)
    return head + rest[::stride][:needed]


def _score_from_ranked_result(item: dict[str, Any], ranking_basis: str) -> float:
    if ranking_basis == "verified_score":
        return float(item.get("verified_score") or 0.0)
    return float(item.get("cross_stock_score") or 0.0)


def _sort_ranked_results(ranked_results: list[dict[str, Any]], *, ranking_basis: str) -> list[dict[str, Any]]:
    ranked_results.sort(key=lambda item: _score_from_ranked_result(item, ranking_basis), reverse=True)
    for idx, item in enumerate(ranked_results, start=1):
        item["rank"] = idx
    return ranked_results


def perturb_params_around_elites(
    *,
    elite_params: CoreModeParams,
    refinement_strength: str,
    rng: random.Random,
) -> list[tuple[CoreModeParams, str]]:
    base = params_to_dict(elite_params)
    candidates: list[tuple[CoreModeParams, str]] = []

    if refinement_strength == "small":
        threshold_scales = [0.05]
        lookback_steps = [2]
        stop_steps = [0.01]
        weight_noise = 0.03
    elif refinement_strength == "large":
        threshold_scales = [0.05, 0.10]
        lookback_steps = [2, 5]
        stop_steps = [0.01, 0.02]
        weight_noise = 0.10
    else:
        threshold_scales = [0.05, 0.10]
        lookback_steps = [2, 5]
        stop_steps = [0.01, 0.02]
        weight_noise = 0.06

    for key in THRESHOLD_REFINEMENT_KEYS:
        value = float(base[key])
        base_for_delta = max(abs(value), 0.01)
        for scale in threshold_scales:
            delta = base_for_delta * scale
            for direction in (-1.0, 1.0):
                raw = dict(base)
                raw[key] = value + (direction * delta)
                candidates.append((normalize_core_mode_params(raw), "threshold_refinement"))

    for key in LOOKBACK_REFINEMENT_KEYS:
        value = int(base[key])
        for step in lookback_steps:
            for direction in (-1, 1):
                raw = dict(base)
                raw[key] = value + (direction * step)
                candidates.append((normalize_core_mode_params(raw), "lookback_refinement"))

    for key in STOP_REFINEMENT_KEYS:
        value = float(base[key])
        for step in stop_steps:
            for direction in (-1.0, 1.0):
                raw = dict(base)
                raw[key] = value + (direction * step)
                candidates.append((normalize_core_mode_params(raw), "stop_pct_refinement"))

    weight_rounds = 2 if refinement_strength == "small" else 4
    for _ in range(weight_rounds):
        for weight_keys in CORE_MODE_WEIGHT_GROUPS.values():
            raw = dict(base)
            for key in weight_keys:
                raw[key] = max(0.001, float(raw[key]) + rng.uniform(-weight_noise, weight_noise))
            candidates.append((normalize_core_mode_params(raw), "weight_refinement"))

    return candidates


def generate_refinement_candidates(
    *,
    adaptive_settings: AdaptiveSearchSettings,
    elites: list[dict[str, Any]],
    iteration: int,
    seed: int = 42,
) -> list[dict[str, Any]]:
    merged: dict[tuple[Any, ...], dict[str, Any]] = {}
    rng = random.Random(seed + (iteration * 97))

    for rank, elite in enumerate(elites, start=1):
        elite_params = normalize_core_mode_params(elite["params"])
        _merge_candidate(
            merged,
            params=elite_params,
            source_tag=f"adaptive_iteration_{iteration}",
        )
        _merge_candidate(
            merged,
            params=elite_params,
            source_tag=f"refined_from_rank_{rank}",
        )
        for candidate, tag in perturb_params_around_elites(
            elite_params=elite_params,
            refinement_strength=adaptive_settings.refinement_strength,
            rng=rng,
        ):
            _merge_candidate(
                merged,
                params=candidate,
                source_tag=f"adaptive_iteration_{iteration}",
            )
            _merge_candidate(
                merged,
                params=candidate,
                source_tag=f"refined_from_rank_{rank}",
            )
            _merge_candidate(
                merged,
                params=candidate,
                source_tag=tag,
            )

    pool = list(merged.values())
    return _adaptive_sample_candidates(pool, limit=adaptive_settings.candidates_per_iteration)


def summarize_iteration_result(
    *,
    iteration: int,
    candidate_count: int,
    verified_count: int,
    best_score: float,
    improvement: float | None,
    elite_count: int,
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "iteration": iteration,
        "candidate_count": candidate_count,
        "verified_count": verified_count,
        "best_score": round(float(best_score), 6),
        "improvement": round(float(improvement), 6) if improvement is not None else None,
        "elite_count": elite_count,
        "warnings": list(dict.fromkeys(warnings)),
    }


def should_stop_adaptive_search(
    *,
    iteration: int,
    adaptive_settings: AdaptiveSearchSettings,
    global_best_score: float,
    improvement: float | None,
    no_improvement_rounds: int,
) -> tuple[bool, str | None, int]:
    next_no_improvement_rounds = no_improvement_rounds
    if improvement is not None:
        if improvement < adaptive_settings.min_improvement:
            next_no_improvement_rounds += 1
        else:
            next_no_improvement_rounds = 0

    target = adaptive_settings.stop_when_score_reaches
    if target is not None and global_best_score >= target:
        return True, "score_target_reached", next_no_improvement_rounds
    if iteration >= adaptive_settings.max_iterations:
        return True, "max_iterations", next_no_improvement_rounds
    if next_no_improvement_rounds >= adaptive_settings.patience:
        return True, "patience", next_no_improvement_rounds
    return False, None, next_no_improvement_rounds


def build_adaptive_search_trace(
    *,
    enabled: bool,
    stop_reason: str | None,
    best_score_progression: list[float],
    iterations: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "enabled": enabled,
        "stop_reason": stop_reason,
        "best_score_progression": [round(float(item), 6) for item in best_score_progression],
        "iterations": iterations,
    }


def score_single_stock_candidate(
    *,
    ac: float,
    cumulative_return: float,
    max_drawdown: float,
    trade_count: int,
    stability_score: float,
    score_mode: str,
) -> float:
    ac_score = clip(ac, 0.0, 1.0)
    return_score = clip((cumulative_return - (-0.20)) / 0.80, 0.0, 1.0)
    drawdown_score = clip(1.0 - (abs(max_drawdown) / 0.35), 0.0, 1.0)
    trade_count_score = clip(float(trade_count) / 30.0, 0.0, 1.0)
    stable_score = clip(stability_score, 0.0, 1.0)

    balanced = (
        (0.20 * ac_score)
        + (0.25 * return_score)
        + (0.20 * stable_score)
        + (0.20 * drawdown_score)
        + (0.10 * trade_count_score)
    )
    return _norm_score_mode_score(
        balanced_score=balanced,
        return_score=return_score,
        drawdown_score=drawdown_score,
        stability_score=stable_score,
        score_mode=score_mode,
    )


def evaluate_candidate_for_symbol(
    *,
    symbol: str,
    train_plus_validation_rows: list[MarketRow],
    validation_rows: list[MarketRow],
    params: CoreModeParams,
    settings: AutoSearchSettings,
    validation_config: ValidationConfig,
) -> dict[str, Any]:
    warnings: list[str] = []
    if len(train_plus_validation_rows) < 40 or len(validation_rows) < 20:
        return {
            "symbol": symbol,
            "success": False,
            "validation_score": None,
            "verified_score": None,
            "ac": None,
            "cumulative_return": None,
            "max_drawdown": None,
            "trade_count": None,
            "stability_score": None,
            "holdout_score": None,
            "warnings": [f"{symbol} 資料不足：train+validation 至少需 40、validation 至少需 20。"],
        }

    summary = run_core_mode_pipeline(validation_rows, params)["summary"]
    eval_result = evaluate_params_with_walk_forward(
        train_plus_validation_rows,
        params,
        validation_config=ValidationConfig(
            mode=validation_config.mode,
            step_days=validation_config.step_days,
            min_overlap_ratio=validation_config.min_overlap_ratio,
            holdout_enabled=False,
            holdout_days=None,
        ),
    )

    stability_score = 0.5
    if settings.use_time_series_validation:
        stability_score = clip(float(eval_result.aggregate_summary.stability), 0.0, 1.0)

    verified_score = score_single_stock_candidate(
        ac=float(summary.ac),
        cumulative_return=float(summary.cumulative_return),
        max_drawdown=float(summary.max_drawdown),
        trade_count=int(summary.trade_count),
        stability_score=stability_score,
        score_mode=settings.score_mode,
    )

    trade_count = int(summary.trade_count)
    if settings.require_min_trade_count and trade_count < settings.min_trade_count:
        verified_score = verified_score * 0.7
        warnings.append(
            f"trade_count({trade_count}) 低於 min_trade_count({settings.min_trade_count})，已套用保守懲罰。"
        )

    clipped_score = round(float(clip(verified_score, 0.0, 1.0)), 6)
    return {
        "symbol": symbol,
        "success": True,
        "validation_score": clipped_score,
        "verified_score": clipped_score,
        "ac": round(float(summary.ac), 6),
        "cumulative_return": round(float(summary.cumulative_return), 6),
        "max_drawdown": round(float(summary.max_drawdown), 6),
        "trade_count": trade_count,
        "stability_score": round(float(stability_score), 6),
        "holdout_score": None,
        "warnings": warnings,
    }


def score_multi_stock_candidate(symbol_results: list[dict[str, Any]]) -> float:
    successful = [item for item in symbol_results if item.get("success") and item.get("verified_score") is not None]
    total = max(1, len(symbol_results))
    if not successful:
        return 0.0

    ac_scores = [clip(float(item["ac"] or 0.0), 0.0, 1.0) for item in successful]
    return_scores = [clip((float(item["cumulative_return"] or 0.0) - (-0.20)) / 0.80, 0.0, 1.0) for item in successful]
    drawdown_scores = [clip(1.0 - (abs(float(item["max_drawdown"] or 0.0)) / 0.35), 0.0, 1.0) for item in successful]
    stability_scores = [clip(float(item["stability_score"] or 0.0), 0.0, 1.0) for item in successful]
    symbol_scores = [clip(float(item["verified_score"] or 0.0), 0.0, 1.0) for item in successful]

    stock_coverage_score = len(successful) / total
    returns_raw = [float(item["cumulative_return"] or 0.0) for item in successful]
    if len(returns_raw) > 1:
        normalized_std = clip(pstdev(returns_raw) / 0.40, 0.0, 1.0)
        cross_stock_consistency = 1.0 - normalized_std
    else:
        cross_stock_consistency = 1.0
    worst_stock_score = min(symbol_scores)

    score = (
        (0.15 * mean(ac_scores))
        + (0.20 * mean(return_scores))
        + (0.20 * mean(stability_scores))
        + (0.15 * mean(drawdown_scores))
        + (0.10 * stock_coverage_score)
        + (0.10 * cross_stock_consistency)
        + (0.10 * worst_stock_score)
    )
    return round(float(clip(score, 0.0, 1.0)), 6)


def evaluate_candidate_across_symbols(
    *,
    symbols: list[str],
    rows_by_symbol: dict[str, list[MarketRow]],
    validation_rows_by_symbol: dict[str, list[MarketRow]],
    params: CoreModeParams,
    settings: AutoSearchSettings,
    validation_config: ValidationConfig,
) -> dict[str, Any]:
    symbol_results: list[dict[str, Any]] = []
    warnings: list[str] = []
    for symbol in symbols:
        result = evaluate_candidate_for_symbol(
            symbol=symbol,
            train_plus_validation_rows=rows_by_symbol.get(symbol, []),
            validation_rows=validation_rows_by_symbol.get(symbol, []),
            params=params,
            settings=settings,
            validation_config=validation_config,
        )
        symbol_results.append(result)
        warnings.extend(result.get("warnings", []))

    cross_stock_score = score_multi_stock_candidate(symbol_results)
    if not any(item.get("success") for item in symbol_results):
        warnings.append("所有 symbols validation 失敗，cross_stock_score 以 0 計算。")

    return {
        "symbol_results": symbol_results,
        "cross_stock_score": cross_stock_score,
        "warnings": list(dict.fromkeys(warnings)),
    }


def _attach_final_holdout_results(
    *,
    ranked_results: list[dict[str, Any]],
    settings: AutoSearchSettings,
    symbols: list[str],
    final_holdout_rows_by_symbol: dict[str, list[MarketRow]],
) -> tuple[list[dict[str, Any]], list[str]]:
    warnings: list[str] = []

    for row in ranked_results:
        row["validation_score"] = row.get("validation_score", row.get("verified_score"))
        row["final_holdout_score"] = None
        row["final_holdout_cross_stock_score"] = None
        row["final_holdout_summary"] = None
        row["final_holdout_symbol_results"] = []

    if not settings.final_holdout_settings.enabled:
        warnings.append("final holdout 已停用（final_holdout_settings.enabled=false）。")
        return ranked_results, warnings

    for row in ranked_results:
        params = normalize_core_mode_params(row.get("params") or {})
        row_warnings = list(row.get("warnings") or [])

        if settings.mode == "single_stock_search":
            symbol = symbols[0]
            holdout_rows = final_holdout_rows_by_symbol.get(symbol, [])
            if len(holdout_rows) < 20:
                row_warnings.append(f"{symbol} final holdout 資料不足，無法計算 final_holdout_score。")
                row["warnings"] = list(dict.fromkeys(row_warnings))
                row["final_holdout_summary"] = {"symbol": symbol, "sample_count": len(holdout_rows), "success": False}
                row["final_holdout_symbol_results"] = [
                    {"symbol": symbol, "success": False, "final_holdout_score": None, "warnings": [f"{symbol} final holdout 資料不足。"]}
                ]
                continue

            summary = run_core_mode_pipeline(holdout_rows, params)["summary"]
            final_score = round(float(clip(float(summary.ac), 0.0, 1.0)), 6)
            summary_payload = {
                "ac": round(float(summary.ac), 6),
                "win_rate": round(float(summary.win_rate), 6),
                "expectancy": round(float(summary.expectancy), 6),
                "profit_factor": round(float(summary.profit_factor), 6),
                "cumulative_return": round(float(summary.cumulative_return), 6),
                "max_drawdown": round(float(summary.max_drawdown), 6),
                "trade_count": int(summary.trade_count),
                "avg_mfe": round(float(summary.avg_mfe), 6),
                "avg_mae": round(float(summary.avg_mae), 6),
                "future_trend_quality": round(float(summary.future_trend_quality), 6),
                "stability": round(float(summary.stability), 6),
                "sample_count": len(holdout_rows),
            }
            row["final_holdout_score"] = final_score
            row["final_holdout_summary"] = summary_payload
            row["final_holdout_symbol_results"] = [
                {"symbol": symbol, "success": True, "final_holdout_score": final_score, "summary": summary_payload, "warnings": []}
            ]
            row["warnings"] = list(dict.fromkeys(row_warnings))
            continue

        symbol_results: list[dict[str, Any]] = []
        scoring_rows: list[dict[str, Any]] = []
        for symbol in symbols:
            holdout_rows = final_holdout_rows_by_symbol.get(symbol, [])
            if len(holdout_rows) < 20:
                symbol_results.append(
                    {"symbol": symbol, "success": False, "final_holdout_score": None, "warnings": [f"{symbol} final holdout 資料不足。"]}
                )
                continue

            summary = run_core_mode_pipeline(holdout_rows, params)["summary"]
            score = round(float(clip(float(summary.ac), 0.0, 1.0)), 6)
            payload = {
                "ac": round(float(summary.ac), 6),
                "cumulative_return": round(float(summary.cumulative_return), 6),
                "max_drawdown": round(float(summary.max_drawdown), 6),
                "trade_count": int(summary.trade_count),
                "stability": round(float(summary.stability), 6),
                "sample_count": len(holdout_rows),
            }
            symbol_results.append(
                {"symbol": symbol, "success": True, "final_holdout_score": score, "summary": payload, "warnings": []}
            )
            scoring_rows.append(
                {
                    "success": True,
                    "verified_score": score,
                    "ac": payload["ac"],
                    "cumulative_return": payload["cumulative_return"],
                    "max_drawdown": payload["max_drawdown"],
                    "stability_score": payload["stability"],
                }
            )

        if not scoring_rows:
            row_warnings.append("final holdout 多股評估失敗，無法計算 final_holdout_cross_stock_score。")
            row["warnings"] = list(dict.fromkeys(row_warnings))
            row["final_holdout_summary"] = {"symbol_count": len(symbols), "successful_symbol_count": 0}
            row["final_holdout_symbol_results"] = symbol_results
            continue

        final_cross = score_multi_stock_candidate(scoring_rows)
        success_items = [item["summary"] for item in symbol_results if item.get("success") and item.get("summary")]
        row["final_holdout_cross_stock_score"] = final_cross
        row["final_holdout_summary"] = {
            "symbol_count": len(symbols),
            "successful_symbol_count": len(success_items),
            "mean_ac": round(mean([float(item.get("ac") or 0.0) for item in success_items]), 6),
            "mean_cumulative_return": round(mean([float(item.get("cumulative_return") or 0.0) for item in success_items]), 6),
            "mean_max_drawdown": round(mean([float(item.get("max_drawdown") or 0.0) for item in success_items]), 6),
            "mean_trade_count": round(mean([float(item.get("trade_count") or 0.0) for item in success_items]), 6),
            "final_holdout_cross_stock_score": final_cross,
        }
        row["final_holdout_symbol_results"] = symbol_results
        row["warnings"] = list(dict.fromkeys(row_warnings))

    return ranked_results, warnings


def summarize_auto_search_result(
    *,
    settings: AutoSearchSettings,
    candidate_count: int,
    evaluated_candidate_count: int,
    final_verified_count: int,
    ranking_basis: str,
    ranked_results: list[dict[str, Any]],
    warnings: list[str],
    split_summary: dict[str, Any] | None = None,
    adaptive_trace: dict[str, Any] | None = None,
) -> dict[str, Any]:
    merged_warnings = list(
        dict.fromkeys(
            warnings
            + [
                "Auto Search 只輸出建議參數；不會自動套用、不會自動儲存 preset、不會改 active preset。"
            ]
        )
    )
    return {
        "enabled": True,
        "mode": settings.mode,
        "symbols": list(settings.symbols),
        "top_n": settings.top_n,
        "candidate_count": candidate_count,
        "evaluated_candidate_count": evaluated_candidate_count,
        "final_verified_count": final_verified_count,
        "ranking_basis": ranking_basis,
        "split_summary": split_summary
        or {
            "train_start": None,
            "train_end": None,
            "validation_start": None,
            "validation_end": None,
            "final_holdout_start": None,
            "final_holdout_end": None,
            "train_count": 0,
            "validation_count": 0,
            "final_holdout_count": 0,
            "warnings": [],
        },
        "results": ranked_results,
        "warnings": merged_warnings,
        "adaptive_trace": adaptive_trace or {"enabled": False, "stop_reason": None, "best_score_progression": [], "iterations": []},
    }
def run_adaptive_auto_search(
    *,
    settings: AutoSearchSettings,
    rows_by_symbol: dict[str, list[MarketRow]],
    validation_rows_by_symbol: dict[str, list[MarketRow]],
    final_holdout_rows_by_symbol: dict[str, list[MarketRow]],
    active_params: CoreModeParams,
    base_params: CoreModeParams,
    ml_settings: TimeSeriesMLSettings,
    validation_config: ValidationConfig,
    symbols: list[str],
    ranking_basis: str,
) -> dict[str, Any]:
    adaptive_settings = settings.adaptive_search_settings
    warnings: list[str] = []

    global_best: dict[tuple[Any, ...], dict[str, Any]] = {}
    iteration_summaries: list[dict[str, Any]] = []
    best_score_progression: list[float] = []
    stop_reason: str | None = None
    no_improvement_rounds = 0

    previous_elites: list[dict[str, Any]] = []
    total_candidate_count = 0
    total_evaluated_candidate_count = 0
    total_verified_count = 0
    global_best_score = 0.0

    for iteration in range(1, adaptive_settings.max_iterations + 1):
        if iteration == 1:
            candidate_pool = generate_candidate_pool(
                settings=settings,
                active_params=active_params,
                base_params=base_params,
            )
            candidate_pool = _adaptive_sample_candidates(candidate_pool, limit=adaptive_settings.candidates_per_iteration)
        else:
            candidate_pool = generate_refinement_candidates(
                adaptive_settings=adaptive_settings,
                elites=previous_elites,
                iteration=iteration,
            )

        if not candidate_pool:
            warnings.append(f"adaptive iteration {iteration} 沒有可用候選參數，已提前停止。")
            stop_reason = "patience"
            break

        total_candidate_count += len(candidate_pool)
        predicted_by_key: dict[tuple[Any, ...], float] = {}
        ranked_pool = candidate_pool
        iteration_warnings: list[str] = []

        should_use_ml_prefilter = settings.use_ml_prefilter and adaptive_settings.use_ml_prefilter
        if should_use_ml_prefilter:
            if settings.mode == "multi_stock_search":
                iteration_warnings.append(
                    "多股模式下 ML 預篩僅用第一檔 symbol 作為參考，最終仍以 cross_stock_score 排序。"
                )
            ref_symbol = symbols[0]
            ranking_input = normalize_time_series_ml_settings(
                {
                    "enabled": ml_settings.enabled,
                    "enable_candidate_ranking": True,
                    "candidate_ranking_model_type": ml_settings.candidate_ranking_model_type,
                    "candidate_ranking_score_mode": ml_settings.candidate_ranking_score_mode,
                    "candidate_ranking_top_n": min(
                        adaptive_settings.verify_top_n_per_iteration,
                        len(candidate_pool),
                    ),
                    "n_splits": ml_settings.n_splits,
                    "test_size": ml_settings.test_size,
                    "gap": ml_settings.gap,
                    "prediction_horizon": ml_settings.prediction_horizon,
                }
            )
            ranking_result = rank_candidates_with_ml(
                rows=rows_by_symbol.get(ref_symbol, []),
                candidate_params=[item["params"] for item in candidate_pool],
                ml_settings=ranking_input,
            )
            iteration_warnings.extend(ranking_result.warnings)
            ranked_params: list[CoreModeParams] = []
            for item in ranking_result.ranked_candidates:
                resolved = normalize_core_mode_params(item.params)
                key = _key_for_params(resolved)
                predicted_by_key[key] = float(item.predicted_score)
                ranked_params.append(resolved)

            used_keys = {_key_for_params(item) for item in ranked_params}
            for candidate in candidate_pool:
                if len(ranked_params) >= adaptive_settings.verify_top_n_per_iteration:
                    break
                key = _key_for_params(candidate["params"])
                if key in used_keys:
                    continue
                ranked_params.append(candidate["params"])
                used_keys.add(key)

            ranked_pool = []
            tag_map = {_key_for_params(item["params"]): item for item in candidate_pool}
            for params in ranked_params:
                key = _key_for_params(params)
                tagged = tag_map.get(key)
                if tagged is not None:
                    ranked_pool.append(tagged)

        total_evaluated_candidate_count += len(ranked_pool)
        evaluated_candidates = ranked_pool[: adaptive_settings.verify_top_n_per_iteration]
        total_verified_count += len(evaluated_candidates)
        ranked_results: list[dict[str, Any]] = []

        for item in evaluated_candidates:
            params = item["params"]
            key = _key_for_params(params)
            source_tags = sorted(item["source_tags"])
            predicted_score = predicted_by_key.get(key)

            if settings.mode == "single_stock_search":
                symbol_result = evaluate_candidate_for_symbol(
                    symbol=symbols[0],
                    train_plus_validation_rows=rows_by_symbol.get(symbols[0], []),
                    validation_rows=validation_rows_by_symbol.get(symbols[0], []),
                    params=params,
                    settings=settings,
                    validation_config=validation_config,
                )
                ranked_results.append(
                    {
                        "rank": 0,
                        "predicted_score": round(predicted_score, 6) if predicted_score is not None else None,
                        "validation_score": symbol_result.get("validation_score"),
                        "verified_score": symbol_result.get("verified_score"),
                        "cross_stock_score": None,
                        "params": params_to_dict(params),
                        "source_tags": source_tags,
                        "summary": {
                            "ac": symbol_result.get("ac"),
                            "cumulative_return": symbol_result.get("cumulative_return"),
                            "max_drawdown": symbol_result.get("max_drawdown"),
                            "trade_count": symbol_result.get("trade_count"),
                            "stability_score": symbol_result.get("stability_score"),
                            "holdout_score": symbol_result.get("holdout_score"),
                        },
                        "symbol_results": [symbol_result],
                        "warnings": symbol_result.get("warnings", []),
                    }
                )
            else:
                cross_result = evaluate_candidate_across_symbols(
                    symbols=symbols,
                    rows_by_symbol=rows_by_symbol,
                    validation_rows_by_symbol=validation_rows_by_symbol,
                    params=params,
                    settings=settings,
                    validation_config=validation_config,
                )
                symbol_results = cross_result["symbol_results"]
                success_items = [row for row in symbol_results if row.get("success")]
                ranked_results.append(
                    {
                        "rank": 0,
                        "predicted_score": round(predicted_score, 6) if predicted_score is not None else None,
                        "validation_score": None,
                        "verified_score": None,
                        "cross_stock_score": cross_result["cross_stock_score"],
                        "params": params_to_dict(params),
                        "source_tags": source_tags,
                        "summary": {
                            "ac": round(mean([float(row.get("ac") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                            "cumulative_return": round(mean([float(row.get("cumulative_return") or 0.0) for row in success_items]), 6)
                            if success_items
                            else 0.0,
                            "max_drawdown": round(mean([float(row.get("max_drawdown") or 0.0) for row in success_items]), 6)
                            if success_items
                            else 0.0,
                            "trade_count": round(mean([float(row.get("trade_count") or 0.0) for row in success_items]), 6)
                            if success_items
                            else 0.0,
                            "stability_score": round(mean([float(row.get("stability_score") or 0.0) for row in success_items]), 6)
                            if success_items
                            else 0.0,
                            "holdout_score": None,
                        },
                        "symbol_results": symbol_results,
                        "warnings": cross_result["warnings"],
                    }
                )

        _sort_ranked_results(ranked_results, ranking_basis=ranking_basis)
        iteration_best_score = _score_from_ranked_result(ranked_results[0], ranking_basis) if ranked_results else 0.0
        improvement = None if iteration == 1 else (iteration_best_score - global_best_score)
        if iteration_best_score > global_best_score:
            global_best_score = iteration_best_score
        best_score_progression.append(global_best_score)

        iteration_elites = ranked_results[: adaptive_settings.keep_elite_n]
        previous_elites = iteration_elites
        for row in iteration_elites:
            normalized = normalize_core_mode_params(row["params"])
            key = _key_for_params(normalized)
            existing = global_best.get(key)
            if existing is None or _score_from_ranked_result(row, ranking_basis) > _score_from_ranked_result(existing, ranking_basis):
                global_best[key] = dict(row)

        iteration_summary = summarize_iteration_result(
            iteration=iteration,
            candidate_count=len(candidate_pool),
            verified_count=len(evaluated_candidates),
            best_score=iteration_best_score,
            improvement=improvement,
            elite_count=len(iteration_elites),
            warnings=iteration_warnings,
        )
        iteration_summaries.append(iteration_summary)
        warnings.extend(iteration_warnings)

        should_stop, next_stop_reason, no_improvement_rounds = should_stop_adaptive_search(
            iteration=iteration,
            adaptive_settings=adaptive_settings,
            global_best_score=global_best_score,
            improvement=improvement,
            no_improvement_rounds=no_improvement_rounds,
        )
        if should_stop:
            stop_reason = next_stop_reason
            break

    if stop_reason is None:
        stop_reason = "max_iterations"

    final_results = _sort_ranked_results(list(global_best.values()), ranking_basis=ranking_basis)[: settings.top_n]
    final_results, final_holdout_warnings = _attach_final_holdout_results(
        ranked_results=final_results,
        settings=settings,
        symbols=symbols,
        final_holdout_rows_by_symbol=final_holdout_rows_by_symbol,
    )
    warnings.extend(final_holdout_warnings)
    adaptive_trace = build_adaptive_search_trace(
        enabled=True,
        stop_reason=stop_reason,
        best_score_progression=best_score_progression,
        iterations=iteration_summaries,
    )
    return {
        "candidate_count": total_candidate_count,
        "evaluated_candidate_count": total_evaluated_candidate_count,
        "final_verified_count": total_verified_count,
        "ranking_basis": ranking_basis,
        "ranked_results": final_results,
        "warnings": list(dict.fromkeys(warnings)),
        "adaptive_trace": adaptive_trace,
    }


def run_auto_parameter_search(
    *,
    settings: AutoSearchSettings,
    rows_by_symbol: dict[str, list[MarketRow]],
    active_params: CoreModeParams,
    base_params: CoreModeParams,
    ml_settings: TimeSeriesMLSettings,
    validation_config: ValidationConfig,
) -> dict[str, Any]:
    if not settings.enabled:
        return {
            "enabled": False,
            "results": [],
            "warnings": [],
            "split_summary": {
                "train_start": None,
                "train_end": None,
                "validation_start": None,
                "validation_end": None,
                "final_holdout_start": None,
                "final_holdout_end": None,
                "train_count": 0,
                "validation_count": 0,
                "final_holdout_count": 0,
                "warnings": [],
            },
            "adaptive_trace": {"enabled": False, "stop_reason": None, "best_score_progression": [], "iterations": []},
        }

    symbols = list(settings.symbols)
    warnings: list[str] = []
    if settings.mode == "single_stock_search":
        if len(symbols) != 1:
            warnings.append("single_stock_search 需要且只接受 1 檔 symbol。")
            return summarize_auto_search_result(
                settings=settings,
                candidate_count=0,
                evaluated_candidate_count=0,
                final_verified_count=0,
                ranking_basis="verified_score",
                ranked_results=[],
                warnings=warnings,
            )
        ranking_basis = "verified_score"
    else:
        if len(symbols) < 2:
            warnings.append("multi_stock_search 需要至少 2 檔 symbol。")
            return summarize_auto_search_result(
                settings=settings,
                candidate_count=0,
                evaluated_candidate_count=0,
                final_verified_count=0,
                ranking_basis="cross_stock_score",
                ranked_results=[],
                warnings=warnings,
            )
        ranking_basis = "cross_stock_score"

    split_payload_by_symbol: dict[str, dict[str, Any]] = {}
    train_rows_by_symbol: dict[str, list[MarketRow]] = {}
    validation_rows_by_symbol: dict[str, list[MarketRow]] = {}
    train_plus_validation_rows_by_symbol: dict[str, list[MarketRow]] = {}
    final_holdout_rows_by_symbol: dict[str, list[MarketRow]] = {}
    split_warnings: list[str] = []

    for symbol in symbols:
        split_payload = split_train_validation_final_holdout(
            rows=rows_by_symbol.get(symbol, []),
            final_holdout_settings=settings.final_holdout_settings,
        )
        split_payload_by_symbol[symbol] = split_payload
        train_rows_by_symbol[symbol] = get_search_rows(split_payload)
        validation_rows_by_symbol[symbol] = get_validation_rows(split_payload)
        train_plus_validation_rows_by_symbol[symbol] = list(split_payload.get("train_plus_validation_rows") or [])
        final_holdout_rows_by_symbol[symbol] = get_final_holdout_rows(split_payload)
        split_warnings.extend([f"{symbol}: {message}" for message in split_payload.get("warnings", [])])

    ref_symbol = symbols[0]
    split_summary = build_final_holdout_metadata(split_payload_by_symbol.get(ref_symbol, {}))
    split_summary["warnings"] = list(dict.fromkeys(list(split_summary.get("warnings") or []) + split_warnings))
    warnings.extend(split_summary["warnings"])

    if settings.adaptive_search_settings.enabled:
        adaptive_result = run_adaptive_auto_search(
            settings=settings,
            rows_by_symbol=train_plus_validation_rows_by_symbol,
            validation_rows_by_symbol=validation_rows_by_symbol,
            final_holdout_rows_by_symbol=final_holdout_rows_by_symbol,
            active_params=active_params,
            base_params=base_params,
            ml_settings=ml_settings,
            validation_config=validation_config,
            symbols=symbols,
            ranking_basis=ranking_basis,
        )
        merged_warnings = list(dict.fromkeys(warnings + list(adaptive_result.get("warnings", []))))
        return summarize_auto_search_result(
            settings=settings,
            candidate_count=int(adaptive_result.get("candidate_count", 0)),
            evaluated_candidate_count=int(adaptive_result.get("evaluated_candidate_count", 0)),
            final_verified_count=int(adaptive_result.get("final_verified_count", 0)),
            ranking_basis=ranking_basis,
            ranked_results=list(adaptive_result.get("ranked_results", [])),
            warnings=merged_warnings,
            split_summary=split_summary,
            adaptive_trace=adaptive_result.get("adaptive_trace"),
        )

    candidate_pool = generate_candidate_pool(
        settings=settings,
        active_params=active_params,
        base_params=base_params,
    )
    candidate_count = len(candidate_pool)

    predicted_by_key: dict[tuple[Any, ...], float] = {}
    ranked_pool = candidate_pool
    if settings.use_ml_prefilter and candidate_pool:
        if settings.mode == "multi_stock_search":
            warnings.append(
                "多股模式下 ML 預篩僅用第一檔 symbol 作為參考，最終仍以 cross_stock_score 排序。"
            )
        ranking_input = normalize_time_series_ml_settings(
            {
                "enabled": ml_settings.enabled,
                "enable_candidate_ranking": True,
                "candidate_ranking_model_type": ml_settings.candidate_ranking_model_type,
                "candidate_ranking_score_mode": ml_settings.candidate_ranking_score_mode,
                "candidate_ranking_top_n": settings.ml_prefilter_top_n,
                "n_splits": ml_settings.n_splits,
                "test_size": ml_settings.test_size,
                "gap": ml_settings.gap,
                "prediction_horizon": ml_settings.prediction_horizon,
            }
        )
        ranking_result = rank_candidates_with_ml(
            rows=train_plus_validation_rows_by_symbol.get(ref_symbol, []),
            candidate_params=[item["params"] for item in candidate_pool],
            ml_settings=ranking_input,
        )
        warnings.extend(ranking_result.warnings)
        ranked_params: list[CoreModeParams] = []
        for item in ranking_result.ranked_candidates:
            resolved = normalize_core_mode_params(item.params)
            key = _key_for_params(resolved)
            predicted_by_key[key] = float(item.predicted_score)
            ranked_params.append(resolved)

        used_keys = {_key_for_params(item) for item in ranked_params}
        for candidate in candidate_pool:
            if len(ranked_params) >= settings.ml_prefilter_top_n:
                break
            key = _key_for_params(candidate["params"])
            if key in used_keys:
                continue
            ranked_params.append(candidate["params"])
            used_keys.add(key)

        ranked_pool = []
        tag_map = {_key_for_params(item["params"]): item for item in candidate_pool}
        for params in ranked_params:
            key = _key_for_params(params)
            tagged = tag_map.get(key)
            if tagged is not None:
                ranked_pool.append(tagged)

    evaluated_candidates = ranked_pool[: settings.final_verify_top_n]
    ranked_results: list[dict[str, Any]] = []
    for item in evaluated_candidates:
        params = item["params"]
        key = _key_for_params(params)
        source_tags = sorted(item["source_tags"])
        predicted_score = predicted_by_key.get(key)

        if settings.mode == "single_stock_search":
            symbol_result = evaluate_candidate_for_symbol(
                symbol=symbols[0],
                train_plus_validation_rows=train_plus_validation_rows_by_symbol.get(symbols[0], []),
                validation_rows=validation_rows_by_symbol.get(symbols[0], []),
                params=params,
                settings=settings,
                validation_config=validation_config,
            )
            verified_score = symbol_result.get("verified_score")
            ranked_results.append(
                {
                    "rank": 0,
                    "predicted_score": round(predicted_score, 6) if predicted_score is not None else None,
                    "validation_score": symbol_result.get("validation_score"),
                    "verified_score": verified_score,
                    "cross_stock_score": None,
                    "params": params_to_dict(params),
                    "source_tags": source_tags,
                    "summary": {
                        "ac": symbol_result.get("ac"),
                        "cumulative_return": symbol_result.get("cumulative_return"),
                        "max_drawdown": symbol_result.get("max_drawdown"),
                        "trade_count": symbol_result.get("trade_count"),
                        "stability_score": symbol_result.get("stability_score"),
                        "holdout_score": symbol_result.get("holdout_score"),
                    },
                    "symbol_results": [symbol_result],
                    "warnings": symbol_result.get("warnings", []),
                }
            )
        else:
            cross_result = evaluate_candidate_across_symbols(
                symbols=symbols,
                rows_by_symbol=train_plus_validation_rows_by_symbol,
                validation_rows_by_symbol=validation_rows_by_symbol,
                params=params,
                settings=settings,
                validation_config=validation_config,
            )
            symbol_results = cross_result["symbol_results"]
            success_items = [row for row in symbol_results if row.get("success")]
            summary = {
                "ac": round(mean([float(row.get("ac") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                "cumulative_return": round(mean([float(row.get("cumulative_return") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                "max_drawdown": round(mean([float(row.get("max_drawdown") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                "trade_count": round(mean([float(row.get("trade_count") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                "stability_score": round(mean([float(row.get("stability_score") or 0.0) for row in success_items]), 6) if success_items else 0.0,
                "holdout_score": None,
            }
            ranked_results.append(
                {
                    "rank": 0,
                    "predicted_score": round(predicted_score, 6) if predicted_score is not None else None,
                    "validation_score": None,
                    "verified_score": None,
                    "cross_stock_score": cross_result["cross_stock_score"],
                    "params": params_to_dict(params),
                    "source_tags": source_tags,
                    "summary": summary,
                    "symbol_results": symbol_results,
                    "warnings": cross_result["warnings"],
                }
            )

    if ranking_basis == "verified_score":
        ranked_results.sort(key=lambda item: float(item.get("verified_score") or 0.0), reverse=True)
    else:
        ranked_results.sort(key=lambda item: float(item.get("cross_stock_score") or 0.0), reverse=True)
    ranked_results = ranked_results[: settings.top_n]
    for idx, item in enumerate(ranked_results, start=1):
        item["rank"] = idx

    ranked_results, final_holdout_warnings = _attach_final_holdout_results(
        ranked_results=ranked_results,
        settings=settings,
        symbols=symbols,
        final_holdout_rows_by_symbol=final_holdout_rows_by_symbol,
    )
    warnings.extend(final_holdout_warnings)

    return summarize_auto_search_result(
        settings=settings,
        candidate_count=candidate_count,
        evaluated_candidate_count=len(ranked_pool),
        final_verified_count=len(evaluated_candidates),
        ranking_basis=ranking_basis,
        ranked_results=ranked_results,
        warnings=warnings,
        split_summary=split_summary,
        adaptive_trace={"enabled": False, "stop_reason": None, "best_score_progression": [], "iterations": []},
    )
