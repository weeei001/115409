from sqlalchemy import Column, Date, DECIMAL, Index, String

from app.db.base import Base


class TechnicalIndicator(Base):
    __tablename__ = "fm_technical_indicators"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    close = Column(DECIMAL(10, 2), nullable=True)

    ma5 = Column(DECIMAL(10, 2), nullable=True)
    ma10 = Column(DECIMAL(10, 2), nullable=True)
    ma20 = Column(DECIMAL(10, 2), nullable=True)
    ma60 = Column(DECIMAL(10, 2), nullable=True)
    ma120 = Column(DECIMAL(10, 2), nullable=True)
    ma240 = Column(DECIMAL(10, 2), nullable=True)

    rsi5 = Column(DECIMAL(6, 2), nullable=True)
    rsi10 = Column(DECIMAL(6, 2), nullable=True)

    rsv9 = Column(DECIMAL(6, 2), nullable=True)
    kd_k9 = Column(DECIMAL(6, 2), nullable=True)
    kd_d9 = Column(DECIMAL(6, 2), nullable=True)
    kd_j9 = Column(DECIMAL(6, 2), nullable=True)

    ema12 = Column(DECIMAL(10, 4), nullable=True)
    ema26 = Column(DECIMAL(10, 4), nullable=True)
    macd_dif = Column(DECIMAL(10, 4), nullable=True)
    macd_dea = Column(DECIMAL(10, 4), nullable=True)

    macd_signal = Column(DECIMAL(10, 4), nullable=True)
    macd_hist = Column(DECIMAL(10, 4), nullable=True)

    boll_mid20 = Column(DECIMAL(10, 2), nullable=True)
    boll_upper20 = Column(DECIMAL(10, 2), nullable=True)
    boll_lower20 = Column(DECIMAL(10, 2), nullable=True)

    volume_ma5 = Column(DECIMAL(20, 2), nullable=True)

    __table_args__ = (
        Index("idx_ti_symbol_date", "symbol", "date"),
    )

    def __repr__(self) -> str:
        return f"<TechnicalIndicator(date={self.date}, symbol='{self.symbol}')>"
