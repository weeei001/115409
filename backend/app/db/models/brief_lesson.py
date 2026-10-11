from sqlalchemy import BigInteger, Column, Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint, func

from app.db.base import Base


_ID_TYPE = BigInteger().with_variant(Integer, "sqlite")

BRIEF_LESSON_READY = "ready"
BRIEF_LESSON_REJECTED = "rejected"


class BriefLesson(Base):
    """A settled text-brief call and the short review written once its outcome was known."""

    __tablename__ = "ai_brief_lessons"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    horizon = Column(String(16), nullable=False)
    snapshot_id = Column(_ID_TYPE, nullable=False)
    stance = Column(String(16), nullable=False)
    return_pct = Column(Float, nullable=False)
    benchmark_return_pct = Column(Float, nullable=True)
    result = Column(String(8), nullable=False)
    # The last close the outcome used: the point-in-time cutoff for showing the review to a later brief.
    resolved_on = Column(Date, nullable=False)
    lesson = Column(Text, nullable=False)
    status = Column(String(12), nullable=False)
    model_name = Column(String(128), nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("symbol", "as_of_date", "horizon", name="uq_brief_lesson_call"),
        Index("idx_brief_lesson_lookup", "symbol", "status", "resolved_on"),
    )
