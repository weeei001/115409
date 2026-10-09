"""Exercise bounded partial recovery through HTTP-equivalent and SSE service paths."""
import asyncio

import pytest
from sqlalchemy.orm import sessionmaker

from app.features.chat.schemas import AskRequest
from app.features.chat.prompts import INSUFFICIENT_EVIDENCE_ANSWER
import test_chat_audit
from test_chat_claim_wording import CATALOG, LONG, evidence

from test_chat_investment_arrangement import METADATA, run_turn, substantive_answer


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("bad", [
    "神秘指標10%。[S2]",
    "台積電2026-10-07收盤價999元。[S2]",
    "鴻海持股999股。[S1]",
    "假設建議投入60000元買台積電。[S1]",
    "示範賣出台積電80股。[S1]",
])
def test_failed_repair_retains_independent_answer_for_original_question(db_session, stream, bad):
    draft = substantive_answer("pending") + "\n\n" + bad + "\n\n因此建議全部投入。[S1]"
    answer, public, record, calls = run_turn(
        db_session, "pending", [(draft, METADATA), (draft, METADATA)], stream=stream)
    assert len(calls) == 2
    assert record.outcome == "repaired"
    assert record.data["recovery"]["method"] == "validated_partial"
    assert [attempt["validation"] for attempt in record.data["attempts"]] == ["rejected", "rejected"]
    assert "分析意見：應避免把資金集中在單一股票" in answer
    assert "鴻海尚缺行情資料，未納入比較" in answer
    assert "40000元" in answer and "2026-10-07收盤價100元" in answer
    assert "全部投入" not in answer and "999" not in answer and "60000" not in answer
    assert "賣出台積電80" not in answer and "神秘指標" not in answer
    assert "validated_partial" not in public


@pytest.mark.parametrize("stream", [False, True])
def test_truncated_retry_can_only_recover_complete_initial_draft(db_session, stream):
    draft = substantive_answer("pending") + "\n\n神秘指標10%。[S2]"
    truncated = ("截斷的內容不得發布。" + substantive_answer("pending"),
                 {**METADATA, "finish_reason": "length"})
    answer, _, record, calls = run_turn(
        db_session, "pending", [(draft, METADATA), truncated], stream=stream)
    assert len(calls) == 2
    assert record.data["recovery"]["draft_stage"] == "initial"
    assert record.data["attempts"][1]["issue"] == "truncated"
    assert "截斷的內容" not in answer and "神秘指標" not in answer
    assert "分析意見" in answer


@pytest.mark.parametrize("stream", [False, True])
def test_correct_comparison_facts_survive_failed_conclusion_repair(db_session, monkeypatch, stream):
    prepared = test_chat_audit.response()
    prepared.sources = [evidence()]
    prepared._company_catalog = CATALOG
    monkeypatch.setattr(test_chat_audit, "response", lambda: prepared)
    draft = LONG + "[S1]"
    chat, calls = test_chat_audit.service(sessionmaker(db_session.get_bind()), (draft, draft))

    async def run():
        request = AskRequest(query="比較這些股票", stream=stream)
        if stream:
            events = [event async for event in chat.stream_events(request)]
            assert events[-1]["type"] == "done"
            assert len([event for event in events if event["type"] == "text"]) == 1
            return events[-1]["answer"]
        return (await chat.ask(request)).answer

    answer = asyncio.run(run())
    assert len(calls) == 2
    assert "更為抗跌穩健" not in answer
    assert all(value in answer for value in ("4.30", "10.69", "-1.37", "-8.04", "-19.50", "-1.68"))
    record = test_chat_audit.records(db_session)[0]
    assert record.outcome == "repaired"
    assert record.data["attempts"][0]["issue"] == "conclusion_unsupported"
    assert record.data["recovery"]["method"] == "validated_partial"


@pytest.mark.parametrize("suffix", ["", "【S1】"])
def test_fixed_insufficient_answer_is_not_recorded_as_substantive_success(db_session, suffix):
    chat, calls = test_chat_audit.service(
        sessionmaker(db_session.get_bind()), (INSUFFICIENT_EVIDENCE_ANSWER + suffix,))
    response = asyncio.run(chat.ask(AskRequest(query="Explain the report")))
    assert response.answer == INSUFFICIENT_EVIDENCE_ANSWER
    assert len(calls) == 1
    assert test_chat_audit.records(db_session)[0].outcome == "fallback"
