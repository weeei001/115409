"""Neutral plan labels preserve local intent and the complete account budget."""
import json

import pytest

from app.features.chat.answer_validation import NumericValidationError, _checked_answer
from app.features.chat.proposals import parse_proposals, plan_supported
from app.features.chat.schemas import SourceChunk


CATALOG = {"2330": {"name": "台積電"}}
ALIASES = {"台積電": "2330"}
SOURCE = SourceChunk(
    citation_id="S1", category="personal", title="Synthetic account", source="test",
    source_name="Test", pub_time="", url="", stock_id="", score=1,
    content=json.dumps({"portfolio": {
        "initialized": True, "available_cash": 50000, "cash": 50000,
        "positions": [{"symbol": "2330", "quantity": 100, "reserved_quantity": 80}],
    }}),
)


def check(text):
    return _checked_answer(text, {"finish_reason": "stop"}, [SOURCE],
                           company_catalog=CATALOG, require_portfolio=True)


@pytest.mark.parametrize("label", ["穩健防守方案：", "方案一：", "成長動能方案: ", "方案2："])
@pytest.mark.parametrize("text", [
    "建議投入可用資金30000元，其餘保留20000元現金。",
    "建議賣出台積電20股。",
])
def test_neutral_plan_label_preserves_proposal_values_and_offsets(label, text):
    original = parse_proposals(text, ALIASES)
    labelled = parse_proposals(label + text, ALIASES)
    assert original and len(original) == len(labelled)
    for first, second in zip(original, labelled):
        assert second.start == first.start + len(label)
        assert second.end == first.end + len(label)
        assert (second.low, second.high, second.kind, second.action, second.symbol) == (
            first.low, first.high, first.kind, first.action, first.symbol)
    answer = label + text + "[S1]"
    assert check(answer).startswith(answer)


@pytest.mark.parametrize("text", [
    "穩健防守方案：可用資金30000元。",
    "穩健防守方案：建議投入10000元，目前可用資金30000元。",
    "穩健防守方案：目前台積電持股999股。",
    "穩健防守方案：建議投入60000元。",
    "穩健防守方案：建議賣出台積電21股。",
])
def test_plan_labels_do_not_exempt_observations_or_account_limits(text):
    with pytest.raises(NumericValidationError):
        check(text + "[S1]")


@pytest.mark.parametrize("text", [
    "穩健防守方案：建議投入30000元，保留20000元現金。[S1]\n\n"
    "成長動能方案：建議投入20000元。[S1]",
    "方案一：建議賣出台積電10股。[S1]\n\n方案二：建議賣出台積電11股。[S1]",
])
def test_separate_plan_labels_do_not_reset_cumulative_money_or_inventory(text):
    assert not plan_supported(text, [SOURCE], ALIASES, require_portfolio=True)
    with pytest.raises(NumericValidationError):
        check(text)
