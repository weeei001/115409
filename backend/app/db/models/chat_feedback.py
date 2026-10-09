from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.mysql import DATETIME

from app.db.base import Base


class ChatMessageFeedback(Base):
    """One helpful/unhelpful rating per assistant message, set by the conversation owner."""

    __tablename__ = "chat_message_feedback"

    message_id = Column(String(36), ForeignKey("chat_messages.id", ondelete="CASCADE"), primary_key=True)
    conversation_id = Column(String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    rating = Column(String(8), nullable=False)
    created_at = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    updated_at = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    __table_args__ = (
        Index("idx_chat_feedback_updated", "updated_at"),
        Index("idx_chat_feedback_conversation", "conversation_id"),
    )
