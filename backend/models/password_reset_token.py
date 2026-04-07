from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, func

from database import Base


class PasswordResetToken(Base):
    """一次性密碼重設 token（存 hash，不存明文）。"""

    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_hash = Column(String(64), nullable=False, unique=True, index=True, comment="SHA256 hex")
    expires_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
