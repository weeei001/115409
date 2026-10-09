"""Explicit, administrator-only views of retained AI validation diagnostics."""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.features.chat.schemas import SourceChunk


ChatReviewOutcome = Literal["passed", "repaired", "fallback", "direct", "error", "interrupted"]
ChatReviewFilter = Literal["attention", "passed", "repaired", "fallback", "direct", "error", "interrupted"]


class ChatReviewTokens(BaseModel):
    input: int | None = None
    output: int | None = None
    thinking: int | None = None


class ChatReviewAttempt(BaseModel):
    number: int
    stage: Literal["initial", "repair"]
    text: str = ""
    text_truncated: bool = False
    original_chars: int = 0
    finish_reason: str | None = None
    truncated: bool = False
    validation: Literal["passed", "rejected", "not_checked"] = "not_checked"
    reason: str | None = None
    hint: str | None = None
    issue: str | None = None
    claim: str | None = None
    detail: str | None = None
    diagnostics_truncated: bool = False
    duration_ms: int | None = None
    tokens: ChatReviewTokens = Field(default_factory=ChatReviewTokens)
    max_tokens: int | None = None


class ChatReviewSource(BaseModel):
    # A bounded diagnostic snapshot may no longer satisfy the full SourceChunk
    # schema. Keep its display identity and preserve clipped provenance as JSON.
    citation_id: str = ""
    title: str = ""
    source: str = ""
    source_name: str = ""
    category: str = ""
    pub_time: str = ""
    url: str = ""
    stock_id: str = ""
    stock_ids: list[str] = Field(default_factory=list)
    content: str = ""
    content_truncated: bool = False
    original_chars: int = 0
    snapshot_truncated: bool = False
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def bounded_source(cls, value):
        if not isinstance(value, dict):
            return value
        value = dict(value)
        allowed = SourceChunk.model_fields.keys() - cls.model_fields.keys()
        # Never pass through an arbitrary extra metadata field from the audit row.
        value["metadata"] = {key: value[key] for key in allowed if key in value}
        ids = value.get("stock_ids")
        value["stock_ids"] = [item for item in ids if isinstance(item, str)] if isinstance(ids, list) else []
        return value


class ChatReviewRecoveryItem(BaseModel):
    paragraph: int | None = None
    reason: str
    result: str
    units: int | None = None


class ChatReviewRecovery(BaseModel):
    method: Literal["validated_partial"]
    draft_stage: Literal["initial", "repair"]
    validation: Literal["passed"]
    removed: list[ChatReviewRecoveryItem] = Field(default_factory=list)


class ChatReviewSummary(BaseModel):
    id: str
    created_at: datetime
    user_id: int | None = None
    user_email: str | None = None
    conversation_id: str | None = None
    turn_id: str | None = None
    outcome: ChatReviewOutcome
    reason: str | None = None
    reasons: list[str] = Field(default_factory=list)
    query_preview: str
    model: str | None = None
    duration_ms: int = 0
    attempt_count: int = 0
    source_count: int = 0
    publication_completed: bool = False

    @field_validator("created_at")
    @classmethod
    def utc_timestamp(cls, value: datetime) -> datetime:
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


class ChatReviewList(BaseModel):
    items: list[ChatReviewSummary]
    total: int
    retention_days: int


class ChatReviewDetail(ChatReviewSummary):
    schema_version: int = 1
    query: str
    query_truncated: bool = False
    query_original_chars: int = 0
    final_answer: str = ""
    final_answer_truncated: bool = False
    final_answer_original_chars: int = 0
    attempts: list[ChatReviewAttempt] = Field(default_factory=list)
    sources: list[ChatReviewSource] = Field(default_factory=list)
    sources_truncated: bool = False
    tokens: ChatReviewTokens = Field(default_factory=ChatReviewTokens)
    request_timeout_seconds: float | None = None
    repair_max_tokens: int | None = None
    requires_portfolio: bool = False
    answer_detail: str = "plain"
    error_type: str | None = None
    recovery: ChatReviewRecovery | None = None
