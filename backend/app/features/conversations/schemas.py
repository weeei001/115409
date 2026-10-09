from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.features.chat.schemas import ChatAction, ChatDashboard, ChatFollowUp, PaperOrderDraft, SourceChunk


class ConversationSummary(BaseModel):
    id: str
    title: str
    updated_at: datetime


class SavedMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    timestamp: datetime
    status: Literal["streaming", "completed", "failed", "interrupted"] | None = None
    error: str | None = None
    actions: list[ChatAction | ChatFollowUp | PaperOrderDraft] = Field(default_factory=list)
    dashboard: ChatDashboard | None = None
    sources: list[SourceChunk] = Field(default_factory=list)
    feedback: Literal["up", "down"] | None = Field(
        default=None, description="Owner's helpful (up) or unhelpful (down) rating of this assistant message.")


class MessageFeedbackRequest(BaseModel):
    rating: Literal["up", "down"]


class MessageFeedback(BaseModel):
    message_id: str
    rating: Literal["up", "down"] | None


class ConversationDetail(ConversationSummary):
    messages: list[SavedMessage]


class ConversationList(BaseModel):
    items: list[ConversationSummary]
    has_more: bool
