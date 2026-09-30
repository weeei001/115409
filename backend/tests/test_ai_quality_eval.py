from copy import deepcopy

import pytest

from app.jobs.research.ai_quality_eval import load_cases, score_captures


def test_offline_corpus_and_scoring_preserve_denominators_and_regressions():
    cases = load_cases()["cases"]
    assert len(cases) == 9
    assert len(next(c for c in cases if c["id"] == "tail_counterevidence")["documents"][0]["text"]) > 7000
    captures = []
    for arm in ("date_company", "current_vector", "candidate_vector"):
        for case in cases:
            captures.append({"arm": arm, "case_id": case["id"], "model": "fixture",
                             "prompt_hash": "fixed", "token_budget": 1000,
                             "retrieved_ids": [d["id"] for d in case["documents"]],
                             "contexts": [{"id": d["id"], "text": d["text"]} for d in case["documents"]],
                             "answer": "fixture only"})
    result = score_captures(cases, captures)
    arm = result["arms"]["current_vector"]
    assert arm["n_cases"] == 9 and arm["human_reviewed_cases"] == 0
    assert sum(c["time_leaks"] for c in arm["cases"]) == 1
    assert sum(c["forbidden_sent"] for c in arm["cases"]) == 2
    assert result["adoption_decision"].startswith("requires_")
    with pytest.raises(ValueError, match="every case"):
        score_captures(cases, captures[:-1])
    bad = deepcopy(captures)
    bad[-1]["model"] = "different"
    with pytest.raises(ValueError, match="Uncontrolled"):
        score_captures(cases, bad)
