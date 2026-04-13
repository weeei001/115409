from sqlalchemy import BIGINT, Column, Date, DateTime, Index, Integer, String, func
from sqlalchemy.dialects.mysql import BIGINT as MYSQL_BIGINT

from database import Base


class SimulatedOrder(Base):
    __tablename__ = "simulated_orders"

    id = Column(MYSQL_BIGINT(unsigned=True), primary_key=True, autoincrement=True, comment="內部主鍵")
    user_id = Column(String(128), nullable=False, comment="使用者識別（前端匿名 user id）")
    symbol = Column(String(12), nullable=False, comment="股票代號")
    side = Column(String(8), nullable=False, comment="買賣方向 buy|sell")
    trade_date = Column(Date, nullable=False, comment="模擬下單日期")
    quantity = Column(Integer, nullable=False, comment="委託數量（張）")
    sell_plan = Column(
        String(16),
        nullable=True,
        comment="賣出計畫 long_term|by_date；純賣出可為 NULL",
    )
    planned_sell_date = Column(Date, nullable=True, comment="預計賣出日（by_date 時有效）")
    status = Column(String(16), nullable=False, default="pending", comment="委託狀態")
    estimated_amount = Column(BIGINT, nullable=False, comment="預估成交金額（元）")
    created_at = Column(DateTime, nullable=False, server_default=func.now(), comment="建立時間")

    __table_args__ = (
        Index("idx_user_created", "user_id", "created_at"),
        Index("idx_user_trade_created", "user_id", "trade_date", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<SimulatedOrder(id={self.id}, symbol='{self.symbol}', side='{self.side}')>"
