"""Score saved retrieval/answer captures offline. Never calls a provider or database."""
from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path

CASES = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "ai_quality_cases.json"
REVIEW_FIELDS = ("citation_support", "numeric_accuracy", "target_event_accuracy", "uncertainty_handling")


def load_cases(path: Path = CASES) -> dict:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    for case in fixture["cases"]:
        for doc in case["documents"]:
            repetitions = doc.pop("expand_background_repetitions", 1)
            doc["text"] = doc["text"].replace("背景段落。", "背景段落。" * repetitions)
    return fixture


def score_captures(cases: list[dict], captures: list[dict]) -> dict:
    """All arms must contain every case; human scores remain absent until reviewed."""
    expected = {case["id"]: case for case in cases}
    by_arm = defaultdict(dict)
    for capture in captures:
        case_id = capture["case_id"]
        if case_id not in expected or case_id in by_arm[capture["arm"]]:
            raise ValueError("Unknown or duplicate case capture")
        by_arm[capture["arm"]][case_id] = capture
    if not by_arm or any(set(rows) != set(expected) for rows in by_arm.values()):
        raise ValueError("Every arm must capture every case, including failures")
    results = {}
    for arm, rows in by_arm.items():
        scored = []
        for case_id, case in expected.items():
            row = rows[case_id]
            peers = [group[case_id] for group in by_arm.values()]
            for key in ("model", "prompt_hash", "token_budget"):
                if any(peer[key] != row[key] for peer in peers):
                    raise ValueError(f"Uncontrolled comparison: {case_id} {key}")
            docs = {doc["id"]: doc for doc in case["documents"]}
            retrieved = set(row["retrieved_ids"])
            contexts = row["contexts"]
            if not retrieved <= docs.keys() or any(context["id"] not in retrieved for context in contexts):
                raise ValueError("Capture references an unknown/unretrieved document")
            if any(context["text"] not in docs[context["id"]]["text"] for context in contexts):
                raise ValueError("Captured contexts must be verbatim document passages")
            relevant = set(case["relevant_ids"])
            sent_ids = {context["id"] for context in contexts}
            cutoff = datetime.fromisoformat(case["cutoff"])
            time_leaks = sum(datetime.fromisoformat(docs[key]["published_at"]) > cutoff for key in sent_ids)
            sent_text = "\n".join(context["text"] for context in contexts)
            spans = case["required_spans"]
            review = row.get("review", {})
            if any(value not in (True, False, None) for key, value in review.items() if key in REVIEW_FIELDS):
                raise ValueError("Human review fields must be true, false or null")
            scored.append({
                "case_id": case_id, "category": case["category"],
                "relevant_recalled": len(retrieved & relevant), "relevant_total": len(relevant),
                "irrelevant_retrieved": len(retrieved - relevant), "retrieved_total": len(retrieved),
                "forbidden_sent": len(sent_ids & set(case["forbidden_ids"])), "time_leaks": time_leaks,
                "required_spans_kept": sum(span in sent_text for span in spans), "required_spans_total": len(spans),
                "answer": row["answer"], "review": {key: review.get(key) for key in REVIEW_FIELDS},
                "annotation_disagreement": review.get("disagreement"),
                "latency_ms": row.get("latency_ms"), "cost_usd": row.get("cost_usd"),
                "input_tokens": row.get("input_tokens"),
            })
        results[arm] = {"n_cases": len(scored), "cases": scored,
                        "human_reviewed_cases": sum(all(item["review"][key] is not None for key in REVIEW_FIELDS) for item in scored)}
    return {"scope": "offline_capture_scoring_not_live_model_validation", "arms": results,
            "adoption_decision": "requires_independent_annotation_and_real_provider_comparison"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--captures", type=Path, help="JSON list of complete arm/case captures")
    parser.add_argument("--export-cases", action="store_true", help="Print expanded synthetic corpus")
    args = parser.parse_args()
    fixture = load_cases()
    if args.export_cases:
        result = fixture
    elif args.captures:
        result = score_captures(fixture["cases"], json.loads(args.captures.read_text(encoding="utf-8")))
    else:
        parser.error("Supply --captures or --export-cases")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
