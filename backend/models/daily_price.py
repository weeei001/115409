from sqlalchemy import Column, String, Date, DECIMAL, BigInteger, Integer, Index
from database import Base


class DailyPrice(Base):
    __tablename__ = "fm_daily_prices"

    date = Column(Date, primary_key=True, nullable=False, comment='日期')
    symbol = Column(String(10), primary_key=True, nullable=False, comment='股票代號')
    open = Column(DECIMAL(10, 2), comment='開盤價')
    high = Column(DECIMAL(10, 2), comment='最高價')
    low = Column(DECIMAL(10, 2), comment='最低價')
    close = Column(DECIMAL(10, 2), comment='收盤價')
    volume_shares = Column(BigInteger, comment='成交股數')
    amount = Column(BigInteger, comment='成交金額')
    change = Column(DECIMAL(10, 2), comment='漲跌價差')
    trades = Column(Integer, comment='成交筆數')

    __table_args__ = (
        Index('idx_dp_symbol_date', 'symbol', 'date'),
    )

    def __repr__(self):
        return f"<DailyPrice(date={self.date}, symbol='{self.symbol}', close={self.close})>"
