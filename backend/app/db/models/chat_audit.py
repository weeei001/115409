from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text
from sqlalchemy.dialects.mysql import DATETIME

from app.db.base import Base


class ChatValidationRun(Base):
    """Private diagnostics; never used as user-visible conversation history."""

    __tablename__ = "chat_validation_runs"

    id = Column(String(36), primary_key=True)
    created_at = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True)
    conversation_id = Column(String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=True)
    turn_id = Column(String(36), nullable=True)
    outcome = Column(String(16), nullable=False)
    query = Column(Text, nullable=False, default="")
    reason = Column(String(64), nullable=True)
    data = Column(JSON, nullable=False, default=dict)
    __table_args__ = (
        Index("idx_chat_validation_created", "created_at", "id"),
        Index("idx_chat_validation_outcome", "outcome", "created_at"),
        Index("idx_chat_validation_conversation", "conversation_id", "turn_id"),
    )
