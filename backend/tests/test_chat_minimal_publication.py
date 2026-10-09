"""確認一般回覆與串流都直接回傳原文，不再局部修復。"""
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
def test_mixed_answer_is_published_without_claim_removal(db_session, stream, bad):
    draft = substantive_answer("pending") + "\n\n" + bad + "\n\n因此建議全部投入。[S1]"
    answer, public, record, calls = run_turn(
        db_session, "pending", [(draft, METADATA), (draft, METADATA)], stream=stream)
    assert answer == draft
    assert len(calls) == 1
    assert record.outcome == "direct"
    assert [attempt["validation"] for attempt in record.data["attempts"]] == ["not_checked"]
    assert "recovery" not in record.data
    assert "validated_partial" not in public


@pytest.mark.parametrize("stream", [False, True])
def test_initial_answer_never_starts_partial_recovery_or_retry(db_session, stream):
    draft = substantive_answer("pending") + "\n\n神秘指標10%。[S2]"
    truncated = ("截斷的內容不得發布。" + substantive_answer("pending"),
                 {**METADATA, "finish_reason": "length"})
    answer, _, record, calls = run_turn(
        db_session, "pending", [(draft, METADATA), truncated], stream=stream)
    assert answer == draft
    assert len(calls) == 1
    assert "recovery" not in record.data
    assert record.data["attempts"][0]["validation"] == "not_checked"


@pytest.mark.parametrize("stream", [False, True])
def test_comparison_conclusions_are_not_rewritten(db_session, monkeypatch, stream):
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
    assert answer == draft
    assert len(calls) == 1
    record = test_chat_audit.records(db_session)[0]
    assert record.outcome == "direct"
    assert record.data["attempts"][0]["validation"] == "not_checked"
    assert "recovery" not in record.data


@pytest.mark.parametrize("suffix", ["", "【S1】"])
def test_model_insufficient_answer_is_published_unchanged(db_session, suffix):
    chat, calls = test_chat_audit.service(
        sessionmaker(db_session.get_bind()), (INSUFFICIENT_EVIDENCE_ANSWER + suffix,))
    response = asyncio.run(chat.ask(AskRequest(query="Explain the report")))
    assert response.answer == INSUFFICIENT_EVIDENCE_ANSWER + suffix
    assert len(calls) == 1
    assert test_chat_audit.records(db_session)[0].outcome == "direct"
