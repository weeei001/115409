from __future__ import annotations

import argparse
import json
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from services.core_mode import CoreModeService

GOAL_TO_SCORE_MODE: dict[str, str] = {
    "balanced": "balanced_score",
    "return": "return_score",
    "stable": "stable_score",
    "low_drawdown": "low_drawdown_score",
}
DEFAULT_GOALS = ("balanced", "return", "stable", "low_drawdown")


@dataclass
class BestParamsOptions:
    symbol: str
    symbols: tuple[str, ...]
    mode: str
    start_date: str
    end_date: str
    goals: tuple[str, ...]
    search_quality: str = "deep"
    adaptive: bool = True
    top_n: int = 10
    formal_backtest_top_k: int = 3
    save_best_preset: bool = True
    save_all_top1_presets: bool = False
    dry_run: bool = False
    output_dir: Path = Path("backend/outputs/core_mode_best_params")
    preset_store_path: Path = Path("backend/data/core_mode_presets.json")


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


def parse_csv_values(raw: str) -> list[str]:
    values: list[str] = []
    for part in (raw or "").split(","):
        token = part.strip()
        if token:
            values.append(token)
    return values


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


def _primary_symbol(options: BestParamsOptions) -> str:
    if options.symbols:
        return options.symbols[0]
    return options.symbol


def _symbol_label(options: BestParamsOptions) -> str:
    if options.mode == "single_stock_search":
        return _primary_symbol(options)
    compact = "_".join(options.symbols[:3])
    return compact or _primary_symbol(options)


def candidate_fingerprint(params: dict[str, Any]) -> str:
    return json.dumps(params, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def compute_selection_score(
    *,
    validation_score: float,
    cumulative_return: float,
    max_drawdown: float,
    stability_score: float,
    trade_count: int,
    profit_factor: float,
) -> float:
    validation_score_norm = clip(validation_score, 0.0, 1.0)
    profit_factor_score = clip(profit_factor / 3.0, 0.0, 1.0)
    drawdown_score = clip(1.0 - (abs(max_drawdown) / 0.35), 0.0, 1.0)
    stability_score_norm = clip(stability_score, 0.0, 1.0)
    return_score = clip((cumulative_return - (-0.20)) / 0.80, 0.0, 1.0)
    trade_count_score = clip(float(trade_count) / 30.0, 0.0, 1.0)
    return round(
        (0.25 * validation_score_norm)
        + (0.20 * profit_factor_score)
        + (0.20 * drawdown_score)
        + (0.15 * stability_score_norm)
        + (0.10 * return_score)
        + (0.10 * trade_count_score),
        6,
    )


def _merge_metric_summary(formal_summary: dict[str, Any], auto_summary: dict[str, Any]) -> tuple[dict[str, Any], str]:
    if formal_summary:
        source = "formal_backtest"
    else:
        source = "auto_search"

    def _pick(key: str) -> Any:
        if key in formal_summary and formal_summary.get(key) is not None:
            return formal_summary.get(key)
        if key == "stability_score" and formal_summary.get("stability") is not None:
            return formal_summary.get("stability")
        return auto_summary.get(key)

    merged = {
        "ac": _pick("ac"),
        "cumulative_return": _pick("cumulative_return"),
        "max_drawdown": _pick("max_drawdown"),
        "stability_score": _pick("stability_score"),
        "win_rate": _pick("win_rate"),
        "trade_count": _pick("trade_count"),
        "profit_factor": _pick("profit_factor"),
    }
    return merged, source


def _build_best_preset_name(options: BestParamsOptions, *, goal: str) -> str:
    return (
        f"{_symbol_label(options)}_best_{goal}_{options.search_quality}_"
        f"{options.start_date.replace('-', '')}_{options.end_date.replace('-', '')}"
    )


def _build_goal_top1_preset_name(options: BestParamsOptions, *, goal: str) -> str:
    return (
        f"{_symbol_label(options)}_goal_{goal}_top1_{options.search_quality}_"
        f"{options.start_date.replace('-', '')}_{options.end_date.replace('-', '')}"
    )


def _ensure_unique_preset_name(service: CoreModeService, desired_name: str) -> str:
    preset_names = {
        str(item.get("name") or "")
        for item in (service.get_presets().get("presets") or [])
        if isinstance(item, dict)
    }
    if desired_name not in preset_names:
        return desired_name
    suffix = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    return f"{desired_name}_{suffix}"


def _run_formal_backtest(
    *,
    service: CoreModeService,
    options: BestParamsOptions,
    params: dict[str, Any],
) -> dict[str, Any]:
    request = {
        "symbol": _primary_symbol(options),
        "date_range": {"start_date": options.start_date, "end_date": options.end_date},
        "params": deepcopy(params),
        "run_optimization": False,
        "auto_search_settings": {"enabled": False},
    }
    result = service.run_core_mode(request)
    summary = result.get("summary") or {}
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
        "warnings": list(result.get("warnings") or []),
        "trade_count": len(result.get("trades") or []),
    }


def _run_goal_search(
    *,
    service: CoreModeService,
    options: BestParamsOptions,
    goal: str,
) -> tuple[list[dict[str, Any]], list[str]]:
    score_mode = GOAL_TO_SCORE_MODE[goal]
    auto_request = {
        "symbol": _primary_symbol(options),
        "date_range": {"start_date": options.start_date, "end_date": options.end_date},
        "run_optimization": False,
        "auto_search_settings": {
            "enabled": True,
            "mode": options.mode,
            "symbols": list(options.symbols),
            "top_n": max(1, int(options.top_n)),
            "score_mode": score_mode,
            "max_runtime_level": options.search_quality,
            "adaptive_search_settings": {
                "enabled": bool(options.adaptive),
            },
        },
    }
    result = service.run_core_mode(auto_request)
    auto_search_result = result.get("auto_search_result") or {}
    warnings = list(auto_search_result.get("warnings") or [])
    ranked = list(auto_search_result.get("results") or [])
    normalized: list[dict[str, Any]] = []
    for fallback_rank, row in enumerate(ranked, start=1):
        if len(normalized) >= max(1, int(options.top_n)):
            break
        if not isinstance(row, dict):
            continue
        params = deepcopy(row.get("params") or {})
        if not params:
            continue
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        validation_score = (
            row.get("validation_score")
            if row.get("validation_score") is not None
            else row.get("verified_score")
        )
        if validation_score is None:
            validation_score = row.get("cross_stock_score")
        normalized.append(
            {
                "candidate_id": f"{goal}_{fallback_rank}",
                "goal": goal,
                "rank": row.get("rank") or fallback_rank,
                "score_mode": score_mode,
                "validation_score": validation_score,
                "final_holdout_score": row.get("final_holdout_score"),
                "summary": {
                    "ac": summary.get("ac"),
                    "cumulative_return": summary.get("cumulative_return"),
                    "max_drawdown": summary.get("max_drawdown"),
                    "stability_score": summary.get("stability_score"),
                    "win_rate": summary.get("win_rate"),
                    "trade_count": summary.get("trade_count"),
                    "profit_factor": summary.get("profit_factor"),
                },
                "final_holdout_summary": row.get("final_holdout_summary") or {},
                "params": params,
                "source_tags": list(row.get("source_tags") or []),
                "warnings": list(row.get("warnings") or []),
                "formal_backtest": {"enabled": False, "success": False},
            }
        )
    return normalized, warnings


def dedupe_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    deduped: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for item in candidates:
        params = item.get("params") if isinstance(item.get("params"), dict) else {}
        fp = candidate_fingerprint(params)
        origin = {
            "goal": item.get("goal"),
            "rank": item.get("rank"),
            "score_mode": item.get("score_mode"),
        }
        if fp not in deduped:
            snapshot = deepcopy(item)
            snapshot["fingerprint"] = fp
            snapshot["origins"] = [origin]
            deduped[fp] = snapshot
            order.append(fp)
            continue

        existing = deduped[fp]
        existing_origins = existing.get("origins") or []
        existing_origins.append(origin)
        existing["origins"] = existing_origins
        existing["source_tags"] = sorted(set((existing.get("source_tags") or []) + (item.get("source_tags") or [])))
        existing["warnings"] = sorted(set((existing.get("warnings") or []) + (item.get("warnings") or [])))
        if not (existing.get("formal_backtest") or {}).get("success") and (item.get("formal_backtest") or {}).get("success"):
            existing["formal_backtest"] = deepcopy(item.get("formal_backtest"))

        existing_validation = safe_float(existing.get("validation_score")) or 0.0
        incoming_validation = safe_float(item.get("validation_score")) or 0.0
        if incoming_validation > existing_validation:
            # Keep representative with higher validation score.
            for key in (
                "candidate_id",
                "goal",
                "rank",
                "score_mode",
                "validation_score",
                "final_holdout_score",
                "summary",
                "final_holdout_summary",
                "params",
            ):
                existing[key] = deepcopy(item.get(key))

    return [deduped[key] for key in order]


def evaluate_candidates(candidates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for index, candidate in enumerate(candidates, start=1):
        formal = candidate.get("formal_backtest") if isinstance(candidate.get("formal_backtest"), dict) else {}
        formal_summary = (
            formal.get("summary")
            if isinstance(formal, dict) and formal.get("success") and isinstance(formal.get("summary"), dict)
            else {}
        )
        auto_summary = candidate.get("summary") if isinstance(candidate.get("summary"), dict) else {}
        merged_summary, metrics_source = _merge_metric_summary(formal_summary, auto_summary)

        validation_score = safe_float(candidate.get("validation_score")) or 0.0
        cumulative_return = safe_float(merged_summary.get("cumulative_return")) or 0.0
        max_drawdown = safe_float(merged_summary.get("max_drawdown")) or 0.0
        stability_score = safe_float(merged_summary.get("stability_score")) or 0.0
        trade_count = safe_int(merged_summary.get("trade_count"))
        profit_factor = safe_float(merged_summary.get("profit_factor")) or 0.0
        selection_score = compute_selection_score(
            validation_score=validation_score,
            cumulative_return=cumulative_return,
            max_drawdown=max_drawdown,
            stability_score=stability_score,
            trade_count=trade_count,
            profit_factor=profit_factor,
        )

        final_holdout_score_raw = safe_float(candidate.get("final_holdout_score"))
        generalization_gap = (
            round(validation_score - final_holdout_score_raw, 6) if final_holdout_score_raw is not None else None
        )
        warnings = list(candidate.get("warnings") or [])
        if generalization_gap is not None and generalization_gap > 0.20:
            warnings.append("possible overfitting: generalization_gap > 0.20")
        if final_holdout_score_raw is not None and final_holdout_score_raw < 0.45:
            warnings.append("weak unknown-zone observation: final_holdout_score < 0.45")
        if trade_count < 10:
            warnings.append("sample size may be too small: trade_count < 10")
        if max_drawdown > 0.20:
            warnings.append("drawdown risk: max_drawdown > 0.20")
        if profit_factor < 1.2:
            warnings.append("weak payoff quality: profit_factor < 1.2")

        row = {
            "candidate_id": f"C{index:03d}",
            "goal": candidate.get("goal"),
            "rank": candidate.get("rank"),
            "score_mode": candidate.get("score_mode"),
            "selection_score": selection_score,
            "validation_score": round(validation_score, 6),
            "final_holdout_score": round(final_holdout_score_raw, 6) if final_holdout_score_raw is not None else None,
            "generalization_gap": generalization_gap,
            "summary_metrics_source": metrics_source,
            "cumulative_return": round(cumulative_return, 6),
            "max_drawdown": round(max_drawdown, 6),
            "stability_score": round(stability_score, 6),
            "trade_count": trade_count,
            "profit_factor": round(profit_factor, 6),
            "ac": round(safe_float(merged_summary.get("ac")) or 0.0, 6),
            "win_rate": round(safe_float(merged_summary.get("win_rate")) or 0.0, 6),
            "params": deepcopy(candidate.get("params") or {}),
            "origins": deepcopy(candidate.get("origins") or []),
            "formal_backtest": deepcopy(candidate.get("formal_backtest") or {"enabled": False, "success": False}),
            "final_holdout_summary": deepcopy(candidate.get("final_holdout_summary") or {}),
            "warnings": sorted(set(warnings)),
        }
        rows.append(row)

    rows.sort(
        key=lambda item: (
            float(item.get("selection_score") or 0.0),
            float(item.get("validation_score") or 0.0),
            -(safe_int(item.get("rank"))),
        ),
        reverse=True,
    )
    for idx, row in enumerate(rows, start=1):
        row["candidate_id"] = f"C{idx:03d}"
    return rows


def _build_preset_description(
    *,
    row: dict[str, Any],
    generated_at: str,
) -> str:
    warnings = ", ".join(row.get("warnings") or []) or "N/A"
    return (
        "Saved by find_core_mode_best_params.py; selected from full best parameter discovery.\n"
        f"source_goal={row.get('goal')}\n"
        f"source_rank={row.get('rank')}\n"
        f"selection_score={row.get('selection_score')}\n"
        f"validation_score={row.get('validation_score')}\n"
        f"final_holdout_score={row.get('final_holdout_score')}\n"
        f"formal_backtest_return={row.get('cumulative_return')}\n"
        f"max_drawdown={row.get('max_drawdown')}\n"
        f"stability_score={row.get('stability_score')}\n"
        f"trade_count={row.get('trade_count')}\n"
        f"profit_factor={row.get('profit_factor')}\n"
        f"warnings={warnings}\n"
        f"saved_at={generated_at}\n"
        "Saved but not automatically activated."
    )


def _write_reports(summary: dict[str, Any], *, output_dir: Path, symbol_label: str) -> dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"{stamp}_{symbol_label}_best_params_summary.json"
    md_path = output_dir / f"{stamp}_{symbol_label}_best_params_summary.md"

    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8-sig")

    lines: list[str] = [
        "# Core Mode Best Parameter Set Discovery Summary",
        "",
        "## 1. Overall settings",
        "",
        f"- generated_at: {summary.get('generated_at')}",
        f"- symbol: {summary.get('symbol')}",
        f"- mode: {summary.get('mode')}",
        f"- date_range: {summary.get('start_date')} ~ {summary.get('end_date')}",
        f"- search_quality: {summary.get('search_quality')}",
        f"- adaptive: {summary.get('adaptive')}",
        f"- top_n: {summary.get('top_n')}",
        f"- formal_backtest_top_k: {summary.get('formal_backtest_top_k')}",
        "",
        "## 2. Goal summary",
        "",
    ]
    for goal_summary in summary.get("goal_summaries") or []:
        lines.append(
            f"- {goal_summary.get('goal')}: candidates={goal_summary.get('candidate_count')}, "
            f"top1_validation={goal_summary.get('top1_validation_score')}, warnings={len(goal_summary.get('warnings') or [])}"
        )

    lines.extend(
        [
            "",
            "## 3. Candidate comparison table",
            "",
            "| id | goal | rank | selection | validation | holdout | gap | return | mdd | stability | trades | pf |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
    )
    for row in summary.get("candidate_table") or []:
        lines.append(
            f"| {row.get('candidate_id')} | {row.get('goal')} | {row.get('rank')} | {row.get('selection_score')} | "
            f"{row.get('validation_score')} | {row.get('final_holdout_score')} | {row.get('generalization_gap')} | "
            f"{row.get('cumulative_return')} | {row.get('max_drawdown')} | {row.get('stability_score')} | "
            f"{row.get('trade_count')} | {row.get('profit_factor')} |"
        )

    best = summary.get("best") or {}
    lines.extend(
        [
            "",
            "## 4. Best recommended parameter set",
            "",
            f"- goal: {best.get('goal')}",
            f"- rank: {best.get('rank')}",
            f"- selection_score: {best.get('selection_score')}",
            f"- validation_score: {best.get('validation_score')}",
            f"- final_holdout_score: {best.get('final_holdout_score')}",
            f"- generalization_gap: {best.get('generalization_gap')}",
            "",
            "## 5. Formal backtest confirmation",
            "",
            f"- source: {best.get('summary_metrics_source')}",
            f"- cumulative_return: {best.get('cumulative_return')}",
            f"- max_drawdown: {best.get('max_drawdown')}",
            f"- stability_score: {best.get('stability_score')}",
            f"- trade_count: {best.get('trade_count')}",
            f"- profit_factor: {best.get('profit_factor')}",
            "",
            "## 6. Final Holdout observation",
            "",
            f"- final_holdout_score: {best.get('final_holdout_score')}",
            f"- generalization_gap: {best.get('generalization_gap')}",
            "",
            "## 7. Warnings",
            "",
        ]
    )
    warnings = summary.get("warnings") or []
    if warnings:
        for message in warnings:
            lines.append(f"- {message}")
    else:
        lines.append("- N/A")

    lines.extend(
        [
            "",
            "## 8. Saved preset name",
            "",
            f"- best_preset_name: {(summary.get('best') or {}).get('preset_name') or 'N/A'}",
            "",
            "## 9. Reminder",
            "",
            "- Preset was saved but not automatically activated.",
            "- Final holdout was used for observation/warnings only, not ranking.",
            "",
        ]
    )
    md_path.write_text("\n".join(lines), encoding="utf-8-sig")
    return {"json": str(json_path), "markdown": str(md_path)}


def run_best_params(options: BestParamsOptions, *, service: CoreModeService | None = None) -> dict[str, Any]:
    service = service or CoreModeService(preset_store_path=options.preset_store_path)
    generated_at = datetime.now(UTC).isoformat()

    all_candidates: list[dict[str, Any]] = []
    goal_summaries: list[dict[str, Any]] = []
    saved_presets: list[dict[str, Any]] = []
    global_warnings: list[str] = []

    for idx, goal in enumerate(options.goals, start=1):
        print(f"[{idx}/{len(options.goals)}] Running goal={goal} ...")
        goal_candidates, goal_warnings = _run_goal_search(service=service, options=options, goal=goal)
        goal_warnings = list(goal_warnings)
        if not goal_candidates:
            goal_warnings.append("auto search returned no candidates")
            goal_summaries.append(
                {
                    "goal": goal,
                    "candidate_count": 0,
                    "top1_validation_score": None,
                    "warnings": goal_warnings,
                }
            )
            global_warnings.extend([f"{goal}: {msg}" for msg in goal_warnings])
            continue

        formal_k = min(max(0, int(options.formal_backtest_top_k)), len(goal_candidates))
        for candidate_index, candidate in enumerate(goal_candidates):
            if candidate_index >= formal_k:
                candidate["formal_backtest"] = {
                    "enabled": False,
                    "success": False,
                    "warnings": [f"skipped because rank>{formal_k}"],
                }
                continue
            try:
                candidate["formal_backtest"] = _run_formal_backtest(
                    service=service,
                    options=options,
                    params=deepcopy(candidate.get("params") or {}),
                )
            except Exception as exc:
                candidate["formal_backtest"] = {"enabled": True, "success": False, "error": str(exc)}
                candidate.setdefault("warnings", []).append(f"formal backtest failed: {exc}")

        top1 = goal_candidates[0]
        if options.save_all_top1_presets and not options.dry_run:
            desired_name = _build_goal_top1_preset_name(options, goal=goal)
            preset_name = _ensure_unique_preset_name(service, desired_name)
            service.save_preset(
                name=preset_name,
                description=_build_preset_description(row=top1, generated_at=generated_at),
                params=deepcopy(top1.get("params") or {}),
            )
            saved_presets.append({"kind": "goal_top1", "goal": goal, "name": preset_name})

        goal_summaries.append(
            {
                "goal": goal,
                "candidate_count": len(goal_candidates),
                "top1_validation_score": top1.get("validation_score"),
                "warnings": goal_warnings,
            }
        )
        all_candidates.extend(goal_candidates)
        global_warnings.extend([f"{goal}: {msg}" for msg in goal_warnings])

    deduped = dedupe_candidates(all_candidates)
    scored_rows = evaluate_candidates(deduped)

    if not scored_rows:
        summary = {
            "generated_at": generated_at,
            "symbol": _symbol_label(options),
            "mode": options.mode,
            "start_date": options.start_date,
            "end_date": options.end_date,
            "search_quality": options.search_quality,
            "adaptive": options.adaptive,
            "top_n": options.top_n,
            "formal_backtest_top_k": options.formal_backtest_top_k,
            "candidate_count": 0,
            "formal_backtest_count": 0,
            "best": {},
            "candidate_table": [],
            "goal_summaries": goal_summaries,
            "warnings": sorted(set(global_warnings + ["No candidates available for recommendation."])),
            "saved_presets": saved_presets,
            "heatmap_matrix": [],
        }
        summary["report_paths"] = _write_reports(summary, output_dir=options.output_dir, symbol_label=_symbol_label(options))
        return summary

    best = deepcopy(scored_rows[0])
    best_saved = False
    best_preset_name: str | None = None
    best_manual_review = len(best.get("warnings") or []) > 0
    if options.save_best_preset and not options.dry_run:
        desired_name = _build_best_preset_name(options, goal=str(best.get("goal") or "balanced"))
        best_preset_name = _ensure_unique_preset_name(service, desired_name)
        service.save_preset(
            name=best_preset_name,
            description=_build_preset_description(row=best, generated_at=generated_at),
            params=deepcopy(best.get("params") or {}),
        )
        best_saved = True
        saved_presets.append({"kind": "best", "goal": best.get("goal"), "name": best_preset_name})

    best["preset_name"] = best_preset_name
    best["saved"] = best_saved
    best["manual_review_required"] = best_manual_review
    if best_manual_review:
        best.setdefault("warnings", []).append("Recommendation requires manual review.")

    summary = {
        "generated_at": generated_at,
        "symbol": _symbol_label(options),
        "mode": options.mode,
        "start_date": options.start_date,
        "end_date": options.end_date,
        "search_quality": options.search_quality,
        "adaptive": options.adaptive,
        "top_n": options.top_n,
        "formal_backtest_top_k": options.formal_backtest_top_k,
        "candidate_count": len(scored_rows),
        "formal_backtest_count": sum(1 for item in scored_rows if (item.get("formal_backtest") or {}).get("success")),
        "best": best,
        "candidate_table": scored_rows,
        "goal_summaries": goal_summaries,
        "warnings": sorted(set(global_warnings + list(best.get("warnings") or []))),
        "saved_presets": saved_presets,
        "heatmap_matrix": scored_rows,
    }
    summary["report_paths"] = _write_reports(summary, output_dir=options.output_dir, symbol_label=_symbol_label(options))
    return summary


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Find one best Core Mode parameter set from multi-goal deep searches")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--symbols", default="")
    parser.add_argument("--mode", default="single_stock_search")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--goals", default="balanced,return,stable,low_drawdown")
    parser.add_argument("--search-quality", default="deep")
    parser.add_argument("--adaptive", type=parse_bool, default=True)
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--formal-backtest-top-k", type=int, default=3)
    parser.add_argument("--save-best-preset", type=parse_bool, default=True)
    parser.add_argument("--save-all-top1-presets", type=parse_bool, default=False)
    parser.add_argument("--dry-run", type=parse_bool, default=False)
    parser.add_argument("--output-dir", default="backend/outputs/core_mode_best_params")
    parser.add_argument("--preset-store-path", default="backend/data/core_mode_presets.json")
    return parser.parse_args()


def build_options_from_args(args: argparse.Namespace) -> BestParamsOptions:
    mode = str(args.mode or "single_stock_search").strip()
    if mode not in {"single_stock_search", "multi_stock_search"}:
        raise ValueError("mode must be single_stock_search or multi_stock_search")

    symbol = str(args.symbol or "").strip().upper()
    symbols_cli = [item.strip().upper() for item in parse_csv_values(str(args.symbols or ""))]
    symbols = tuple(dict.fromkeys([item for item in symbols_cli if item]))
    if not symbols:
        symbols = (symbol,) if symbol else ()
    if not symbols:
        raise ValueError("At least one symbol is required")
    if mode == "multi_stock_search" and len(symbols) < 2:
        raise ValueError("multi_stock_search requires at least 2 symbols")

    primary_symbol = symbol or symbols[0]
    goals = tuple(goal for goal in parse_csv_values(str(args.goals or "")) if goal in GOAL_TO_SCORE_MODE)
    if not goals:
        goals = DEFAULT_GOALS

    quality = str(args.search_quality or "deep").strip().lower()
    if quality not in {"balanced", "deep"}:
        raise ValueError("search_quality must be balanced or deep")

    output_dir = _normalize_runtime_relative_path(str(args.output_dir))
    preset_store_path = _normalize_runtime_relative_path(str(args.preset_store_path))

    return BestParamsOptions(
        symbol=primary_symbol,
        symbols=symbols,
        mode=mode,
        start_date=str(args.start_date),
        end_date=str(args.end_date),
        goals=goals,
        search_quality=quality,
        adaptive=bool(args.adaptive),
        top_n=max(1, int(args.top_n)),
        formal_backtest_top_k=max(0, int(args.formal_backtest_top_k)),
        save_best_preset=bool(args.save_best_preset),
        save_all_top1_presets=bool(args.save_all_top1_presets),
        dry_run=bool(args.dry_run),
        output_dir=output_dir,
        preset_store_path=preset_store_path,
    )


def main() -> None:
    args = parse_args()
    options = build_options_from_args(args)
    result = run_best_params(options)
    print(json.dumps(result.get("report_paths") or {}, ensure_ascii=False))


if __name__ == "__main__":
    main()
