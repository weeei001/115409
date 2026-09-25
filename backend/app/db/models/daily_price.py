from sqlalchemy import Column, String, Date, DECIMAL, BigInteger, Integer, Index
from app.db.base import Base


class DailyPrice(Base):
    __tablename__ = "market_daily_prices"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    open = Column(DECIMAL(10, 2))
    high = Column(DECIMAL(10, 2))
    low = Column(DECIMAL(10, 2))
    close = Column(DECIMAL(10, 2))
    volume_shares = Column(BigInteger)
    amount = Column(BigInteger)
    change = Column(DECIMAL(10, 2))
    trades = Column(Integer)

    __table_args__ = (
        Index('idx_dp_symbol_date', 'symbol', 'date'),
    )

    def __repr__(self):
        return f"<DailyPrice(date={self.date}, symbol='{self.symbol}', close={self.close})>"
