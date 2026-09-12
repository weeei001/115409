from sqlalchemy import BIGINT, Column, Date, DateTime, Index, Integer, String, func
from sqlalchemy.dialects.mysql import BIGINT as MYSQL_BIGINT

from app.db.base import Base


class SimulatedOrder(Base):
    __tablename__ = "simulated_orders"

    id = Column(MYSQL_BIGINT(unsigned=True).with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    user_id = Column(String(128), nullable=False)
    symbol = Column(String(12), nullable=False)
    side = Column(String(8), nullable=False)
    trade_date = Column(Date, nullable=False)
    quantity = Column(Integer, nullable=False)
    sell_plan = Column(
        String(16),
        nullable=True,
    )
    planned_sell_date = Column(Date, nullable=True)
    status = Column(String(16), nullable=False, default="pending")
    estimated_amount = Column(BIGINT, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    __table_args__ = (
        Index("idx_user_created", "user_id", "created_at"),
        Index("idx_user_trade_created", "user_id", "trade_date", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<SimulatedOrder(id={self.id}, symbol='{self.symbol}', side='{self.side}')>"
