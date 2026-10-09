"""Administrator summary of users' helpful/unhelpful ratings on AI chat answers."""

from datetime import datetime, timedelta, timezone

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.chat_feedback import ChatMessageFeedback
from app.db.models.conversation import ConversationMessage
from app.features.conversations.repository import feedback_ready

EXCERPT_CHARS = 120
NEGATIVE_LIMIT = 10


class NegativeFeedbackItem(BaseModel):
    message_id: str
    conversation_id: str
    rated_at: datetime
    answer_excerpt: str = Field(description="回覆開頭節錄，最多 120 字。")


class AIFeedbackSummary(BaseModel):
    days: int
    ready: bool = Field(description="回饋資料表是否已建立；false 時其餘數字皆為 0。")
    completed_answers: int = Field(description="期間內完成的 AI 回覆數。")
    rated: int
    helpful: int
    unhelpful: int
    helpful_rate: float | None = Field(default=None, description="helpful / rated，0–1；沒有回饋為 null。")
    recent_unhelpful: list[NegativeFeedbackItem] = Field(default_factory=list)


def summary(db: Session, days: int) -> AIFeedbackSummary:
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)
    completed = db.scalar(select(func.count()).select_from(ConversationMessage).where(
        ConversationMessage.role == "assistant", ConversationMessage.status == "completed",
        ConversationMessage.timestamp >= cutoff)) or 0
    if not feedback_ready(db):
        return AIFeedbackSummary(days=days, ready=False, completed_answers=completed,
                                 rated=0, helpful=0, unhelpful=0)
    counts = dict(db.execute(select(ChatMessageFeedback.rating, func.count()).where(
        ChatMessageFeedback.updated_at >= cutoff).group_by(ChatMessageFeedback.rating)).all())
    helpful, unhelpful = counts.get("up", 0), counts.get("down", 0)
    rated = helpful + unhelpful
    rows = db.execute(select(ChatMessageFeedback.message_id, ChatMessageFeedback.conversation_id,
                             ChatMessageFeedback.updated_at, ConversationMessage.content)
                      .join(ConversationMessage, ConversationMessage.id == ChatMessageFeedback.message_id)
                      .where(ChatMessageFeedback.rating == "down", ChatMessageFeedback.updated_at >= cutoff)
                      .order_by(ChatMessageFeedback.updated_at.desc()).limit(NEGATIVE_LIMIT)).all()
    return AIFeedbackSummary(
        days=days, ready=True, completed_answers=completed, rated=rated, helpful=helpful, unhelpful=unhelpful,
        helpful_rate=round(helpful / rated, 4) if rated else None,
        recent_unhelpful=[NegativeFeedbackItem(
            message_id=row.message_id, conversation_id=row.conversation_id,
            rated_at=row.updated_at.replace(tzinfo=timezone.utc),
            answer_excerpt=" ".join((row.content or "").split())[:EXCERPT_CHARS],
        ) for row in rows],
    )
