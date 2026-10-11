from sqlalchemy import BigInteger, Column, DateTime, Index, String
from sqlalchemy.dialects.mysql import DATETIME

from app.db.base import Base


class AiUsageLog(Base):
    """Provider-reported usage for one application-level model invocation."""

    __tablename__ = "ai_usage_logs"

    id = Column(String(36), primary_key=True)
    feature = Column(String(32), nullable=False)
    request_id = Column(String(36), nullable=False)
    model = Column(String(255), nullable=False)
    input_tokens = Column(BigInteger, nullable=True)
    output_tokens = Column(BigInteger, nullable=True)
    status = Column(String(16), nullable=False)
    created_at = Column(DateTime().with_variant(DATETIME(fsp=6), "mysql"), nullable=False)
    __table_args__ = (
        Index("idx_ai_usage_feature_created", "feature", "created_at"),
        Index("idx_ai_usage_request", "request_id"),
    )
