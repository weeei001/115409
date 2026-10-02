from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.dialects.mysql import DATETIME, LONGTEXT

from app.db.base import Base


class Conversation(Base):
    __tablename__ = "chat_conversations"

    id = Column(String(36), primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(80), nullable=False, default="")
    updated_at = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    active_turn = Column(String(36), nullable=True)
    lease_until = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=True)
    __table_args__ = (Index("idx_chat_owner_updated", "user_id", "updated_at"),)


class ConversationMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(36), primary_key=True)
    conversation_id = Column(String(36), ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False)
    turn_id = Column(String(36), nullable=False)
    position = Column(Integer, nullable=False)
    role = Column(String(12), nullable=False)
    content = Column(Text().with_variant(LONGTEXT, "mysql"), nullable=False, default="")
    timestamp = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    status = Column(String(16), nullable=True)
    extra = Column(JSON, nullable=False, default=dict)
    __table_args__ = (
        UniqueConstraint("conversation_id", "position", name="uq_chat_message_position"),
        Index("idx_chat_message_turn", "conversation_id", "turn_id"),
    )
