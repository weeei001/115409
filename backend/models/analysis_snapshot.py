from sqlalchemy import (
    BigInteger,
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
from sqlalchemy.dialects.mysql import MEDIUMTEXT

from database import Base


_ID_TYPE = BigInteger().with_variant(Integer, "sqlite")
_MEDIUM_TEXT = Text().with_variant(MEDIUMTEXT(), "mysql")


class StockBehaviorBacktestRun(Base):
    __tablename__ = "sb_backtest_runs"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)
    status = Column(String(16), nullable=False, default="running")
    config_hash = Column(String(64), nullable=False)
    config_json = Column(Text, nullable=False)
    symbols = Column(String(128), nullable=False)
    date_start = Column(Date, nullable=False)
    date_end = Column(Date, nullable=False)
    freq = Column(String(8), nullable=False)
    repeats = Column(Integer, nullable=False, default=1)
    planned_points = Column(Integer, nullable=False, default=0)
    completed_points = Column(Integer, nullable=False, default=0)
    skipped_points = Column(Integer, nullable=False, default=0)
    failed_points = Column(Integer, nullable=False, default=0)
    note = Column(String(255), nullable=True)

    __table_args__ = (Index("idx_sbbr_config", "config_hash"),)


class StockBehaviorAnalysisSnapshot(Base):
    __tablename__ = "sb_analysis_snapshots"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    symbol = Column(String(10), nullable=False)
    as_of_date = Column(Date, nullable=False)
    run_kind = Column(String(16), nullable=False, default="live")
    config_hash = Column(String(64), nullable=False)
    config_json = Column(Text, nullable=False)
    model_name = Column(String(128), nullable=True)
    prompt_version = Column(String(32), nullable=True)
    is_fallback = Column(Boolean, nullable=False, default=False)
    rag_fallback_mode = Column(Boolean, nullable=False, default=False)
    news_count = Column(Integer, nullable=False, default=0)
    base_close = Column(DECIMAL(12, 4), nullable=True)
    base_volume = Column(DECIMAL(20, 2), nullable=True)
    summary = Column(Text, nullable=True)
    news_sources_json = Column(_MEDIUM_TEXT, nullable=True)
    data_inventory_json = Column(_MEDIUM_TEXT, nullable=True)
    normalized_payload_json = Column(_MEDIUM_TEXT, nullable=True)
    public_projection_json = Column(_MEDIUM_TEXT, nullable=True)
    task_packet_json = Column(_MEDIUM_TEXT, nullable=True)
    raw_llm_text = Column(_MEDIUM_TEXT, nullable=True)
    latency_ms = Column(Integer, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_sbas_symbol_asof", "symbol", "as_of_date"),
        Index("idx_sbas_config", "config_hash"),
    )


class StockBehaviorProjectionScore(Base):
    __tablename__ = "sb_projection_scores"

    id = Column(_ID_TYPE, primary_key=True, autoincrement=True)
    snapshot_id = Column(
        _ID_TYPE,
        ForeignKey("sb_analysis_snapshots.id"),
        nullable=False,
    )
    day = Column(Integer, nullable=False)
    target_date = Column(Date, nullable=False)
    predicted_close = Column(DECIMAL(12, 4), nullable=True)
    predicted_direction = Column(String(12), nullable=True)
    base_close = Column(DECIMAL(12, 4), nullable=True)
    actual_close = Column(DECIMAL(12, 4), nullable=True)
    adjusted_return = Column(DECIMAL(12, 6), nullable=True)
    direction_actual = Column(String(12), nullable=True)
    direction_hit = Column(Boolean, nullable=True)
    abs_pct_error = Column(DECIMAL(12, 6), nullable=True)
    ex_dividend_between = Column(Boolean, nullable=False, default=False)
    deadband = Column(DECIMAL(6, 4), nullable=True)
    scored_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("snapshot_id", "day", name="uq_sbps_snapshot_day"),
        Index("idx_sbps_snapshot", "snapshot_id"),
    )
