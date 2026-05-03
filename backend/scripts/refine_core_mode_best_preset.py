from __future__ import annotations

import argparse
import json
import random
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.core_mode import CoreModeService
from trend_core import normalize_core_mode_params, params_to_dict

PRESET_NAME_BEST = "最佳"
DEFAULT_IMPROVED_PRESET_NAME = "最佳_v2"
DEFAULT_CONSERVATIVE_PRESET_NAME = "最佳_保守版"
DEFAULT_OUTPUT_DIR = Path("backend/outputs/core_mode_refinement")

INT_VARIATION_KEYS = ("breakout_lookback", "momentum_window")
THRESHOLD_VARIATION_KEYS = (
    "state_threshold",
    "shape_threshold",
    "trend_threshold",
    "max_pullback_depth",
    "hard_stop_pct",
    "trailing_stop_pct",
)
WEIGHT_VARIATION_KEYS = (
    "state_weighted_score_weight",
    "state_momentum_weight",
    "state_institutional_weight",
    "trend_state_weight",
    "trend_shape_weight",
    "trend_breakout_weight",
    "shape_breakout_weight",
    "shape_slope_weight",
    "shape_efficiency_weight",
    "shape_pullback_weight",
)


@dataclass
class RefinementOptions:
    preset_name: str
    symbol: str
    start_date: str
    end_date: str
    mode: str = "single_stock_search"
    refinement_level: str = "medium"
    max_candidates: int = 120
    formal_backtest_top_k: int = 30
    save_improved_preset: bool = True
    improved_preset_name: str = DEFAULT_IMPROVED_PRESET_NAME
    dry_run: bool = False
    output_dir: Path = DEFAULT_OUTPUT_DIR
    preset_store_path: Path = Path("backend/data/core_mode_presets.json")
    seed: int = 42
    seeds: list[int] | None = None
    seed_start: int | None = None
    seed_end: int | None = None
    seed_step: int = 1
    save_each_improved: bool = False
    stop_on_first_improvement: bool = False
    min_improvement: float = 0.015
    allow_conservative_variant: bool = False


def parse_bool(value: str) -> bool:
    lowered = (value or "").strip().lower()
    if lowered in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if lowered in {"0", "false", "f", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError(f"Invalid boolean value: {value}")


def _normalize_runtime_relative_path(raw: str | Path) -> Path:
    path = Path(raw)
    if path.is_absolute():
        return path
    if path.parts and path.parts[0].lower() == "backend" and Path.cwd().name.lower() == "backend":
        stripped_parts = path.parts[1:]
        if stripped_parts:
            return Path(*stripped_parts)
    return path


def clip(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def candidate_fingerprint(params: dict[str, Any]) -> str:
    return json.dumps(params, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def compute_selection_score(
    *,
    ac: float,
    cumulative_return: float,
    max_drawdown: float,
    stability_score: float,
    trade_count: int,
    profit_factor: float,
) -> float:
    ac_score = clip(ac, 0.0, 1.0)
    profit_factor_score = clip(profit_factor / 3.0, 0.0, 1.0)
    drawdown_score = clip(1.0 - (abs(max_drawdown) / 0.35), 0.0, 1.0)
    stability_score_norm = clip(stability_score, 0.0, 1.0)
    return_score = clip((cumulative_return - (-0.20)) / 0.80, 0.0, 1.0)
    trade_count_score = clip(float(trade_count) / 30.0, 0.0, 1.0)
    return round(
        (0.20 * ac_score)
        + (0.20 * profit_factor_score)
        + (0.20 * drawdown_score)
        + (0.15 * stability_score_norm)
        + (0.15 * return_score)
        + (0.10 * trade_count_score),
        6,
    )


def _parse_iso_datetime(value: Any) -> datetime:
    if not isinstance(value, str):
        return datetime.fromtimestamp(0, tz=UTC)
    raw = value.strip()
    if not raw:
        return datetime.fromtimestamp(0, tz=UTC)
    normalized = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return datetime.fromtimestamp(0, tz=UTC)
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def load_preset_by_name(service: CoreModeService, preset_name: str) -> dict[str, Any]:
    presets = [item for item in (service.get_presets().get("presets") or []) if isinstance(item, dict)]
    matches = [item for item in presets if str(item.get("name") or "") == preset_name]
    if not matches:
        raise ValueError(f'Preset named "{preset_name}" was not found.')
    matches.sort(
        key=lambda item: (
            _parse_iso_datetime(item.get("updated_at")),
            _parse_iso_datetime(item.get("created_at")),
        ),
        reverse=True,
    )
    selected = deepcopy(matches[0])
    selected["params"] = params_to_dict(normalize_core_mode_params(selected.get("params") or {}))
    return selected


def _add_candidate(
    registry: dict[str, dict[str, Any]],
    *,
    params: dict[str, Any],
    source_tag: str,
) -> None:
    normalized = params_to_dict(normalize_core_mode_params(params))
    fp = candidate_fingerprint(normalized)
    existing = registry.get(fp)
    if existing is None:
        registry[fp] = {
            "candidate_id": "",
            "fingerprint": fp,
            "params": normalized,
            "source_tags": [source_tag],
        }
        return
    tags = set(existing.get("source_tags") or [])
    tags.add(source_tag)
    existing["source_tags"] = sorted(tags)


def generate_local_candidates(
    base_params: dict[str, Any],
    *,
    refinement_level: str = "medium",
    max_candidates: int = 120,
    seed: int = 42,
) -> list[dict[str, Any]]:
    registry: dict[str, dict[str, Any]] = {}
    base = params_to_dict(normalize_core_mode_params(base_params))
    _add_candidate(registry, params=base, source_tag="base")

    int_deltas = [-4, -2, -1, 1, 2, 4]
    threshold_deltas = {
        "state_threshold": [-0.02, -0.01, 0.01, 0.02],
        "shape_threshold": [-0.02, -0.01, 0.01, 0.02],
        "trend_threshold": [-0.02, -0.01, 0.01, 0.02],
        "max_pullback_depth": [-0.03, -0.015, 0.015, 0.03],
        "hard_stop_pct": [-0.02, -0.01, 0.01, 0.02],
        "trailing_stop_pct": [-0.02, -0.01, 0.01, 0.02],
    }
    weight_deltas = [-0.02, 0.02] if refinement_level == "small" else [-0.03, 0.03]
    if refinement_level == "large":
        weight_deltas = [-0.04, -0.02, 0.02, 0.04]

    for key in INT_VARIATION_KEYS:
        for delta in int_deltas:
            raw = dict(base)
            raw[key] = int(raw[key]) + delta
            _add_candidate(registry, params=raw, source_tag=f"one_param:{key}")

    for key in THRESHOLD_VARIATION_KEYS:
        for delta in threshold_deltas[key]:
            raw = dict(base)
            raw[key] = float(raw[key]) + delta
            _add_candidate(registry, params=raw, source_tag=f"one_param:{key}")

    pair_steps: list[tuple[str, str, float, str]] = [
        ("state_threshold", "trend_threshold", 0.01, "paired:state_trend_threshold"),
        ("shape_threshold", "trend_threshold", 0.01, "paired:shape_trend_threshold"),
        ("breakout_lookback", "momentum_window", 2.0, "paired:breakout_momentum"),
        ("hard_stop_pct", "trailing_stop_pct", 0.01, "paired:hard_trailing_stop"),
    ]
    for key_a, key_b, step, tag in pair_steps:
        for sign_a in (-1.0, 1.0):
            for sign_b in (-1.0, 1.0):
                raw = dict(base)
                if key_a in INT_VARIATION_KEYS:
                    raw[key_a] = int(raw[key_a]) + int(sign_a * step)
                else:
                    raw[key_a] = float(raw[key_a]) + (sign_a * step)
                if key_b in INT_VARIATION_KEYS:
                    raw[key_b] = int(raw[key_b]) + int(sign_b * step)
                else:
                    raw[key_b] = float(raw[key_b]) + (sign_b * step)
                _add_candidate(registry, params=raw, source_tag=tag)

    for key in WEIGHT_VARIATION_KEYS:
        for delta in weight_deltas:
            raw = dict(base)
            raw[key] = float(raw[key]) + delta
            _add_candidate(registry, params=raw, source_tag=f"one_param:{key}")

    jitter_rounds = {"small": 12, "medium": 28, "large": 56}.get(refinement_level, 28)
    rng = random.Random(seed)
    for _ in range(jitter_rounds):
        raw = dict(base)
        raw["breakout_lookback"] = int(raw["breakout_lookback"]) + rng.randint(-4, 4)
        raw["momentum_window"] = int(raw["momentum_window"]) + rng.randint(-4, 4)
        raw["state_threshold"] = float(raw["state_threshold"]) + rng.uniform(-0.02, 0.02)
        raw["shape_threshold"] = float(raw["shape_threshold"]) + rng.uniform(-0.02, 0.02)
        raw["trend_threshold"] = float(raw["trend_threshold"]) + rng.uniform(-0.02, 0.02)
        raw["max_pullback_depth"] = float(raw["max_pullback_depth"]) + rng.uniform(-0.03, 0.03)
        raw["hard_stop_pct"] = float(raw["hard_stop_pct"]) + rng.uniform(-0.02, 0.02)
        raw["trailing_stop_pct"] = float(raw["trailing_stop_pct"]) + rng.uniform(-0.02, 0.02)
        for key in WEIGHT_VARIATION_KEYS:
            raw[key] = float(raw[key]) + rng.uniform(-0.03, 0.03)
        _add_candidate(registry, params=raw, source_tag="random_jitter")
        if len(registry) >= max_candidates:
            break

    rows = list(registry.values())[: max(1, int(max_candidates))]
    for idx, row in enumerate(rows):
        row["candidate_id"] = "BASE" if idx == 0 else f"C{idx:03d}"
    return rows


def _run_formal_backtest(
    *,
    service: CoreModeService,
    options: RefinementOptions,
    params: dict[str, Any],
) -> dict[str, Any]:
    request = {
        "symbol": options.symbol,
        "date_range": {"start_date": options.start_date, "end_date": options.end_date},
        "params": deepcopy(params),
        "run_optimization": False,
        "auto_search_settings": {
            "enabled": False,
            "mode": options.mode,
            "symbols": [options.symbol],
        },
    }
    result = service.run_core_mode(request)
    summary = result.get("summary") if isinstance(result.get("summary"), dict) else {}
    holdout_summary = {}
    walk_forward = result.get("walk_forward")
    if isinstance(walk_forward, dict) and isinstance(walk_forward.get("holdout"), dict):
        holdout_summary = dict(walk_forward.get("holdout") or {})

    return {
        "enabled": True,
        "success": True,
        "summary": {
            "ac": summary.get("ac"),
            "cumulative_return": summary.get("cumulative_return"),
            "max_drawdown": summary.get("max_drawdown"),
            "stability_score": summary.get("stability"),
            "win_rate": summary.get("win_rate"),
            "trade_count": summary.get("trade_count"),
            "profit_factor": summary.get("profit_factor"),
        },
        "final_holdout_score": safe_float(summary.get("final_holdout_score")),
        "final_holdout_summary": holdout_summary,
        "warnings": list(result.get("warnings") or []),
    }


def _passes_safety_filters(row: dict[str, Any]) -> bool:
    return (
        safe_int(row.get("trade_count")) >= 10
        and (safe_float(row.get("profit_factor")) or 0.0) >= 1.5
        and (safe_float(row.get("max_drawdown")) or 0.0) <= 0.20
        and (safe_float(row.get("stability_score")) or 0.0) >= 0.85
    )


def _is_meaningful_improvement(base_row: dict[str, Any], best_row: dict[str, Any], *, min_improvement: float) -> bool:
    base_score = safe_float(base_row.get("selection_score")) or 0.0
    best_score = safe_float(best_row.get("selection_score")) or 0.0
    return (best_score - base_score) >= min_improvement


def _is_conservative_variant(
    base_row: dict[str, Any],
    best_row: dict[str, Any],
    *,
    min_improvement: float,
) -> bool:
    base_score = safe_float(base_row.get("selection_score")) or 0.0
    best_score = safe_float(best_row.get("selection_score")) or 0.0
    improvement = best_score - base_score
    if improvement >= min_improvement:
        return False

    base_mdd = safe_float(base_row.get("max_drawdown")) or 0.0
    best_mdd = safe_float(best_row.get("max_drawdown")) or 0.0
    base_pf = safe_float(base_row.get("profit_factor")) or 0.0
    best_pf = safe_float(best_row.get("profit_factor")) or 0.0
    base_stability = safe_float(base_row.get("stability_score")) or 0.0
    best_stability = safe_float(best_row.get("stability_score")) or 0.0
    base_trade_count = safe_int(base_row.get("trade_count"))
    best_trade_count = safe_int(best_row.get("trade_count"))
    base_return = safe_float(base_row.get("cumulative_return")) or 0.0
    best_return = safe_float(best_row.get("cumulative_return")) or 0.0

    return (
        (base_mdd - best_mdd) >= 0.005
        and best_pf > base_pf
        and best_stability > base_stability
        and best_trade_count >= base_trade_count
        and best_return >= (base_return - 0.06)
    )


def evaluate_refinement_candidates(
    candidates: list[dict[str, Any]],
    *,
    service: CoreModeService,
    options: RefinementOptions,
) -> tuple[list[dict[str, Any]], list[str]]:
    rows: list[dict[str, Any]] = []
    global_warnings: list[str] = []
    formal_k = max(1, min(max(0, int(options.formal_backtest_top_k)), len(candidates)))

    for idx, candidate in enumerate(candidates):
        row: dict[str, Any] = {
            "candidate_id": candidate.get("candidate_id"),
            "is_base": bool(candidate.get("candidate_id") == "BASE"),
            "source_tags": list(candidate.get("source_tags") or []),
            "params": deepcopy(candidate.get("params") or {}),
            "selection_score": None,
            "ac": None,
            "cumulative_return": None,
            "max_drawdown": None,
            "stability_score": None,
            "win_rate": None,
            "trade_count": None,
            "profit_factor": None,
            "final_holdout_score": None,
            "generalization_gap": None,
            "final_holdout_summary": {},
            "warnings": [],
            "safety_passed": False,
            "formal_backtest": {"enabled": False, "success": False},
        }

        if idx >= formal_k:
            row["warnings"] = [f"formal backtest skipped because rank>{formal_k}"]
            rows.append(row)
            continue

        try:
            formal = _run_formal_backtest(
                service=service,
                options=options,
                params=deepcopy(row["params"]),
            )
            row["formal_backtest"] = formal
            summary = formal.get("summary") if isinstance(formal.get("summary"), dict) else {}

            ac = safe_float(summary.get("ac")) or 0.0
            cumulative_return = safe_float(summary.get("cumulative_return")) or 0.0
            max_drawdown = safe_float(summary.get("max_drawdown")) or 0.0
            stability = safe_float(summary.get("stability_score")) or 0.0
            trade_count = safe_int(summary.get("trade_count"))
            profit_factor = safe_float(summary.get("profit_factor")) or 0.0

            row["selection_score"] = compute_selection_score(
                ac=ac,
                cumulative_return=cumulative_return,
                max_drawdown=max_drawdown,
                stability_score=stability,
                trade_count=trade_count,
                profit_factor=profit_factor,
            )
            row["ac"] = round(ac, 6)
            row["cumulative_return"] = round(cumulative_return, 6)
            row["max_drawdown"] = round(max_drawdown, 6)
            row["stability_score"] = round(stability, 6)
            row["win_rate"] = round(safe_float(summary.get("win_rate")) or 0.0, 6)
            row["trade_count"] = trade_count
            row["profit_factor"] = round(profit_factor, 6)
            row["final_holdout_score"] = (
                round(safe_float(formal.get("final_holdout_score")) or 0.0, 6)
                if formal.get("final_holdout_score") is not None
                else None
            )
            row["final_holdout_summary"] = deepcopy(formal.get("final_holdout_summary") or {})
            if row["final_holdout_score"] is not None:
                row["generalization_gap"] = round(float(row["selection_score"]) - float(row["final_holdout_score"]), 6)

            warnings = list(formal.get("warnings") or [])
            if row["final_holdout_score"] is not None and float(row["final_holdout_score"]) < 0.45:
                warnings.append("weak unknown-zone observation: final_holdout_score < 0.45")
            if row.get("generalization_gap") is not None and float(row["generalization_gap"]) > 0.20:
                warnings.append("possible overfitting: generalization_gap > 0.20")
            holdout_trade_count = safe_int((row.get("final_holdout_summary") or {}).get("trade_count"))
            holdout_mdd = safe_float((row.get("final_holdout_summary") or {}).get("max_drawdown"))
            if holdout_trade_count and holdout_trade_count < 5:
                warnings.append("final_holdout trade_count < 5")
            if holdout_mdd is not None and holdout_mdd > 0.15:
                warnings.append("final_holdout max_drawdown > 0.15")
            row["warnings"] = sorted(set(warnings))
            row["safety_passed"] = _passes_safety_filters(row)
        except Exception as exc:
            row["warnings"] = [f"formal backtest failed: {exc}"]
            row["formal_backtest"] = {"enabled": True, "success": False, "error": str(exc)}

        rows.append(row)

    rows.sort(
        key=lambda item: (
            float(item.get("selection_score") or -1.0),
            float(item.get("cumulative_return") or 0.0),
            -float(item.get("max_drawdown") or 0.0),
        ),
        reverse=True,
    )
    for idx, row in enumerate(rows, start=1):
        row["candidate_id"] = "BASE" if row.get("is_base") else f"C{idx:03d}"
        for message in row.get("warnings") or []:
            global_warnings.append(f"{row.get('candidate_id')}: {message}")
    return rows, sorted(set(global_warnings))


def _parse_seeds_argument(raw: Any) -> list[int] | None:
    if raw is None:
        return None
    if isinstance(raw, list):
        return [int(item) for item in raw]
    text = str(raw).strip()
    if not text:
        return None
    values: list[int] = []
    for chunk in text.split(","):
        piece = chunk.strip()
        if not piece:
            continue
        values.append(int(piece))
    return values or None


def resolve_seed_values(options: RefinementOptions) -> list[int]:
    if options.seeds:
        unique: list[int] = []
        seen: set[int] = set()
        for seed in options.seeds:
            value = int(seed)
            if value in seen:
                continue
            seen.add(value)
            unique.append(value)
        return unique or [42]

    if options.seed_start is not None and options.seed_end is not None:
        start = int(options.seed_start)
        end = int(options.seed_end)
        step = int(options.seed_step) if int(options.seed_step) != 0 else 1
        if start <= end and step < 0:
            step = abs(step)
        if start > end and step > 0:
            step = -step
        stop = end + (1 if step > 0 else -1)
        values = list(range(start, stop, step))
        return values or [42]

    return [int(options.seed)]


def _collect_preset_names(service: CoreModeService) -> set[str]:
    return {
        str(item.get("name") or "")
        for item in (service.get_presets().get("presets") or [])
        if isinstance(item, dict)
    }


def _ensure_unique_preset_name(
    service: CoreModeService,
    desired_name: str,
    *,
    seed: int | None,
    force_seed_suffix: bool,
) -> str:
    preset_names = _collect_preset_names(service)
    seed_suffix = f"_seed{seed}" if seed is not None else ""
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")

    if force_seed_suffix:
        candidate = f"{desired_name}{seed_suffix}" if seed_suffix else desired_name
        if candidate not in preset_names:
            return candidate
        return f"{candidate}_{timestamp}"

    if desired_name not in preset_names:
        return desired_name
    if seed_suffix:
        with_seed = f"{desired_name}{seed_suffix}"
        if with_seed not in preset_names:
            return with_seed
        return f"{with_seed}_{timestamp}"
    return f"{desired_name}_{timestamp}"


def _select_improved_name(options: RefinementOptions, recommendation: str) -> str:
    if recommendation == "save_conservative_variant" and options.improved_preset_name == DEFAULT_IMPROVED_PRESET_NAME:
        return DEFAULT_CONSERVATIVE_PRESET_NAME
    return options.improved_preset_name


def _build_improved_preset_description(
    *,
    preset_name: str,
    row: dict[str, Any],
    base_selection_score: float,
    improvement: float,
    generated_at: str,
) -> str:
    warnings = ", ".join(row.get("warnings") or []) or "N/A"
    return (
        f"Refined from preset: {preset_name}\n"
        f"selection_score={row.get('selection_score')}\n"
        f"base_selection_score={round(base_selection_score, 6)}\n"
        f"improvement={round(improvement, 6)}\n"
        f"AC={row.get('ac')}\n"
        f"cumulative_return={row.get('cumulative_return')}\n"
        f"max_drawdown={row.get('max_drawdown')}\n"
        f"stability_score={row.get('stability_score')}\n"
        f"win_rate={row.get('win_rate')}\n"
        f"trade_count={row.get('trade_count')}\n"
        f"profit_factor={row.get('profit_factor')}\n"
        f"warnings={warnings}\n"
        f"saved_at={generated_at}\n"
        "Saved but not automatically activated."
    )


def _build_seed_result(
    *,
    seed: int,
    base_row: dict[str, Any] | None,
    best_row: dict[str, Any] | None,
    recommendation: str,
    improvement: float,
    scored_rows: list[dict[str, Any]],
    warnings: list[str],
) -> dict[str, Any]:
    return {
        "seed": seed,
        "recommendation": recommendation,
        "base_selection_score": base_row.get("selection_score") if base_row else None,
        "best_candidate_selection_score": best_row.get("selection_score") if best_row else None,
        "improvement": improvement,
        "saved": False,
        "saved_preset_name": None,
        "best_candidate": deepcopy(best_row or {}),
        "candidate_table": deepcopy(scored_rows),
        "warnings": warnings,
    }


def _evaluate_single_seed(
    *,
    service: CoreModeService,
    options: RefinementOptions,
    base_params: dict[str, Any],
    seed: int,
) -> dict[str, Any]:
    print(f"[seed {seed}] Generating candidates...")
    candidates = generate_local_candidates(
        base_params,
        refinement_level=options.refinement_level,
        max_candidates=max(1, int(options.max_candidates)),
        seed=seed,
    )
    print(f"[seed {seed}] Running formal backtests...")
    scored_rows, row_warnings = evaluate_refinement_candidates(candidates, service=service, options=options)

    base_row = next((row for row in scored_rows if row.get("is_base")), None)
    eligible_rows = [row for row in scored_rows if row.get("selection_score") is not None and row.get("safety_passed")]
    non_base_eligible = [row for row in eligible_rows if not row.get("is_base")]
    best_row = deepcopy(non_base_eligible[0]) if non_base_eligible else (deepcopy(eligible_rows[0]) if eligible_rows else None)

    recommendation = "keep_current"
    improvement = 0.0
    if not base_row or base_row.get("selection_score") is None:
        recommendation = "manual_review"
    elif best_row:
        improvement = round(
            (safe_float(best_row.get("selection_score")) or 0.0)
            - (safe_float(base_row.get("selection_score")) or 0.0),
            6,
        )
        is_base_winner = bool(best_row.get("is_base"))
        if not is_base_winner and _is_meaningful_improvement(base_row, best_row, min_improvement=options.min_improvement):
            recommendation = "save_improved"
        elif options.allow_conservative_variant:
            conservative_candidates = [
                row
                for row in non_base_eligible
                if _is_conservative_variant(base_row, row, min_improvement=options.min_improvement)
            ]
            if conservative_candidates:
                conservative_candidates.sort(
                    key=lambda row: (
                        (safe_float(base_row.get("max_drawdown")) or 0.0) - (safe_float(row.get("max_drawdown")) or 0.0),
                        safe_float(row.get("profit_factor")) or 0.0,
                        safe_float(row.get("stability_score")) or 0.0,
                    ),
                    reverse=True,
                )
                best_row = deepcopy(conservative_candidates[0])
                improvement = round(
                    (safe_float(best_row.get("selection_score")) or 0.0)
                    - (safe_float(base_row.get("selection_score")) or 0.0),
                    6,
                )
                recommendation = "save_conservative_variant"

    best_score = best_row.get("selection_score") if best_row else None
    print(
        f"[seed {seed}] Best candidate score={best_score}, improvement={improvement}, recommendation={recommendation}"
    )
    return _build_seed_result(
        seed=seed,
        base_row=base_row,
        best_row=best_row,
        recommendation=recommendation,
        improvement=improvement,
        scored_rows=scored_rows,
        warnings=row_warnings,
    )


def _build_best_candidate_payload(base_row: dict[str, Any] | None, best_row: dict[str, Any] | None, *, seed: int | None) -> dict[str, Any]:
    if not best_row:
        return {}
    delta_return = None
    delta_max_drawdown = None
    delta_trade_count = None
    if base_row:
        delta_return = round(
            (safe_float(best_row.get("cumulative_return")) or 0.0)
            - (safe_float(base_row.get("cumulative_return")) or 0.0),
            6,
        )
        delta_max_drawdown = round(
            (safe_float(best_row.get("max_drawdown")) or 0.0)
            - (safe_float(base_row.get("max_drawdown")) or 0.0),
            6,
        )
        delta_trade_count = safe_int(best_row.get("trade_count")) - safe_int(base_row.get("trade_count"))

    return {
        "seed": seed,
        "candidate_id": best_row.get("candidate_id"),
        "selection_score": best_row.get("selection_score"),
        "summary": {
            "ac": best_row.get("ac"),
            "cumulative_return": best_row.get("cumulative_return"),
            "max_drawdown": best_row.get("max_drawdown"),
            "stability_score": best_row.get("stability_score"),
            "win_rate": best_row.get("win_rate"),
            "trade_count": best_row.get("trade_count"),
            "profit_factor": best_row.get("profit_factor"),
        },
        "params": deepcopy(best_row.get("params") or {}),
        "warnings": list(best_row.get("warnings") or []),
        "safety_passed": bool(best_row.get("safety_passed")),
        "delta_return": delta_return,
        "delta_max_drawdown": delta_max_drawdown,
        "delta_trade_count": delta_trade_count,
    }


def _build_markdown_report(summary: dict[str, Any]) -> str:
    settings = summary.get("settings") or {}
    base = summary.get("base") or {}
    global_best = summary.get("global_best_candidate") or {}

    lines: list[str] = [
        "# Core Mode Seed-Based Refinement Summary",
        "",
        "## 1. Overall settings",
        "",
        f"- generated_at: {summary.get('generated_at')}",
        f"- symbol: {summary.get('symbol')}",
        f"- preset_name: {summary.get('preset_name')}",
        f"- mode: {settings.get('mode')}",
        f"- date_range: {settings.get('start_date')} ~ {settings.get('end_date')}",
        f"- refinement_level: {settings.get('refinement_level')}",
        f"- max_candidates: {settings.get('max_candidates')}",
        f"- formal_backtest_top_k: {settings.get('formal_backtest_top_k')}",
        f"- min_improvement: {settings.get('min_improvement')}",
        f"- save_improved_preset: {settings.get('save_improved_preset')}",
        f"- save_each_improved: {settings.get('save_each_improved')}",
        f"- stop_on_first_improvement: {settings.get('stop_on_first_improvement')}",
        f"- dry_run: {settings.get('dry_run')}",
        "",
        "## 2. Seed list",
        "",
        f"- seed_mode: {summary.get('seed_mode')}",
        f"- seeds: {summary.get('seeds')}",
        "",
        "## 3. Base preset summary",
        "",
        f"- selection_score: {base.get('selection_score')}",
        f"- AC: {(base.get('summary') or {}).get('ac')}",
        f"- cumulative_return: {(base.get('summary') or {}).get('cumulative_return')}",
        f"- max_drawdown: {(base.get('summary') or {}).get('max_drawdown')}",
        f"- stability_score: {(base.get('summary') or {}).get('stability_score')}",
        f"- trade_count: {(base.get('summary') or {}).get('trade_count')}",
        f"- profit_factor: {(base.get('summary') or {}).get('profit_factor')}",
        "",
        "## 4. Per-seed summary table",
        "",
        "| seed | recommendation | base_score | best_score | improvement | saved | saved_preset_name |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]

    for item in summary.get("seed_results") or []:
        lines.append(
            f"| {item.get('seed')} | {item.get('recommendation')} | {item.get('base_selection_score')} | "
            f"{item.get('best_candidate_selection_score')} | {item.get('improvement')} | {item.get('saved')} | "
            f"{item.get('saved_preset_name') or 'N/A'} |"
        )

    lines.extend(
        [
            "",
            "## 5. Global best candidate",
            "",
            f"- seed: {global_best.get('seed')}",
            f"- candidate_id: {global_best.get('candidate_id')}",
            f"- selection_score: {global_best.get('selection_score')}",
            f"- safety_passed: {global_best.get('safety_passed')}",
            "",
            "## 6. Improvement versus current 最佳",
            "",
            f"- delta_selection_score: {(summary.get('best_candidate') or {}).get('improvement')}",
            f"- delta_return: {global_best.get('delta_return')}",
            f"- delta_max_drawdown: {global_best.get('delta_max_drawdown')}",
            f"- delta_trade_count: {global_best.get('delta_trade_count')}",
            "",
            "## 7. Saved preset name",
            "",
            f"- recommendation: {summary.get('recommendation')}",
            f"- saved_preset_name: {summary.get('saved_preset_name') or 'N/A'}",
            f"- saved_preset_names: {summary.get('saved_preset_names') or []}",
            "",
            "## 8. Warnings",
            "",
        ]
    )

    warnings = summary.get("warnings") or []
    if warnings:
        for warning in warnings:
            lines.append(f"- {warning}")
    else:
        lines.append("- N/A")

    lines.extend(
        [
            "",
            "## 9. Reminder",
            "",
            "- New preset was not automatically activated.",
            "- Final Holdout was not used for ranking.",
            "",
        ]
    )
    return "\n".join(lines)


def _write_reports(
    summary: dict[str, Any],
    *,
    output_dir: Path,
    symbol: str,
) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"{stamp}_{symbol}_refine_best_summary.json"
    md_path = output_dir / f"{stamp}_{symbol}_refine_best_summary.md"

    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8-sig")
    md_path.write_text(_build_markdown_report(summary), encoding="utf-8-sig")
    return {"json": str(json_path), "markdown": str(md_path)}


def run_refinement(
    options: RefinementOptions,
    *,
    service: CoreModeService | None = None,
) -> dict[str, Any]:
    service = service or CoreModeService(preset_store_path=options.preset_store_path)
    generated_at = datetime.now(UTC).isoformat()

    preset = load_preset_by_name(service, options.preset_name)
    base_params = deepcopy(preset.get("params") or {})
    seed_values = resolve_seed_values(options)
    seed_mode = "multi" if len(seed_values) > 1 else "single"

    seed_results: list[dict[str, Any]] = []
    all_warnings: list[str] = []
    qualified_results: list[dict[str, Any]] = []

    for seed in seed_values:
        seed_result = _evaluate_single_seed(service=service, options=options, base_params=base_params, seed=seed)
        seed_results.append(seed_result)
        for warning in seed_result.get("warnings") or []:
            all_warnings.append(f"[seed {seed}] {warning}")
        if seed_result.get("recommendation") in {"save_improved", "save_conservative_variant"}:
            qualified_results.append(seed_result)
            if options.stop_on_first_improvement:
                break

    base_row = None
    if seed_results:
        candidate_table = seed_results[0].get("candidate_table") or []
        base_row = next((row for row in candidate_table if row.get("is_base")), None)

    recommendation = "keep_current"
    saved_preset_name: str | None = None
    saved_preset_names: list[str] = []

    if any(result.get("recommendation") == "manual_review" for result in seed_results):
        recommendation = "manual_review"

    global_best_result: dict[str, Any] | None = None
    if qualified_results:
        global_best_result = max(
            qualified_results,
            key=lambda item: (
                safe_float((item.get("best_candidate") or {}).get("selection_score")) or -1.0,
                safe_float(item.get("improvement")) or -1.0,
            ),
        )
        if any(item.get("recommendation") == "save_improved" for item in qualified_results):
            recommendation = "save_improved"
        else:
            recommendation = "save_conservative_variant"

    if global_best_result:
        print(
            f"Global best: seed={global_best_result.get('seed')}, "
            f"score={(global_best_result.get('best_candidate') or {}).get('selection_score')}, "
            f"improvement={global_best_result.get('improvement')}"
        )

    can_save = options.save_improved_preset and not options.dry_run
    if can_save and qualified_results:
        if options.save_each_improved:
            for seed_result in qualified_results:
                row = seed_result.get("best_candidate") or {}
                row_recommendation = str(seed_result.get("recommendation") or "save_improved")
                desired_name = _select_improved_name(options, row_recommendation)
                unique_name = _ensure_unique_preset_name(
                    service,
                    desired_name,
                    seed=safe_int(seed_result.get("seed")),
                    force_seed_suffix=True,
                )
                service.save_preset(
                    name=unique_name,
                    description=_build_improved_preset_description(
                        preset_name=options.preset_name,
                        row=row,
                        base_selection_score=safe_float(seed_result.get("base_selection_score")) or 0.0,
                        improvement=safe_float(seed_result.get("improvement")) or 0.0,
                        generated_at=generated_at,
                    ),
                    params=deepcopy(row.get("params") or {}),
                )
                seed_result["saved"] = True
                seed_result["saved_preset_name"] = unique_name
                saved_preset_names.append(unique_name)
            saved_preset_name = saved_preset_names[0] if len(saved_preset_names) == 1 else None
            print(f"Saved improved presets: {saved_preset_names}")
        elif global_best_result:
            row = global_best_result.get("best_candidate") or {}
            seed = safe_int(global_best_result.get("seed"))
            desired_name = _select_improved_name(options, str(global_best_result.get("recommendation")))
            unique_name = _ensure_unique_preset_name(
                service,
                desired_name,
                seed=seed,
                force_seed_suffix=False,
            )
            service.save_preset(
                name=unique_name,
                description=_build_improved_preset_description(
                    preset_name=options.preset_name,
                    row=row,
                    base_selection_score=safe_float(global_best_result.get("base_selection_score")) or 0.0,
                    improvement=safe_float(global_best_result.get("improvement")) or 0.0,
                    generated_at=generated_at,
                ),
                params=deepcopy(row.get("params") or {}),
            )
            global_best_result["saved"] = True
            global_best_result["saved_preset_name"] = unique_name
            saved_preset_name = unique_name
            saved_preset_names = [unique_name]
            print(f"Saved improved preset: {unique_name}")

    global_best_candidate = _build_best_candidate_payload(
        base_row,
        (global_best_result or {}).get("best_candidate"),
        seed=safe_int((global_best_result or {}).get("seed")) if global_best_result else None,
    )
    improvement = safe_float((global_best_result or {}).get("improvement")) or 0.0
    candidate_table = (global_best_result or {}).get("candidate_table") or (seed_results[0].get("candidate_table") if seed_results else [])

    summary = {
        "generated_at": generated_at,
        "symbol": options.symbol,
        "preset_name": options.preset_name,
        "settings": {
            "mode": options.mode,
            "start_date": options.start_date,
            "end_date": options.end_date,
            "refinement_level": options.refinement_level,
            "max_candidates": options.max_candidates,
            "formal_backtest_top_k": options.formal_backtest_top_k,
            "save_improved_preset": options.save_improved_preset,
            "improved_preset_name": options.improved_preset_name,
            "dry_run": options.dry_run,
            "save_each_improved": options.save_each_improved,
            "stop_on_first_improvement": options.stop_on_first_improvement,
            "min_improvement": options.min_improvement,
            "allow_conservative_variant": options.allow_conservative_variant,
        },
        "seed_mode": seed_mode,
        "seeds": seed_values,
        "seed_results": seed_results,
        "base": {
            "selection_score": base_row.get("selection_score") if base_row else None,
            "summary": {
                "ac": base_row.get("ac") if base_row else None,
                "cumulative_return": base_row.get("cumulative_return") if base_row else None,
                "max_drawdown": base_row.get("max_drawdown") if base_row else None,
                "stability_score": base_row.get("stability_score") if base_row else None,
                "win_rate": base_row.get("win_rate") if base_row else None,
                "trade_count": base_row.get("trade_count") if base_row else None,
                "profit_factor": base_row.get("profit_factor") if base_row else None,
            },
            "params": deepcopy(base_row.get("params") if base_row else base_params),
        },
        "global_best_candidate": global_best_candidate,
        "best_candidate": {
            **global_best_candidate,
            "improvement": improvement,
        },
        "recommendation": recommendation,
        "saved_preset_name": saved_preset_name,
        "saved_preset_names": saved_preset_names,
        "candidate_table": candidate_table,
        "warnings": sorted(set(all_warnings)),
    }
    summary["report_paths"] = _write_reports(summary, output_dir=options.output_dir, symbol=options.symbol)
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refine a named Core Mode preset via local parameter search.")
    parser.add_argument("--preset-name", default=PRESET_NAME_BEST)
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--mode", default="single_stock_search")
    parser.add_argument("--refinement-level", default="medium", choices=["small", "medium", "large"])
    parser.add_argument("--max-candidates", type=int, default=120)
    parser.add_argument("--formal-backtest-top-k", type=int, default=30)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--seeds", default=None)
    parser.add_argument("--seed-start", type=int, default=None)
    parser.add_argument("--seed-end", type=int, default=None)
    parser.add_argument("--seed-step", type=int, default=1)
    parser.add_argument("--save-improved-preset", type=parse_bool, default=True)
    parser.add_argument("--save-each-improved", type=parse_bool, default=False)
    parser.add_argument("--stop-on-first-improvement", type=parse_bool, default=False)
    parser.add_argument("--min-improvement", type=float, default=0.015)
    parser.add_argument("--allow-conservative-variant", type=parse_bool, default=False)
    parser.add_argument("--improved-preset-name", default=DEFAULT_IMPROVED_PRESET_NAME)
    parser.add_argument("--dry-run", type=parse_bool, default=False)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--preset-store-path", default="backend/data/core_mode_presets.json")
    return parser.parse_args()


def build_options_from_args(args: argparse.Namespace) -> RefinementOptions:
    mode = str(args.mode or "single_stock_search").strip()
    if mode not in {"single_stock_search", "multi_stock_search"}:
        raise ValueError("mode must be single_stock_search or multi_stock_search")
    output_dir = _normalize_runtime_relative_path(str(args.output_dir))
    preset_store_path = _normalize_runtime_relative_path(str(args.preset_store_path))
    return RefinementOptions(
        preset_name=str(args.preset_name or PRESET_NAME_BEST),
        symbol=str(args.symbol or "2330").strip().upper(),
        start_date=str(args.start_date),
        end_date=str(args.end_date),
        mode=mode,
        refinement_level=str(args.refinement_level or "medium"),
        max_candidates=max(1, int(args.max_candidates)),
        formal_backtest_top_k=max(1, int(args.formal_backtest_top_k)),
        seed=int(args.seed),
        seeds=_parse_seeds_argument(getattr(args, "seeds", None)),
        seed_start=getattr(args, "seed_start", None),
        seed_end=getattr(args, "seed_end", None),
        seed_step=max(1, abs(int(getattr(args, "seed_step", 1) or 1))),
        save_improved_preset=bool(args.save_improved_preset),
        save_each_improved=bool(getattr(args, "save_each_improved", False)),
        stop_on_first_improvement=bool(getattr(args, "stop_on_first_improvement", False)),
        min_improvement=max(0.0, float(getattr(args, "min_improvement", 0.015))),
        allow_conservative_variant=bool(getattr(args, "allow_conservative_variant", False)),
        improved_preset_name=str(args.improved_preset_name or DEFAULT_IMPROVED_PRESET_NAME),
        dry_run=bool(args.dry_run),
        output_dir=output_dir,
        preset_store_path=preset_store_path,
    )


def main() -> None:
    args = parse_args()
    options = build_options_from_args(args)
    result = run_refinement(options)
    print(json.dumps(result.get("report_paths") or {}, ensure_ascii=False))


if __name__ == "__main__":
    main()
