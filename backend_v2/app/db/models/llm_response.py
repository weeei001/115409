from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    Date,
    DateTime,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from app.db.base import Base


_ID_TYPE = BigInteger().with_variant(Integer, "sqlite")
_MEDIUM_TEXT = Text().with_variant(MEDIUMTEXT(), "mysql")

LLM_RESPONSE_KIND_TEXT_BRIEF = "text_brief"


class LlmResponse(Base):

    __tablename__ = "llm_responses"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    kind = Column(String(24), nullable=False)
    config_hash = Column(String(64), nullable=False)
    config_json = Column(Text, nullable=False)
    model_name = Column(String(128), nullable=True)
    is_fallback = Column(Boolean, nullable=False, default=False)
    news_count = Column(Integer, nullable=False, default=0)
    summary = Column(Text, nullable=True)
    raw_llm_text = Column(_MEDIUM_TEXT, nullable=True)
    normalized_json = Column(_MEDIUM_TEXT, nullable=True)
    response_json = Column(_MEDIUM_TEXT, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_llmr_lookup", "symbol", "as_of_date", "kind", "config_hash"),
        Index("idx_llmr_created", "created_at"),
    )
