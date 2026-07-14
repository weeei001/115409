from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    DECIMAL,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)

from database import Base
from models.analysis_snapshot import _ID_TYPE, _MEDIUM_TEXT


class TrendPredictionSnapshot(Base):
    __tablename__ = "tp_prediction_snapshots"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    run_kind = Column(String(16), nullable=False, default="backtest")
    strategy_name = Column(String(64), nullable=False)
    config_hash = Column(String(64), nullable=False)
    config_json = Column(Text, nullable=False)
    model_name = Column(String(128), nullable=True)
    horizon_days = Column(Integer, nullable=False, default=20)
    direction = Column(String(8), nullable=False)
    change_pct_total = Column(DECIMAL(8, 3), nullable=False)
    confidence = Column(Integer, nullable=False)
    summary = Column(Text, nullable=True)
    news_count = Column(Integer, nullable=False, default=0)
    last_price = Column(DECIMAL(12, 4), nullable=True)
    slope = Column(DECIMAL(12, 6), nullable=True)
    prompt_used = Column(_MEDIUM_TEXT, nullable=True)
    is_fallback = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_tpps_symbol_asof", "symbol", "as_of_date"),
        Index("idx_tpps_config", "config_hash"),
    )


class TrendPredictionScore(Base):
    __tablename__ = "tp_prediction_scores"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    snapshot_id = Column(
        _ID_TYPE,
        ForeignKey("tp_prediction_snapshots.id"),
        nullable=False,
    )
    horizon_days = Column(Integer, nullable=False)
    target_date = Column(Date, nullable=False)
    base_close = Column(DECIMAL(12, 4), nullable=False)
    actual_close = Column(DECIMAL(12, 4), nullable=False)
    adjusted_return = Column(DECIMAL(12, 6), nullable=False)
    direction_actual = Column(String(8), nullable=False)
    direction_hit = Column(Boolean, nullable=False)
    abs_change_pct_error = Column(DECIMAL(8, 3), nullable=False)
    scored_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint(
            "snapshot_id",
            "horizon_days",
            name="uq_tps_snapshot_horizon",
        ),
        Index("idx_tps_snapshot", "snapshot_id"),
    )
