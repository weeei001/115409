import json

import pytest

from app.features.analysis.prompts import few_shot_examples, select_examples
from app.features.analysis.schemas import StockBehaviorTextBrief
from app.features.analysis.validation import _text_brief_referenced_ids


@pytest.mark.parametrize("example", few_shot_examples(), ids=lambda example: example["scenario"])
def test_examples_match_their_own_evidence_and_schema(example):
    payload = example["input_payload"]
    answer = StockBehaviorTextBrief.model_validate(example["output_brief"])
    ids = {item["id"] for section in ("daily_timeline", "chip_summary", "long_term_anchor", "fundamental", "news")
           for item in payload.get(section, [])}
    timeline = {item["id"]: item for item in payload["daily_timeline"]}
    assert _text_brief_referenced_ids(answer.model_dump()) <= ids
    for day in answer.key_days:
        assert day.ref in day.evidence_ids
        assert day.date == timeline[day.ref]["date"] <= payload["task"]["as_of_date"]
    assert all(item.claim_type == "conflict" for item in answer.source_divergences)


def test_examples_exclude_all_future_and_same_stock_same_day_answers():
    assert select_examples("2330", "2020-01-01") == []
    for source, answer in select_examples("2330", "2026-07-13"):
        task = json.loads(source)["task"]
        assert task["as_of_date"] <= "2026-07-13"
        assert (task["symbol"], task["as_of_date"]) != ("2330", "2026-07-13")
        assert StockBehaviorTextBrief.model_validate_json(answer)
