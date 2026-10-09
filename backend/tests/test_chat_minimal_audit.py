"""Direct answers are recorded as unchecked; historical validation records stay readable."""
from types import SimpleNamespace

from app.features.admin.chat_review_schemas import ChatReviewAttempt
from app.features.chat.audit import ChatAudit
from app.features.chat.schemas import AskRequest


def new_audit():
    client = SimpleNamespace(model_name="fixture", settings=SimpleNamespace(LLM_MAX_TOKENS=2048))
    audit = ChatAudit(AskRequest(query="Discuss the fixed evidence"), llm=client,
                      timeout_seconds=60, repair_max_tokens=2048)
    audit.start_attempt("initial", client)
    return audit, client


def test_direct_answer_is_not_recorded_as_validated():
    audit, _ = new_audit()
    audit.append_text("Fixture generated answer")
    audit.metadata({"finish_reason": "stop", "completion_tokens": 12})
    audit.bypassed()
    attempt = ChatReviewAttempt.model_validate(audit.data["attempts"][0])
    assert audit.outcome == "direct"
    assert attempt.validation == "not_checked"
    assert attempt.reason is None
    assert audit.data["reasons"] == []
    assert audit.data["attempt_count"] == 1
    assert attempt.tokens.output == 12
    assert audit._attempt_started is None


def test_existing_admin_attempt_without_issue_remains_readable():
    historical = {
        "number": 1, "stage": "initial", "validation": "rejected", "reason": "numbers",
        "hint": "Legacy diagnostic", "claim": "Legacy claim", "detail": "Legacy detail",
    }
    attempt = ChatReviewAttempt.model_validate(historical)
    assert attempt.issue is None
    assert {key: attempt.model_dump()[key] for key in historical} == historical
