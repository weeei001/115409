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
class BatchRunOptions:
    symbol: str
    start_date: str
    end_date: str
    output_dir: Path
    preset_store_path: Path
    goals: tuple[str, ...]
    run_formal_backtest: bool = True
    save_presets: bool = True
    dry_run: bool = False
    top_n: int = 10
    formal_backtest_top_k: int = 1


def _parse_bool(value: str) -> bool:
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


def _safe_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _build_preset_name(symbol: str, goal: str, start_date: str, end_date: str) -> str:
    return f"{symbol}_deep_{goal}_T1_{start_date.replace('-', '')}_{end_date.replace('-', '')}"


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


def _format_metric(value: Any) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, float):
        return f"{value:.6f}"
    return str(value)


def _normalize_ranked_candidate(raw: dict[str, Any], fallback_rank: int) -> dict[str, Any]:
    summary = raw.get("summary") or {}
    return {
        "rank": raw.get("rank") or fallback_rank,
        "validation_score": raw.get("validation_score") or raw.get("verified_score"),
        "final_holdout_score": raw.get("final_holdout_score"),
        "summary": {
            "ac": summary.get("ac"),
            "cumulative_return": summary.get("cumulative_return"),
            "max_drawdown": summary.get("max_drawdown"),
            "stability_score": summary.get("stability_score"),
            "win_rate": summary.get("win_rate"),
            "trade_count": summary.get("trade_count"),
            "profit_factor": summary.get("profit_factor"),
        },
        "final_holdout_summary": raw.get("final_holdout_summary") or {},
        "params": deepcopy(raw.get("params") or {}),
        "source_tags": list(raw.get("source_tags") or []),
        "warnings": list(raw.get("warnings") or []),
    }


def _build_markdown(goal_results: list[dict[str, Any]], *, generated_at: str, options: BatchRunOptions) -> str:
    lines: list[str] = [
        "# Core Mode Deep Batch Auto Search + Formal Backtest",
        "",
        f"- generated_at: {generated_at}",
        f"- symbol: {options.symbol}",
        f"- date_range: {options.start_date} ~ {options.end_date}",
        f"- top_n: {options.top_n}",
        f"- formal_backtest_top_k: {options.formal_backtest_top_k}",
        f"- run_formal_backtest: {str(options.run_formal_backtest).lower()}",
        f"- save_presets: {str(options.save_presets).lower()}",
        f"- dry_run: {str(options.dry_run).lower()}",
        "",
    ]

    for item in goal_results:
        goal = item.get("goal")
        auto_search = item.get("auto_search") or {}
        summary = auto_search.get("summary") or {}
        formal = item.get("formal_backtest") or {"enabled": False}
        formal_summary = formal.get("summary") or {}

        lines.extend(
            [
                f"## Goal: {goal}",
                "",
                f"- top_candidates_count: {len(item.get('top_candidates') or [])}",
                "",
                "### Auto Search Top 1",
                f"- score mode: {item.get('score_mode')}",
                f"- validation_score: {_format_metric(auto_search.get('validation_score'))}",
                f"- final_holdout_score: {_format_metric(auto_search.get('final_holdout_score'))}",
                f"- cumulative_return: {_format_metric(summary.get('cumulative_return'))}",
                f"- max_drawdown: {_format_metric(summary.get('max_drawdown'))}",
                f"- stability_score: {_format_metric(summary.get('stability_score'))}",
                f"- trade_count: {_format_metric(summary.get('trade_count'))}",
                f"- profit_factor: {_format_metric(summary.get('profit_factor'))}",
                f"- source tags: {', '.join(auto_search.get('source_tags') or []) or 'N/A'}",
                "",
                "### Saved preset",
                f"- preset name: {item.get('preset_name') or 'N/A'}",
                f"- saved: {str(bool(item.get('saved'))).lower()}",
                f"- dry-run: {str(options.dry_run).lower()}",
                "- note: preset was not automatically activated",
                "",
                "### Formal Backtest Confirmation",
                f"- enabled: {str(bool(formal.get('enabled'))).lower()}",
                f"- success: {str(bool(formal.get('success'))).lower()}",
            ]
        )

        if formal.get("success"):
            lines.extend(
                [
                    f"- AC: {_format_metric(formal_summary.get('ac'))}",
                    f"- cumulative_return: {_format_metric(formal_summary.get('cumulative_return'))}",
                    f"- max_drawdown: {_format_metric(formal_summary.get('max_drawdown'))}",
                    f"- stability_score: {_format_metric(formal_summary.get('stability_score'))}",
                    f"- win_rate: {_format_metric(formal_summary.get('win_rate'))}",
                    f"- trade_count: {_format_metric(formal_summary.get('trade_count'))}",
                    f"- profit_factor: {_format_metric(formal_summary.get('profit_factor'))}",
                    f"- warnings: {', '.join(formal.get('warnings') or []) or 'N/A'}",
                ]
            )
        else:
            lines.append(f"- error: {formal.get('error') or 'N/A'}")

        lines.extend(["", "### Difference / Comparison"])
        if formal.get("success"):
            diff_return = _safe_float(formal_summary.get("cumulative_return"))
            auto_return = _safe_float(summary.get("cumulative_return"))
            diff_mdd = _safe_float(formal_summary.get("max_drawdown"))
            auto_mdd = _safe_float(summary.get("max_drawdown"))
            diff_ac = _safe_float(formal_summary.get("ac"))
            auto_ac = _safe_float(summary.get("ac"))
            formal_trades = _safe_int(formal_summary.get("trade_count"))
            auto_trades = _safe_int(summary.get("trade_count"))

            return_delta = (diff_return - auto_return) if diff_return is not None and auto_return is not None else None
            mdd_delta = (diff_mdd - auto_mdd) if diff_mdd is not None and auto_mdd is not None else None
            ac_delta = (diff_ac - auto_ac) if diff_ac is not None and auto_ac is not None else None

            lines.extend(
                [
                    f"- Formal backtest return minus Auto Search return: {_format_metric(return_delta)}",
                    f"- Formal backtest MDD minus Auto Search MDD: {_format_metric(mdd_delta)}",
                    f"- Formal backtest trade_count minus Auto Search trade_count: {formal_trades - auto_trades}",
                    f"- Formal backtest AC minus Auto Search AC: {_format_metric(ac_delta)}",
                ]
            )
        else:
            lines.append("- skipped due to formal backtest failure or disabled")

        lines.append("")

    return "\n".join(lines).rstrip() + "\n"


def _run_formal_backtest(
    *,
    service: CoreModeService,
    options: BatchRunOptions,
    params: dict[str, Any],
) -> dict[str, Any]:
    request = {
        "symbol": options.symbol,
        "date_range": {
            "start_date": options.start_date,
            "end_date": options.end_date,
        },
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
        "trade_count": len(result.get("trades") or []),
        "chart_row_count": len((result.get("price_chart") or {}).get("candles") or []),
        "warnings": list(result.get("warnings") or []),
    }


def run_batch(options: BatchRunOptions, *, service: CoreModeService | None = None) -> dict[str, Any]:
    service = service or CoreModeService(preset_store_path=options.preset_store_path)
    generated_at = datetime.now(UTC).isoformat()
    goal_results: list[dict[str, Any]] = []

    top_n = max(1, int(options.top_n))
    formal_backtest_top_k = max(0, int(options.formal_backtest_top_k))

    for idx, goal in enumerate(options.goals, start=1):
        score_mode = GOAL_TO_SCORE_MODE[goal]
        print(f"[{idx}/{len(options.goals)}] Running {goal} deep search...")

        row: dict[str, Any] = {
            "goal": goal,
            "score_mode": score_mode,
            "rank": 1,
            "preset_name": None,
            "saved": False,
            "top_candidates": [],
            "top1": None,
            "auto_search": {},
            "formal_backtest": {"enabled": bool(options.run_formal_backtest), "success": False},
            "params": {},
            "warnings": [],
        }

        try:
            auto_request = {
                "symbol": options.symbol,
                "date_range": {"start_date": options.start_date, "end_date": options.end_date},
                "run_optimization": False,
                "auto_search_settings": {
                    "enabled": True,
                    "mode": "single_stock_search",
                    "symbols": [options.symbol],
                    "top_n": top_n,
                    "score_mode": score_mode,
                    "max_runtime_level": "deep",
                },
            }
            auto_result = service.run_core_mode(auto_request)
            ranked = list(((auto_result.get("auto_search_result") or {}).get("results") or []))
            if not ranked:
                raise ValueError("auto search returned no ranked results")

            top_candidates: list[dict[str, Any]] = []
            for fallback_rank, candidate in enumerate(ranked, start=1):
                if len(top_candidates) >= top_n:
                    break
                if not isinstance(candidate, dict):
                    continue
                normalized = _normalize_ranked_candidate(candidate, fallback_rank)
                if not normalized.get("params"):
                    continue
                top_candidates.append(normalized)

            if not top_candidates:
                raise ValueError("auto search top candidates have empty params")

            top1 = top_candidates[0]
            row["rank"] = top1.get("rank", 1)
            row["top_candidates"] = top_candidates
            row["top1"] = {"rank": top1.get("rank"), "params": deepcopy(top1.get("params") or {})}
            row["auto_search"] = {
                "validation_score": top1.get("validation_score"),
                "final_holdout_score": top1.get("final_holdout_score"),
                "summary": top1.get("summary") or {},
                "final_holdout_summary": top1.get("final_holdout_summary") or {},
                "source_tags": list(top1.get("source_tags") or []),
                "warnings": list(top1.get("warnings") or []),
            }
            row["params"] = deepcopy(top1.get("params") or {})

            print(
                f"[{idx}/{len(options.goals)}] Top 1 selected: "
                f"validation_score={_format_metric(row['auto_search'].get('validation_score'))}, "
                f"final_holdout_score={_format_metric(row['auto_search'].get('final_holdout_score'))}"
            )

            if options.save_presets and not options.dry_run:
                preset_name = _ensure_unique_preset_name(
                    service,
                    _build_preset_name(options.symbol, goal, options.start_date, options.end_date),
                )
                print(f"[{idx}/{len(options.goals)}] Saving preset: {preset_name}")
                description = (
                    "Saved by batch deep auto search script. Not automatically activated.\n"
                    f"score_mode={score_mode}\n"
                    f"validation_score={_format_metric(row['auto_search'].get('validation_score'))}\n"
                    f"final_holdout_score={_format_metric(row['auto_search'].get('final_holdout_score'))}\n"
                    f"run_timestamp={generated_at}"
                )
                service.save_preset(name=preset_name, description=description, params=deepcopy(top1.get("params") or {}))
                row["preset_name"] = preset_name
                row["saved"] = True
            else:
                row["preset_name"] = _build_preset_name(options.symbol, goal, options.start_date, options.end_date)
                row["saved"] = False

            if options.run_formal_backtest and formal_backtest_top_k > 0:
                effective_k = min(formal_backtest_top_k, len(top_candidates))
                print(f"[{idx}/{len(options.goals)}] Running formal backtest confirmation for top {effective_k}...")
                for candidate_index, candidate in enumerate(top_candidates):
                    if candidate_index >= effective_k:
                        candidate["formal_backtest"] = {
                            "enabled": False,
                            "success": False,
                            "warnings": [f"skipped because rank>{effective_k}"],
                        }
                        continue
                    try:
                        formal_result = _run_formal_backtest(
                            service=service,
                            options=options,
                            params=deepcopy(candidate.get("params") or {}),
                        )
                        candidate["formal_backtest"] = formal_result
                        if candidate_index == 0:
                            row["formal_backtest"] = formal_result
                        summary2 = formal_result.get("summary") or {}
                        print(
                            f"[{idx}/{len(options.goals)}] rank {candidate.get('rank')} formal done: "
                            f"return={_format_metric(summary2.get('cumulative_return'))}, "
                            f"mdd={_format_metric(summary2.get('max_drawdown'))}, "
                            f"trades={_format_metric(summary2.get('trade_count'))}"
                        )
                    except Exception as exc:
                        failure = {
                            "enabled": True,
                            "success": False,
                            "error": str(exc),
                        }
                        candidate["formal_backtest"] = failure
                        if candidate_index == 0:
                            row["formal_backtest"] = failure
                        print(f"[{idx}/{len(options.goals)}] rank {candidate.get('rank')} formal failed: {exc}")
            elif options.run_formal_backtest:
                row["formal_backtest"] = {
                    "enabled": False,
                    "success": False,
                    "warnings": ["formal_backtest_top_k=0"],
                }
                for candidate in top_candidates:
                    candidate["formal_backtest"] = {
                        "enabled": False,
                        "success": False,
                        "warnings": ["formal_backtest_top_k=0"],
                    }
            else:
                row["formal_backtest"] = {
                    "enabled": False,
                    "success": False,
                    "warnings": ["run_formal_backtest=false"],
                }
                for candidate in top_candidates:
                    candidate["formal_backtest"] = {
                        "enabled": False,
                        "success": False,
                        "warnings": ["run_formal_backtest=false"],
                    }

        except Exception as exc:
            row["warnings"].append(str(exc))
            row["formal_backtest"] = {
                "enabled": bool(options.run_formal_backtest),
                "success": False,
                "error": f"goal failed before formal backtest: {exc}",
            }
            print(f"[{idx}/{len(options.goals)}] Goal failed: {exc}")

        goal_results.append(row)

    payload = {
        "generated_at": generated_at,
        "symbol": options.symbol,
        "date_range": {"start_date": options.start_date, "end_date": options.end_date},
        "top_n": top_n,
        "formal_backtest_top_k": formal_backtest_top_k,
        "run_formal_backtest": options.run_formal_backtest,
        "save_presets": options.save_presets,
        "dry_run": options.dry_run,
        "goals": goal_results,
        "runs": goal_results,
    }

    options.output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    json_path = options.output_dir / f"{stamp}_{options.symbol}_deep_batch.json"
    md_path = options.output_dir / f"{stamp}_{options.symbol}_deep_batch.md"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8-sig")
    md_path.write_text(_build_markdown(goal_results, generated_at=generated_at, options=options), encoding="utf-8-sig")

    payload["report_paths"] = {"json": str(json_path), "markdown": str(md_path)}
    return payload


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run Core Mode deep auto search batch and formal backtest")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--output-dir", default="backend/outputs/core_mode_deep_batch")
    parser.add_argument("--preset-store-path", default="backend/data/core_mode_presets.json")
    parser.add_argument("--goals", nargs="*", default=list(DEFAULT_GOALS))
    parser.add_argument("--top-n", type=int, default=10)
    parser.add_argument("--formal-backtest-top-k", type=int, default=1)
    parser.add_argument("--run-formal-backtest", type=_parse_bool, default=True)
    parser.add_argument("--save-presets", type=_parse_bool, default=True)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    raw_goal_items = list(args.goals or [])
    parsed_goals: list[str] = []
    for item in raw_goal_items:
        for part in str(item).split(","):
            goal = part.strip()
            if goal:
                parsed_goals.append(goal)
    if not parsed_goals:
        parsed_goals = list(DEFAULT_GOALS)

    goals = tuple(goal for goal in parsed_goals if goal in GOAL_TO_SCORE_MODE)
    if not goals:
        raise ValueError("No valid goals provided")

    output_dir = _normalize_runtime_relative_path(str(args.output_dir))
    preset_store_path = _normalize_runtime_relative_path(str(args.preset_store_path))

    options = BatchRunOptions(
        symbol=str(args.symbol).strip().upper(),
        start_date=str(args.start_date),
        end_date=str(args.end_date),
        output_dir=output_dir,
        preset_store_path=preset_store_path,
        goals=goals,
        run_formal_backtest=bool(args.run_formal_backtest),
        save_presets=bool(args.save_presets),
        dry_run=bool(args.dry_run),
        top_n=max(1, int(args.top_n)),
        formal_backtest_top_k=max(0, int(args.formal_backtest_top_k)),
    )
    result = run_batch(options)
    print(json.dumps(result.get("report_paths") or {}, ensure_ascii=False))


if __name__ == "__main__":
    main()
