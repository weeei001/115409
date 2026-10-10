import asyncio
import json
from datetime import timedelta
from threading import BoundedSemaphore, Event
from time import perf_counter
from types import SimpleNamespace

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.clients.llm import LlmResult
from app.core.errors import ServiceUnavailable, UpstreamTimeout
from app.db.models.chat_audit import ChatValidationRun
from app.db.models.user import User
from app.features.chat import audit_repository
from app.features.chat import audit as audit_module
from app.features.chat.audit import (
    ChatAudit, MAX_ANSWER_CHARS, MAX_SOURCE_CHARS, RETENTION_DAYS, utcnow,
)
from app.features.chat.schemas import AskRequest, AskResponse, SourceChunk
from app.features.chat.service import ChatService
from app.features.conversations.service import ConversationService


VALID = "Revenue increased.[S1]"
REJECTED = "Private rejected draft.[S99]"
METADATA = {"finish_reason": "stop", "prompt_tokens": 20, "completion_tokens": 8, "reasoning_tokens": 3,
            "private_debug": "provider-private-secret", "reasoning_content": "hidden-chain-of-thought"}


def response():
    return AskResponse(answer="", detected_stocks=[], time_range=None,
        sources=[SourceChunk(citation_id="S1", title="Quarterly report", source="test", source_name="Report",
                             pub_time="2026-10-08", url="", stock_id="", content="Revenue increased.", score=1)],
        tokens={"input": 7, "output": 2, "thinking": None}, duration_ms=0, current_time="now")


def service(factory, answers=(VALID,), *, timeout=60, text_error=None):
    pending = list(answers)
    calls = []

    async def text(**kwargs):
        calls.append("answer")
        if text_error:
            raise text_error
        answer = pending.pop(0)
        if answer is None:
            await asyncio.Event().wait()
        if isinstance(answer, tuple):
            return LlmResult({}, answer[0], answer[1])
        return LlmResult({}, answer, METADATA)

    llm = SimpleNamespace(require_enabled=lambda: None, text=text,
                          model_name="test-model", settings=SimpleNamespace(LLM_MAX_TOKENS=4096))
    chat = ChatService(http=None, settings=None, retrieval=object(), llm=llm, session_factory=factory)
    chat.request_timeout_seconds = timeout

    async def prepare(request):
        return response(), "This private prompt is not persisted.", ""

    chat._prepare = prepare
    return chat, calls


def records(db):
    db.expire_all()
    return db.scalars(select(ChatValidationRun).order_by(ChatValidationRun.created_at)).all()


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize(("answers", "outcome", "validations"), [
    ((VALID,), "direct", ["not_checked"]),
    ((REJECTED, VALID), "direct", ["not_checked"]),
    ((REJECTED, REJECTED), "direct", ["not_checked"]),
])
def test_audits_attempts_evidence_and_final_answer_without_public_leaks(db_session, stream, answers, outcome, validations):
    chat, calls = service(sessionmaker(db_session.get_bind()), answers)

    async def run():
        request = AskRequest(query="Explain the report", stream=stream)
        result = await chat.ask(request)
        return result.answer, result.model_dump_json()

    final, public = asyncio.run(run())
    rows = records(db_session)
    assert len(rows) == 1 and len(calls) == 1
    row = rows[0]
    assert row.outcome == outcome and row.query == "Explain the report"
    assert row.data["model"] == "test-model"
    assert row.data["publication_completed"] is True
    assert row.data["final_answer"] == final
    assert row.data["source_count"] == 1 and row.data["sources"][0]["content"] == "Revenue increased."
    assert row.data["sources"][0]["citation_id"] == "S1"
    assert [attempt["validation"] for attempt in row.data["attempts"]] == validations
    assert row.data["attempts"][0]["tokens"] == {"input": 20, "output": 8, "thinking": 3}
    assert row.data["tokens"] == {"input": 7 + len(calls) * 20, "output": 2 + len(calls) * 8,
                                  "thinking": len(calls) * 3}
    assert row.data["attempts"][0]["max_tokens"] == 4096
    assert final == answers[0]
    assert row.reason is None and row.data["reasons"] == []
    assert "attempts" not in public and "publication_completed" not in public
    private = json.dumps(row.data)
    for forbidden in ("private_debug", "provider-private-secret", "reasoning_content", "hidden-chain-of-thought",
                      "This private prompt"):
        assert forbidden not in private


def test_nonstream_provider_error_is_saved_without_upstream_error_text(db_session):
    chat, _ = service(sessionmaker(db_session.get_bind()), text_error=ServiceUnavailable("secret provider payload"))
    with pytest.raises(ServiceUnavailable):
        asyncio.run(chat.ask(AskRequest(query="Report")))
    row, = records(db_session)
    assert row.outcome == "error" and row.data["error_type"] == "ServiceUnavailable"
    assert row.data["attempts"][0]["validation"] == "not_checked"
    assert "secret provider payload" not in json.dumps(row.data)


@pytest.mark.parametrize("stream", [False, True])
def test_timeout_captures_attempt_without_repair_or_private_error_details(db_session, stream):
    chat, calls = service(sessionmaker(db_session.get_bind()), (None,), timeout=0.02)

    async def run():
        request = AskRequest(query="Report", stream=stream)
        with pytest.raises(UpstreamTimeout):
            await chat.ask(request)

    asyncio.run(run())
    row = records(db_session)[0]
    assert row.outcome == "error" and row.data["error_type"] == "TimeoutError"
    assert len(calls) == 1 and row.data["attempt_count"] == 1
    assert row.data["attempts"][0]["validation"] == "not_checked"
    assert row.data["final_answer"] == ""


def test_cancellation_records_interruption_and_preserves_cancel(db_session):
    chat, _ = service(sessionmaker(db_session.get_bind()))

    async def run():
        generated = asyncio.Event()
        async def partial(**kwargs):
            generated.set()
            await asyncio.Event().wait()
        chat.llm.text = partial
        task = asyncio.create_task(chat.ask(AskRequest(query="Report")))
        await generated.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(run())
    row, = records(db_session)
    assert row.outcome == "interrupted" and row.data["publication_completed"] is False
    assert row.data["final_answer"] == ""
    assert row.data["attempts"][0]["text"] == ""
    assert row.data["attempts"][0]["validation"] == "not_checked"


def test_missing_audit_table_does_not_fail_chat_or_conversation_deletion(db_session, caplog):
    factory = sessionmaker(db_session.get_bind())
    chat, _ = service(factory, (REJECTED, VALID))
    user = User(email="audit-rollout@example.com")
    db_session.add(user)
    db_session.commit()
    conversations = ConversationService(factory, chat)
    conversation = conversations.create(user.id)
    ChatValidationRun.__table__.drop(db_session.get_bind())

    result = asyncio.run(chat.ask(AskRequest(query="Secret query")))
    assert result.answer == REJECTED
    conversations.delete(user.id, conversation.id)
    assert "Chat diagnostics unavailable: OperationalError" in caplog.text
    assert "Secret query" not in caplog.text and REJECTED not in caplog.text


def test_conversation_history_uses_only_public_answer_and_delete_removes_diagnostics(db_session):
    factory = sessionmaker(db_session.get_bind())
    chat, _ = service(factory, (REJECTED, REJECTED))
    user = User(email="audit-owner@example.com")
    db_session.add(user)
    db_session.commit()
    conversations = ConversationService(factory, chat)
    conversation = conversations.create(user.id)
    turn_id, request = conversations.begin(user.id, conversation.id, AskRequest(query="Report"))
    assert request._turn_id == turn_id and "turn_id" not in request.model_dump()
    asyncio.run(conversations.ask(conversation.id, turn_id, request))
    detail = conversations.get(user.id, conversation.id)
    row = records(db_session)[0]
    assert (row.user_id, row.conversation_id, row.turn_id) == (user.id, conversation.id, turn_id)
    assert row.outcome == "direct" and row.data["attempts"][0]["text"] == REJECTED
    assert REJECTED in detail.model_dump_json()
    assert "attempts" not in detail.model_dump_json()
    _, next_request = conversations.begin(user.id, conversation.id, AskRequest(query="Follow up"))
    assert REJECTED in next_request.model_dump_json()
    conversations.delete(user.id, conversation.id)
    assert records(db_session) == []


def test_deleted_conversation_cannot_be_resurrected_by_late_audit_save(db_session):
    factory = sessionmaker(db_session.get_bind())
    user = User(email="audit-deleted@example.com")
    db_session.add(user)
    db_session.commit()
    conversations = ConversationService(factory, None)
    conversation = conversations.create(user.id)
    _, request = conversations.begin(user.id, conversation.id, AskRequest(query="Report"))
    capture = ChatAudit(request, llm=object(), timeout_seconds=60)
    conversations.delete(user.id, conversation.id)
    asyncio.run(capture.persist(factory))
    assert records(db_session) == []


def test_owner_check_and_insert_are_atomic_against_ordered_delete(db_session, monkeypatch):
    factory = sessionmaker(db_session.get_bind())
    user = User(email="audit-race@example.com")
    db_session.add(user)
    db_session.commit()
    conversations = ConversationService(factory, None)
    conversation = conversations.create(user.id)
    audit = ChatValidationRun(id="race", created_at=utcnow(), user_id=user.id,
                             conversation_id=conversation.id, turn_id="turn", outcome="interrupted",
                             query="Query", reason=None, data={})
    # If a writer checks ownership in a prior SELECT, this deliberately performs
    # deletion in that gap. INSERT ... SELECT instead checks in the write itself.
    with factory() as db, db.begin():
        execute = db.execute
        def delete_before_insert(statement, *args, **kwargs):
            if statement.is_insert:
                conversations.delete(user.id, conversation.id)
            return execute(statement, *args, **kwargs)
        monkeypatch.setattr(db, "execute", delete_before_insert)
        assert audit_repository.add_if_owner_exists(db, audit) is False
    assert records(db_session) == []


def test_capture_limits_are_explicit_and_retention_removes_expired_rows(db_session):
    factory = sessionmaker(db_session.get_bind())
    db_session.add(ChatValidationRun(id="expired", created_at=utcnow() - timedelta(days=RETENTION_DAYS, seconds=1),
                                    outcome="error", query="old", data={}))
    db_session.commit()
    capture = ChatAudit(AskRequest(query="Report"), llm=object(), timeout_seconds=60)
    prepared = response()
    prepared.sources[0].content = "x" * (MAX_SOURCE_CHARS + 1)
    prepared.answer = "a" * (MAX_ANSWER_CHARS + 1)
    capture.prepared(prepared)
    capture.start_attempt("initial", object())
    capture.complete_attempt(prepared.answer, {"finish_reason": "length", "truncated": True})
    capture.publish(prepared, completed=True)
    capture.outcome = "fallback"
    asyncio.run(capture.persist(factory))
    row, = records(db_session)
    assert row.id == capture.id
    assert len(row.data["attempts"][0]["text"]) == MAX_ANSWER_CHARS
    assert row.data["attempts"][0]["text_truncated"] is True
    assert row.data["attempts"][0]["original_chars"] == MAX_ANSWER_CHARS + 1
    assert row.data["attempts"][0]["truncated"] is True
    assert row.data["final_answer_truncated"] is True
    assert row.data["sources"][0]["content_truncated"] is True
    assert row.data["sources_truncated"] is True
    assert row.data["sources"][0]["original_chars"] == MAX_SOURCE_CHARS + 1


def test_untrusted_metadata_and_client_private_fields_are_not_saved(db_session):
    capture = ChatAudit(AskRequest.model_validate({"query": "Report", "_user_id": 123,
                                                  "_conversation_id": "forged", "_turn_id": "forged"}),
                        llm=object(), timeout_seconds=60)
    assert capture.user_id is None and capture.conversation_id is None and capture.turn_id is None
    capture.start_attempt("initial", object())
    capture.complete_attempt("draft", {"finish_reason": "private-provider-string", "prompt_tokens": float("inf"),
                                       "completion_tokens": 2.5, "thinking_tokens": -1,
                                       "reasoning_content": "Never save this reasoning"})
    asyncio.run(capture.persist(sessionmaker(db_session.get_bind())))
    row, = records(db_session)
    attempt = row.data["attempts"][0]
    assert attempt["finish_reason"] == "unknown"
    assert attempt["tokens"] == {"input": None, "output": None, "thinking": None}
    assert "Never save" not in json.dumps(row.data)


def test_slow_audit_writes_have_bounded_wait_and_queue_without_failing_chat(db_session, monkeypatch):
    factory = sessionmaker(db_session.get_bind())
    entered, release, finished = Event(), Event(), Event()
    original = audit_repository.add_if_owner_exists

    def slow_add(db, record):
        entered.set()
        release.wait(2)
        try:
            return original(db, record)
        finally:
            finished.set()

    monkeypatch.setattr(audit_repository, "add_if_owner_exists", slow_add)
    monkeypatch.setattr(audit_module, "SAVE_TIMEOUT_SECONDS", 0.01)
    monkeypatch.setattr(audit_module, "_SAVE_SLOTS", BoundedSemaphore(1))

    async def run():
        try:
            chat, _ = service(factory)
            started = perf_counter()
            assert (await chat.ask(AskRequest(query="first"))).answer.startswith(VALID)
            assert perf_counter() - started < 0.5
            # The bounded response may return before Windows starts the writer.
            # Synchronize its entry before checking the single-writer queue.
            assert await asyncio.to_thread(entered.wait, 1)
            second, _ = service(factory)
            assert (await second.ask(AskRequest(query="second"))).answer.startswith(VALID)
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 1)
            # Leave the event loop alive until the commit and semaphore release.
            await asyncio.sleep(0.02)

    asyncio.run(run())
    row, = records(db_session)
    assert row.query == "first"


def test_cancellation_during_audit_wait_is_not_swallowed(db_session, monkeypatch):
    entered, release, finished = Event(), Event(), Event()
    original = audit_repository.add_if_owner_exists

    def slow_add(db, record):
        entered.set()
        release.wait(2)
        try:
            return original(db, record)
        finally:
            finished.set()

    monkeypatch.setattr(audit_repository, "add_if_owner_exists", slow_add)

    async def run():
        chat, _ = service(sessionmaker(db_session.get_bind()))
        task = asyncio.create_task(chat.ask(AskRequest(query="Report")))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        finally:
            release.set()
            assert await asyncio.to_thread(finished.wait, 1)
            await asyncio.sleep(0.02)

    asyncio.run(run())


def test_large_metadata_keeps_source_identity_when_snapshot_budget_is_exhausted():
    capture = ChatAudit(AskRequest(query="Report"), llm=object(), timeout_seconds=60)
    prepared = response()
    source = prepared.sources[0]
    source.impact_context = [{"entries": [{"label": "x"} for _ in range(64)]} for _ in range(64)]
    prepared.sources = [source.model_copy(update={"citation_id": f"S{number}"}) for number in range(1, 5)]
    capture.prepared(prepared)
    assert capture.data["sources_truncated"] is True
    assert [item["citation_id"] for item in capture.data["sources"]] == ["S1", "S2", "S3", "S4"]
    assert all(item["title"] == "Quarterly report" for item in capture.data["sources"])
    assert capture.data["sources"][-1]["content_truncated"] is True
    assert len(json.dumps(capture.data)) < 200000


def test_usage_remains_unknown_when_unreported():
    capture = ChatAudit(AskRequest(query="Report"), llm=object(), timeout_seconds=60)
    capture.start_attempt("initial", object())
    capture.complete_attempt("draft", {})
    capture.bypassed()
    assert capture.data["tokens"] == {"input": None, "output": None, "thinking": None}
