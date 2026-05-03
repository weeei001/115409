from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from itertools import product
from statistics import mean, pstdev
from typing import Any, Optional

from .core_mode_engine import run_core_mode_pipeline
from .core_mode_types import (
    BacktestSummary,
    CoreModeParams,
    MarketRow,
    WalkForwardFoldSummary,
    clip,
    params_to_dict,
)


@dataclass
class FoldIndex:
    train_start: int
    train_end: int
    validation_start: int
    validation_end: int
    test_start: int
    test_end: int


@dataclass(frozen=True)
class ValidationConfig:
    mode: str = "rolling_walk_forward"
    step_days: Optional[int] = None
    min_overlap_ratio: Optional[float] = None
    holdout_enabled: bool = True
    holdout_days: Optional[int] = None


@dataclass
class CandidateEvaluation:
    params: CoreModeParams
    walk_forward: list[WalkForwardFoldSummary]
    aggregate_summary: BacktestSummary
    holdout_summary: BacktestSummary
    return_score: float
    stable_score: float
    balanced_score: float


def _safe_mean(values: list[float]) -> float:
    return mean(values) if values else 0.0


def _safe_std(values: list[float]) -> float:
    return pstdev(values) if len(values) > 1 else 0.0


def _normalize_validation_config(config: ValidationConfig | None) -> ValidationConfig:
    cfg = config or ValidationConfig()
    mode = cfg.mode if cfg.mode in {"rolling_walk_forward", "expanding_walk_forward"} else "rolling_walk_forward"
    step_days = max(1, int(cfg.step_days)) if cfg.step_days is not None else None
    min_overlap_ratio = None
    if cfg.min_overlap_ratio is not None:
        min_overlap_ratio = clip(float(cfg.min_overlap_ratio), 0.0, 1.0)
    holdout_days = max(20, int(cfg.holdout_days)) if cfg.holdout_days is not None else None
    return ValidationConfig(
        mode=mode,
        step_days=step_days,
        min_overlap_ratio=min_overlap_ratio,
        holdout_enabled=bool(cfg.holdout_enabled),
        holdout_days=holdout_days,
    )


def _empty_summary() -> BacktestSummary:
    return BacktestSummary(
        ac=0.0,
        win_rate=0.0,
        expectancy=0.0,
        profit_factor=0.0,
        cumulative_return=0.0,
        max_drawdown=0.0,
        trade_count=0,
        avg_mfe=0.0,
        avg_mae=0.0,
        future_trend_quality=0.0,
        stability=0.0,
    )


def _pick_window_sizes(total_rows: int) -> dict[str, int]:
    if total_rows >= 252 * 6:
        return {
            "train": 252 * 3,
            "validation": 252,
            "test": 252,
            "step": 126,
            "holdout": 252,
        }
    if total_rows >= 252 * 4:
        return {
            "train": 252 * 2,
            "validation": 252,
            "test": 180,
            "step": 84,
            "holdout": 126,
        }

    holdout = max(42, int(total_rows * 0.15))
    usable = max(120, total_rows - holdout)
    train = max(90, int(usable * 0.5))
    validation = max(42, int(usable * 0.2))
    test = max(42, int(usable * 0.2))
    step = max(21, min(test // 2, 63))
    return {
        "train": train,
        "validation": validation,
        "test": test,
        "step": step,
        "holdout": holdout,
    }


def build_walk_forward_indices(
    rows: list[MarketRow],
    validation_config: ValidationConfig | None = None,
) -> tuple[list[FoldIndex], tuple[int, int]]:
    cfg = _pick_window_sizes(len(rows))
    normalized = _normalize_validation_config(validation_config)

    min_required = cfg["train"] + cfg["validation"] + cfg["test"]
    if normalized.holdout_enabled:
        requested_holdout = normalized.holdout_days if normalized.holdout_days is not None else cfg["holdout"]
        requested_holdout = min(requested_holdout, max(0, len(rows) - 1))
        holdout_start = max(min_required, len(rows) - requested_holdout)
        holdout_start = min(holdout_start, len(rows))
        holdout_range = (holdout_start, len(rows))
    else:
        holdout_start = len(rows)
        holdout_range = (len(rows), len(rows))

    if len(rows) < 120:
        return [], holdout_range

    step_days = normalized.step_days if normalized.step_days is not None else cfg["step"]
    min_overlap_ratio = normalized.min_overlap_ratio

    folds: list[FoldIndex] = []
    offset = 0
    while True:
        if normalized.mode == "expanding_walk_forward":
            train_start = 0
            train_end = cfg["train"] + offset
        else:
            train_start = offset
            train_end = train_start + cfg["train"]

        validation_start = train_end
        validation_end = validation_start + cfg["validation"]
        test_start = validation_end
        test_end = test_start + cfg["test"]

        if test_end > holdout_start:
            break

        current = FoldIndex(
            train_start=train_start,
            train_end=train_end,
            validation_start=validation_start,
            validation_end=validation_end,
            test_start=test_start,
            test_end=test_end,
        )

        if not folds:
            folds.append(current)
        else:
            overlap_ratio = _segment_overlap_ratio(current, folds[-1])
            if min_overlap_ratio is None or overlap_ratio >= min_overlap_ratio:
                folds.append(current)

        offset += step_days

    if not folds and holdout_start > 90:
        train_end = max(60, int(holdout_start * 0.6))
        validation_end = max(train_end + 20, int(holdout_start * 0.8))
        if validation_end < holdout_start:
            folds.append(
                FoldIndex(
                    train_start=0,
                    train_end=train_end,
                    validation_start=train_end,
                    validation_end=validation_end,
                    test_start=validation_end,
                    test_end=holdout_start,
                )
            )

    return folds, holdout_range


def _segment_overlap_ratio(current: FoldIndex, previous: FoldIndex | None) -> float:
    if previous is None:
        return 0.0

    curr_start, curr_end = current.train_start, current.test_end
    prev_start, prev_end = previous.train_start, previous.test_end
    overlap = max(0, min(curr_end, prev_end) - max(curr_start, prev_start))
    union = (curr_end - curr_start) + (prev_end - prev_start) - overlap
    if union <= 0:
        return 0.0
    return overlap / union


def _summary_from_pipeline(rows: list[MarketRow], params: CoreModeParams) -> BacktestSummary:
    if len(rows) < 20:
        return _empty_summary()
    return run_core_mode_pipeline(rows, params)["summary"]


def build_validation_design(rows: list[MarketRow], validation_config: ValidationConfig | None = None) -> dict[str, Any]:
    cfg = _pick_window_sizes(len(rows))
    normalized = _normalize_validation_config(validation_config)
    folds, holdout_range = build_walk_forward_indices(rows, normalized)
    holdout_start, holdout_end = holdout_range

    fold_ranges: list[dict[str, Any]] = []
    for idx, fold in enumerate(folds, start=1):
        fold_ranges.append(
            {
                "fold_id": f"fold_{idx}",
                "train_start": rows[fold.train_start].date.isoformat(),
                "train_end": rows[fold.train_end - 1].date.isoformat(),
                "validation_start": rows[fold.validation_start].date.isoformat(),
                "validation_end": rows[fold.validation_end - 1].date.isoformat(),
                "test_start": rows[fold.test_start].date.isoformat(),
                "test_end": rows[fold.test_end - 1].date.isoformat(),
                "overlap_ratio_to_prev": round(_segment_overlap_ratio(fold, folds[idx - 2] if idx > 1 else None), 4),
            }
        )

    overlap_values = [item["overlap_ratio_to_prev"] for item in fold_ranges[1:]]
    holdout_payload: dict[str, Any] = {
        "enabled": normalized.holdout_enabled,
        "start_index": holdout_start,
        "end_index": holdout_end,
    }
    if rows and holdout_start < len(rows):
        holdout_payload["start_date"] = rows[holdout_start].date.isoformat()
        holdout_payload["end_date"] = rows[holdout_end - 1].date.isoformat()

    return {
        "window": {
            "train_days": cfg["train"],
            "validation_days": cfg["validation"],
            "test_days": cfg["test"],
            "step_days": normalized.step_days if normalized.step_days is not None else cfg["step"],
            "holdout_days": (
                normalized.holdout_days if normalized.holdout_days is not None else (cfg["holdout"] if normalized.holdout_enabled else 0)
            ),
        },
        "mode": normalized.mode,
        "fold_count": len(fold_ranges),
        "folds": fold_ranges,
        "overlap": {
            "avg_overlap_ratio": round(_safe_mean(overlap_values), 4),
            "min_overlap_ratio": round(min(overlap_values), 4) if overlap_values else 0.0,
            "max_overlap_ratio": round(max(overlap_values), 4) if overlap_values else 0.0,
            "applied_min_overlap_ratio": normalized.min_overlap_ratio,
        },
        "holdout": holdout_payload,
    }


def evaluate_params_with_walk_forward(
    rows: list[MarketRow],
    params: CoreModeParams,
    validation_config: ValidationConfig | None = None,
) -> CandidateEvaluation:
    normalized = _normalize_validation_config(validation_config)
    folds, holdout_range = build_walk_forward_indices(rows, normalized)

    fold_summaries: list[WalkForwardFoldSummary] = []
    prev: FoldIndex | None = None

    for fold_idx, fold in enumerate(folds, start=1):
        validation_rows = rows[fold.validation_start : fold.validation_end]
        test_rows = rows[fold.test_start : fold.test_end]

        validation_metrics = _summary_from_pipeline(validation_rows, params)
        test_metrics = _summary_from_pipeline(test_rows, params)
        overlap_ratio = _segment_overlap_ratio(fold, prev)
        prev = fold

        fold_summaries.append(
            WalkForwardFoldSummary(
                fold_id=f"fold_{fold_idx}",
                overlap_ratio=overlap_ratio,
                train_start=rows[fold.train_start].date,
                train_end=rows[fold.train_end - 1].date,
                validation_start=rows[fold.validation_start].date,
                validation_end=rows[fold.validation_end - 1].date,
                test_start=rows[fold.test_start].date,
                test_end=rows[fold.test_end - 1].date,
                validation_metrics=validation_metrics,
                test_metrics=test_metrics,
            )
        )

    test_metrics_list = [item.test_metrics for item in fold_summaries]
    if test_metrics_list:
        ac_values = [m.ac for m in test_metrics_list]
        return_values = [m.cumulative_return for m in test_metrics_list]
        drawdown_values = [m.max_drawdown for m in test_metrics_list]
        ac_std = _safe_std(ac_values)
        ret_std = _safe_std(return_values)
        dd_std = _safe_std(drawdown_values)
        stability = clip(1.0 - ((ac_std * 0.8) + (ret_std * 0.7) + (dd_std * 0.6)), 0.0, 1.0)

        aggregate = BacktestSummary(
            ac=round(_safe_mean([m.ac for m in test_metrics_list]), 4),
            win_rate=round(_safe_mean([m.win_rate for m in test_metrics_list]), 4),
            expectancy=round(_safe_mean([m.expectancy for m in test_metrics_list]), 4),
            profit_factor=round(_safe_mean([m.profit_factor for m in test_metrics_list]), 4),
            cumulative_return=round(_safe_mean([m.cumulative_return for m in test_metrics_list]), 4),
            max_drawdown=round(_safe_mean([m.max_drawdown for m in test_metrics_list]), 4),
            trade_count=int(round(_safe_mean([float(m.trade_count) for m in test_metrics_list]))),
            avg_mfe=round(_safe_mean([m.avg_mfe for m in test_metrics_list]), 4),
            avg_mae=round(_safe_mean([m.avg_mae for m in test_metrics_list]), 4),
            future_trend_quality=round(_safe_mean([m.future_trend_quality for m in test_metrics_list]), 4),
            stability=round(stability, 4),
        )
    else:
        holdout_start, _ = holdout_range
        non_holdout_rows = rows[:holdout_start] if holdout_start > 0 else rows
        aggregate = _summary_from_pipeline(non_holdout_rows, params)

    holdout_start, holdout_end = holdout_range
    if normalized.holdout_enabled and holdout_start < holdout_end:
        holdout_rows = rows[holdout_start:holdout_end]
        holdout_summary = _summary_from_pipeline(holdout_rows, params)
    else:
        holdout_summary = _empty_summary()

    ac_norm = clip(aggregate.ac, 0.0, 1.0)
    return_norm = clip((aggregate.cumulative_return + 0.15) / 0.80, 0.0, 1.0)
    expectancy_norm = clip((aggregate.expectancy + 0.03) / 0.10, 0.0, 1.0)
    profit_factor_norm = clip(aggregate.profit_factor / 2.5, 0.0, 1.0)
    drawdown_penalty = clip(1.0 - (aggregate.max_drawdown / 0.45), 0.0, 1.0)
    quality_norm = clip(aggregate.future_trend_quality, 0.0, 1.0)
    stability_norm = clip(aggregate.stability, 0.0, 1.0)
    mae_penalty = clip(1.0 - (aggregate.avg_mae / 0.15), 0.0, 1.0)

    # 目標函數僅使用 walk-forward 聚合摘要；holdout 僅做最終檢查，不參與排序。
    return_score = (
        0.55 * return_norm
        + 0.30 * expectancy_norm
        + 0.15 * profit_factor_norm
    )
    stable_score = (
        0.30 * stability_norm
        + 0.25 * drawdown_penalty
        + 0.15 * ac_norm
        + 0.15 * quality_norm
        + 0.10 * mae_penalty
        + 0.05 * profit_factor_norm
    )
    balanced_score = (
        0.18 * ac_norm
        + 0.16 * expectancy_norm
        + 0.14 * profit_factor_norm
        + 0.14 * quality_norm
        + 0.16 * drawdown_penalty
        + 0.16 * stability_norm
        + 0.06 * return_norm
    )

    return CandidateEvaluation(
        params=params,
        walk_forward=fold_summaries,
        aggregate_summary=aggregate,
        holdout_summary=holdout_summary,
        return_score=round(return_score, 6),
        stable_score=round(stable_score, 6),
        balanced_score=round(balanced_score, 6),
    )


def _dedupe_params(params_list: list[CoreModeParams]) -> list[CoreModeParams]:
    seen: set[tuple[Any, ...]] = set()
    out: list[CoreModeParams] = []
    for item in params_list:
        key = tuple(params_to_dict(item).items())
        if key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def _weighted_profiles() -> dict[str, dict[str, float]]:
    return {
        "balanced": {
            "weighted_technical_weight": 0.38,
            "weighted_institutional_weight": 0.30,
            "weighted_news_weight": 0.15,
            "weighted_momentum_weight": 0.17,
        },
        "technical_first": {
            "weighted_technical_weight": 0.55,
            "weighted_institutional_weight": 0.20,
            "weighted_news_weight": 0.05,
            "weighted_momentum_weight": 0.20,
        },
        "institutional_first": {
            "weighted_technical_weight": 0.25,
            "weighted_institutional_weight": 0.50,
            "weighted_news_weight": 0.05,
            "weighted_momentum_weight": 0.20,
        },
        "momentum_first": {
            "weighted_technical_weight": 0.25,
            "weighted_institutional_weight": 0.20,
            "weighted_news_weight": 0.05,
            "weighted_momentum_weight": 0.50,
        },
        "technical_institutional_balance": {
            "weighted_technical_weight": 0.45,
            "weighted_institutional_weight": 0.35,
            "weighted_news_weight": 0.05,
            "weighted_momentum_weight": 0.15,
        },
        "low_news": {
            "weighted_technical_weight": 0.42,
            "weighted_institutional_weight": 0.33,
            "weighted_news_weight": 0.00,
            "weighted_momentum_weight": 0.25,
        },
    }


def _build_weighted_profile_candidates(seed_params: list[CoreModeParams]) -> list[CoreModeParams]:
    profiled: list[CoreModeParams] = []
    for base in seed_params:
        base_dict = params_to_dict(base)
        for profile_weights in _weighted_profiles().values():
            profiled.append(CoreModeParams(**{**base_dict, **profile_weights}))
    return _dedupe_params(profiled)


def _search_profile(total_rows: int) -> dict[str, Any]:
    if total_rows >= 252 * 6:
        return {
            "lookback_span": 15,
            "momentum_span": 10,
            "threshold_span": 0.06,
            "trend_span": 0.08,
            "pullback_span": 0.05,
            "stop_span": 0.04,
            "coarse_eval_limit": 180,
            "coarse_top_k": 15,
            "seed_k": 6,
            "local_int_step": 2,
            "local_float_step": 0.01,
        }
    if total_rows >= 252 * 4:
        return {
            "lookback_span": 12,
            "momentum_span": 8,
            "threshold_span": 0.05,
            "trend_span": 0.07,
            "pullback_span": 0.04,
            "stop_span": 0.035,
            "coarse_eval_limit": 150,
            "coarse_top_k": 12,
            "seed_k": 5,
            "local_int_step": 2,
            "local_float_step": 0.01,
        }
    return {
        "lookback_span": 8,
        "momentum_span": 6,
        "threshold_span": 0.04,
        "trend_span": 0.06,
        "pullback_span": 0.03,
        "stop_span": 0.03,
        "coarse_eval_limit": 110,
        "coarse_top_k": 10,
        "seed_k": 4,
        "local_int_step": 1,
        "local_float_step": 0.01,
    }


def _grid_int_values(center: int, low: int, high: int, span: int) -> list[int]:
    values = sorted({max(low, min(high, center - span)), center, max(low, min(high, center + span))})
    return values


def _grid_float_values(center: float, low: float, high: float, span: float) -> list[float]:
    values = sorted(
        {
            round(max(low, min(high, center - span)), 4),
            round(center, 4),
            round(max(low, min(high, center + span)), 4),
        }
    )
    return values


def _min_step(values: list[float | int]) -> float:
    if len(values) < 2:
        return 0.0
    diffs = [abs(float(values[idx]) - float(values[idx - 1])) for idx in range(1, len(values))]
    return round(min(diff for diff in diffs if diff > 0), 4) if any(diff > 0 for diff in diffs) else 0.0


def _coarse_grid_candidates(base: CoreModeParams, *, total_rows: int) -> tuple[list[CoreModeParams], dict[str, Any]]:
    profile = _search_profile(total_rows)
    levels: dict[str, list[float | int]] = {
        "breakout_lookback": _grid_int_values(base.breakout_lookback, 10, 90, profile["lookback_span"]),
        "momentum_window": _grid_int_values(base.momentum_window, 5, 60, profile["momentum_span"]),
        "state_threshold": _grid_float_values(base.state_threshold, 0.05, 0.60, profile["threshold_span"]),
        "shape_threshold": _grid_float_values(base.shape_threshold, 0.05, 0.60, profile["threshold_span"]),
        "trend_threshold": _grid_float_values(base.trend_threshold, 0.05, 0.80, profile["trend_span"]),
        "max_pullback_depth": _grid_float_values(base.max_pullback_depth, 0.03, 0.40, profile["pullback_span"]),
        "hard_stop_pct": _grid_float_values(base.hard_stop_pct, 0.01, 0.30, profile["stop_span"]),
        "trailing_stop_pct": _grid_float_values(base.trailing_stop_pct, 0.01, 0.30, profile["stop_span"]),
    }

    keys = list(levels.keys())
    all_combos = list(product(*(levels[key] for key in keys)))
    limit = profile["coarse_eval_limit"]
    stride = max(1, len(all_combos) // limit)
    sampled = all_combos[::stride][:limit]

    candidates: list[CoreModeParams] = []
    for combo in sampled:
        data = dict(zip(keys, combo, strict=True))
        candidates.append(
            CoreModeParams(
                breakout_lookback=int(data["breakout_lookback"]),
                momentum_window=int(data["momentum_window"]),
                state_threshold=float(data["state_threshold"]),
                shape_threshold=float(data["shape_threshold"]),
                trend_threshold=float(data["trend_threshold"]),
                max_pullback_depth=float(data["max_pullback_depth"]),
                hard_stop_pct=float(data["hard_stop_pct"]),
                trailing_stop_pct=float(data["trailing_stop_pct"]),
            )
        )

    coarse_space = {
        key: {
            "min": values[0],
            "max": values[-1],
            "step": _min_step(values),
            "values": values,
        }
        for key, values in levels.items()
    }

    return _dedupe_params(candidates), {
        "coarse": coarse_space,
        "coarse_total_combinations": len(all_combos),
        "coarse_sampled_combinations": len(sampled),
        "coarse_eval_limit": limit,
    }


def _local_refinement_candidates(seed_params: list[CoreModeParams], *, total_rows: int) -> tuple[list[CoreModeParams], dict[str, Any]]:
    profile = _search_profile(total_rows)
    int_step = int(profile["local_int_step"])
    float_step = float(profile["local_float_step"])
    int_deltas = (-2 * int_step, -int_step, int_step, 2 * int_step)
    float_deltas = (-2 * float_step, -float_step, float_step, 2 * float_step)

    refined: list[CoreModeParams] = []
    for base in seed_params:
        refined.append(base)
        base_dict = params_to_dict(base)

        for delta in int_deltas:
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "breakout_lookback": max(10, min(90, base.breakout_lookback + delta)),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "momentum_window": max(5, min(60, base.momentum_window + delta)),
                    }
                )
            )

        for delta in float_deltas:
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "state_threshold": round(max(0.05, min(0.60, base.state_threshold + delta)), 4),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "shape_threshold": round(max(0.05, min(0.60, base.shape_threshold + delta)), 4),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "trend_threshold": round(max(0.05, min(0.80, base.trend_threshold + delta)), 4),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "max_pullback_depth": round(max(0.03, min(0.40, base.max_pullback_depth + delta)), 4),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "hard_stop_pct": round(max(0.01, min(0.30, base.hard_stop_pct + delta)), 4),
                    }
                )
            )
            refined.append(
                CoreModeParams(
                    **{
                        **base_dict,
                        "trailing_stop_pct": round(max(0.01, min(0.30, base.trailing_stop_pct + delta)), 4),
                    }
                )
            )

    refined_deduped = _dedupe_params(refined)
    refinement_space = {
        "strategy": "先 coarse grid，再以高分 seed 做局部微調（local refinement）。",
        "seed_count": len(seed_params),
        "int_step": int_step,
        "float_step": float_step,
        "int_deltas": list(int_deltas),
        "float_deltas": [round(v, 4) for v in float_deltas],
    }
    return refined_deduped, refinement_space


def evaluate_candidates(
    rows: list[MarketRow],
    params_list: list[CoreModeParams],
    *,
    validation_config: ValidationConfig | None = None,
) -> list[CandidateEvaluation]:
    out: list[CandidateEvaluation] = []
    for params in params_list:
        out.append(evaluate_params_with_walk_forward(rows, params, validation_config=validation_config))
    return out


def search_best_core_mode_params(
    rows: list[MarketRow],
    base_params: CoreModeParams,
    *,
    validation_config: ValidationConfig | None = None,
) -> dict[str, Any]:
    if len(rows) < 252 * 2:
        raise ValueError("資料不足：至少需要約 2 年交易日，才能執行參數搜尋。")

    profile = _search_profile(len(rows))
    coarse_candidates, coarse_meta = _coarse_grid_candidates(base_params, total_rows=len(rows))
    coarse_results = evaluate_candidates(rows, coarse_candidates, validation_config=validation_config)
    coarse_results.sort(key=lambda item: item.balanced_score, reverse=True)

    coarse_top_k = min(profile["coarse_top_k"], len(coarse_results))
    coarse_top_candidates = coarse_results[:coarse_top_k]
    seed = [item.params for item in coarse_top_candidates[: profile["seed_k"]]]
    weighted_profile_seed = _build_weighted_profile_candidates(seed)

    refined_candidates, refinement_meta = _local_refinement_candidates(weighted_profile_seed, total_rows=len(rows))
    refined_results = evaluate_candidates(rows, refined_candidates, validation_config=validation_config)

    all_results = coarse_results + refined_results
    best_by_param: dict[tuple[Any, ...], CandidateEvaluation] = {}
    for result in all_results:
        key = tuple(params_to_dict(result.params).items())
        existing = best_by_param.get(key)
        if existing is None or result.balanced_score > existing.balanced_score:
            best_by_param[key] = result

    deduped = list(best_by_param.values())
    deduped.sort(key=lambda item: item.balanced_score, reverse=True)
    top_candidates = deduped[:5]

    best_return = max(deduped, key=lambda item: item.return_score)
    best_stable = max(deduped, key=lambda item: item.stable_score)
    best_balanced = max(deduped, key=lambda item: item.balanced_score)

    return {
        "best_return": best_return,
        "best_stable": best_stable,
        "best_balanced": best_balanced,
        "top_candidates": top_candidates,
        "coarse_top_candidates": coarse_top_candidates,
        "coarse_count": len(coarse_results),
        "refined_count": len(refined_results),
        "search_space": {
            **coarse_meta,
            "weighted_profiles": _weighted_profiles(),
            "weighted_profile_seed_count": len(weighted_profile_seed),
            "refinement": refinement_meta,
        },
        "validation_design": build_validation_design(rows, validation_config=validation_config),
    }


def candidate_to_dict(candidate: CandidateEvaluation) -> dict[str, Any]:
    return {
        "params": params_to_dict(candidate.params),
        "summary": {
            "ac": candidate.aggregate_summary.ac,
            "win_rate": candidate.aggregate_summary.win_rate,
            "expectancy": candidate.aggregate_summary.expectancy,
            "profit_factor": candidate.aggregate_summary.profit_factor,
            "cumulative_return": candidate.aggregate_summary.cumulative_return,
            "max_drawdown": candidate.aggregate_summary.max_drawdown,
            "trade_count": candidate.aggregate_summary.trade_count,
            "avg_mfe": candidate.aggregate_summary.avg_mfe,
            "avg_mae": candidate.aggregate_summary.avg_mae,
            "future_trend_quality": candidate.aggregate_summary.future_trend_quality,
            "stability": candidate.aggregate_summary.stability,
        },
        "holdout": {
            "ac": candidate.holdout_summary.ac,
            "win_rate": candidate.holdout_summary.win_rate,
            "expectancy": candidate.holdout_summary.expectancy,
            "profit_factor": candidate.holdout_summary.profit_factor,
            "cumulative_return": candidate.holdout_summary.cumulative_return,
            "max_drawdown": candidate.holdout_summary.max_drawdown,
            "trade_count": candidate.holdout_summary.trade_count,
            "avg_mfe": candidate.holdout_summary.avg_mfe,
            "avg_mae": candidate.holdout_summary.avg_mae,
            "future_trend_quality": candidate.holdout_summary.future_trend_quality,
            "stability": candidate.holdout_summary.stability,
        },
        "return_objective": candidate.return_score,
        "stable_objective": candidate.stable_score,
        "balanced_objective": candidate.balanced_score,
        "walk_forward": [
            {
                "fold_id": fold.fold_id,
                "overlap_ratio": round(fold.overlap_ratio, 4),
                "train_start": fold.train_start.isoformat(),
                "train_end": fold.train_end.isoformat(),
                "validation_start": fold.validation_start.isoformat(),
                "validation_end": fold.validation_end.isoformat(),
                "test_start": fold.test_start.isoformat(),
                "test_end": fold.test_end.isoformat(),
                "validation_metrics": {
                    "ac": fold.validation_metrics.ac,
                    "win_rate": fold.validation_metrics.win_rate,
                    "expectancy": fold.validation_metrics.expectancy,
                    "profit_factor": fold.validation_metrics.profit_factor,
                    "cumulative_return": fold.validation_metrics.cumulative_return,
                    "max_drawdown": fold.validation_metrics.max_drawdown,
                    "trade_count": fold.validation_metrics.trade_count,
                    "avg_mfe": fold.validation_metrics.avg_mfe,
                    "avg_mae": fold.validation_metrics.avg_mae,
                    "future_trend_quality": fold.validation_metrics.future_trend_quality,
                    "stability": fold.validation_metrics.stability,
                },
                "test_metrics": {
                    "ac": fold.test_metrics.ac,
                    "win_rate": fold.test_metrics.win_rate,
                    "expectancy": fold.test_metrics.expectancy,
                    "profit_factor": fold.test_metrics.profit_factor,
                    "cumulative_return": fold.test_metrics.cumulative_return,
                    "max_drawdown": fold.test_metrics.max_drawdown,
                    "trade_count": fold.test_metrics.trade_count,
                    "avg_mfe": fold.test_metrics.avg_mfe,
                    "avg_mae": fold.test_metrics.avg_mae,
                    "future_trend_quality": fold.test_metrics.future_trend_quality,
                    "stability": fold.test_metrics.stability,
                },
            }
            for fold in candidate.walk_forward
        ],
    }
