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


def test_generation_uses_one_bounded_example_and_bounded_citations():
    from pydantic import ValidationError
    from app.features.analysis.schemas import TextBriefForwardView

    assert len(select_examples("2330", "2026-09-22")) == 1
    view = {"stance": "uncertain", "reason": "Limited data", "invalidation": "Operating conditions change"}
    for ids in (["nw_01"] * 7, ["nw_01 HDMI_01"], ["nw_" + "1" * 20]):
        with pytest.raises(ValidationError):
            TextBriefForwardView(**view, evidence_ids=ids)
    schema = TextBriefForwardView.model_json_schema()["properties"]["evidence_ids"]
    assert schema["maxItems"] == 6 and schema["items"]["maxLength"] == 16


def test_source_disclaimer_does_not_hide_price_targets_or_trade_instructions():
    from app.features.analysis.compliance import scan_compliance_hits

    note = "部分新聞為媒體轉述之目標價，非正式公司公告。"
    assert not scan_compliance_hits(note)
    for text in (note + "目標價 1500 元。", note + "建議買進。", "媒體目標價 1500 元，非公司公告。"):
        assert any(hit.severity == "hard" for hit in scan_compliance_hits(text))
