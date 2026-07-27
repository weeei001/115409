from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from time import perf_counter
from typing import Any


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from database import Base, SessionLocal, engine
from schemas.stock_behavior import StockBehaviorAiRequest
from scripts.build_golden_candidates import collect_case_news, load_cases
from stock_behavior.compliance import COMPLIANCE_POLICY_VERSION
from stock_behavior.eval_metrics import aggregate_eval_results
from stock_behavior.few_shot_examples import example_set_version
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from stock_behavior.prompt_templates import TEXT_BRIEF_PROMPT_VERSION


def _failed_response() -> dict[str, Any]:
    return {
        "status": "unavailable",
        "brief": None,
        "verification": {
            "compliance_violations": [],
            "soft_compliance_hits": [],
            "simplified_chars": [],
        },
    }


def render_markdown(report: dict[str, Any]) -> str:
    lines = ["# Text Brief Eval Report", "", f"Generated at: {report['generated_at']}", "", "## Config", "", "| Key | Value |", "| --- | --- |"]
    lines.extend(f"| {key} | {value} |" for key, value in report["config"].items())
    lines.extend(["", "## Aggregate", "", "| Metric | Value |", "| --- | --- |"])
    lines.extend(
        f"| {key} | {json.dumps(value, ensure_ascii=False) if isinstance(value, (dict, list)) else value} |"
        for key, value in report["aggregate"].items()
    )
    lines.extend(
        [
            "",
            "## Stance Matrix",
            "",
            "| Symbol | As-of | Scenario | Repeat | Status | Overall |",
            "| --- | --- | --- | ---: | --- | --- |",
        ]
    )
    for result in report["results"]:
        response = result["response"]
        brief = response.get("brief") or {}
        case = result["case"]
        scenario = str(case.get("scenario", "-")).replace("|", "\\|")
        lines.append(
            f"| {case['symbol']} | {case['as_of_date']} | {scenario} | {result['repeat']} | "
            f"{response.get('status', '-')} | {brief.get('overall_stance', '-')} |"
        )
    return "\n".join(lines) + "\n"


async def run_eval(db: Any, settings: Any, cases: list[dict], repeats: int) -> dict[str, Any]:
    orchestrator = StockBehaviorOrchestrator(db=db, settings=settings)
    results = []
    run_number = 0
    runs_total = len(cases) * repeats
    for case in cases:
        news_sources, fallback_mode, rag_error = await collect_case_news(orchestrator, case)
        if rag_error:
            print(f"symbol={case['symbol']} as_of={case['as_of_date']} rag_error={rag_error}")
        for repeat in range(1, repeats + 1):
            started_at = perf_counter()
            result = {"case": case, "repeat": repeat}
            try:
                response = await orchestrator.generate_text_brief(
                    StockBehaviorAiRequest(
                        symbol=case["symbol"],
                        as_of_date=case["as_of_date"],
                        news_sources=news_sources,
                        fallback_mode=fallback_mode,
                    )
                )
                result["response"] = response.model_dump(mode="json")
                print(f"symbol={case['symbol']} as_of={case['as_of_date']} repeat={repeat} result=success")
            except Exception as exc:
                db.rollback()
                result.update(response=_failed_response(), error=str(exc))
                print(f"symbol={case['symbol']} as_of={case['as_of_date']} repeat={repeat} result=failed error={exc}")
            result["latency_ms"] = round((perf_counter() - started_at) * 1000)
            if rag_error:
                result["rag_error"] = rag_error
            results.append(result)
            run_number += 1
            if run_number < runs_total:
                await asyncio.sleep(3)
    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "config": {
            "model": orchestrator._llm.model_name,
            "prompt_version": TEXT_BRIEF_PROMPT_VERSION,
            "example_set_version": example_set_version(),
            "compliance_policy_version": COMPLIANCE_POLICY_VERSION,
        },
        "results": results,
        "aggregate": aggregate_eval_results(results),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run repeated text-brief evaluation.")
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--out", type=Path, default=Path("eval_reports"))
    args = parser.parse_args(argv)
    if args.repeats < 1:
        parser.error("--repeats must be at least 1")
    return args


def main() -> None:
    args = parse_args()
    try:
        cases = load_cases(args.cases)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid cases file: {exc}") from exc
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        report = asyncio.run(run_eval(db, get_settings(), cases, args.repeats))
    finally:
        db.close()

    args.out.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    stem = args.out / f"eval_{timestamp}"
    stem.with_suffix(".json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    stem.with_suffix(".md").write_text(render_markdown(report), encoding="utf-8")
    print(f"report_json={stem.with_suffix('.json')}")
    print(f"report_markdown={stem.with_suffix('.md')}")


if __name__ == "__main__":
    main()
