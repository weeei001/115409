"""Preserve actionable validation diagnostics through the administrator view."""
from types import SimpleNamespace

import pytest

from app.features.admin.chat_review_schemas import ChatReviewAttempt
from app.features.chat.answer_validation import (
    GroundingValidationError, NumericValidationError, TruncatedAnswerError,
)
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


@pytest.mark.parametrize("issue", [
    "unparsed", "unsupported", "contradicted", "invalid_evidence", "conclusion_unsupported", "account_limit",
])
def test_numeric_issue_survives_audit_and_admin_serialization(issue):
    audit, client = new_audit()
    error = NumericValidationError("Fixture validation detail", claim="Fixture rejected claim", issue=issue)
    audit.complete_attempt("Fixture draft", {"finish_reason": "stop"})
    audit.rejected(error)

    attempt = ChatReviewAttempt.model_validate(audit.data["attempts"][0]).model_dump()
    assert attempt["issue"] == issue
    assert attempt["reason"] == "numbers"
    assert attempt["validation"] == "rejected"
    assert attempt["claim"] == "Fixture rejected claim"
    assert attempt["detail"] == "Fixture validation detail"
    assert attempt["hint"] == error.hint
    assert attempt["text"] == "Fixture draft"

    audit.start_attempt("repair", client)
    audit.complete_attempt("Fixture corrected answer", {"finish_reason": "stop"})
    audit.passed()
    assert audit.outcome == "repaired"
    assert audit.data["attempt_count"] == 2
    assert audit.data["attempts"][0]["issue"] == issue
    assert audit.data["attempts"][1]["validation"] == "passed"
    assert audit.data["reasons"] == ["numbers"]


def test_truncation_preserves_existing_length_reason_and_explicit_issue():
    audit, _ = new_audit()
    audit.complete_attempt("Incomplete fixture", {"finish_reason": "length"})
    audit.rejected(TruncatedAnswerError("Incomplete generation"))
    attempt = ChatReviewAttempt.model_validate(audit.data["attempts"][0])
    assert attempt.reason == "length"
    assert attempt.issue == "truncated"
    assert attempt.truncated is True
    assert attempt.finish_reason == "length"
    assert attempt.validation == "rejected"


def test_unsupported_causality_is_distinguishable_from_missing_observations():
    audit, _ = new_audit()
    audit.rejected(GroundingValidationError("Unsubstantiated cause", hint="Fixture causal claim"))
    attempt = ChatReviewAttempt.model_validate(audit.data["attempts"][0])
    assert attempt.reason == "grounding"
    assert attempt.issue == "conclusion_unsupported"
    assert attempt.hint == "Fixture causal claim"


def test_existing_admin_attempt_without_issue_remains_readable():
    historical = {
        "number": 1, "stage": "initial", "validation": "rejected", "reason": "numbers",
        "hint": "Legacy diagnostic", "claim": "Legacy claim", "detail": "Legacy detail",
    }
    attempt = ChatReviewAttempt.model_validate(historical)
    assert attempt.issue is None
    assert {key: attempt.model_dump()[key] for key in historical} == historical
