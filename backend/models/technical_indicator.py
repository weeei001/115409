from sqlalchemy import Column, Date, DECIMAL, Index, String

from database import Base


class TechnicalIndicator(Base):
    __tablename__ = "fm_technical_indicators"

    date = Column(Date, primary_key=True, nullable=False, comment="日期")
    symbol = Column(String(10), primary_key=True, nullable=False, comment="股票代號")
    close = Column(DECIMAL(10, 2), nullable=True, comment="收盤價")

    ma5 = Column(DECIMAL(10, 2), nullable=True, comment="5日均線")
    ma10 = Column(DECIMAL(10, 2), nullable=True, comment="10日均線")
    ma20 = Column(DECIMAL(10, 2), nullable=True, comment="20日均線")
    ma60 = Column(DECIMAL(10, 2), nullable=True, comment="60日均線")
    ma120 = Column(DECIMAL(10, 2), nullable=True, comment="120日均線")
    ma240 = Column(DECIMAL(10, 2), nullable=True, comment="240日均線")

    rsi5 = Column(DECIMAL(6, 2), nullable=True, comment="5日RSI")
    rsi10 = Column(DECIMAL(6, 2), nullable=True, comment="10日RSI")

    rsv9 = Column(DECIMAL(6, 2), nullable=True, comment="9日RSV")
    kd_k9 = Column(DECIMAL(6, 2), nullable=True, comment="KD指標 K值")
    kd_d9 = Column(DECIMAL(6, 2), nullable=True, comment="KD指標 D值")
    kd_j9 = Column(DECIMAL(6, 2), nullable=True, comment="KD指標 J值")

    ema12 = Column(DECIMAL(10, 4), nullable=True, comment="12日EMA")
    ema26 = Column(DECIMAL(10, 4), nullable=True, comment="26日EMA")
    macd_dif = Column(DECIMAL(10, 4), nullable=True, comment="MACD DIF")
    macd_dea = Column(DECIMAL(10, 4), nullable=True, comment="MACD DEA")

    macd_signal = Column(DECIMAL(10, 4), nullable=True, comment="MACD訊號線")
    macd_hist = Column(DECIMAL(10, 4), nullable=True, comment="MACD柱狀圖")

    boll_mid20 = Column(DECIMAL(10, 2), nullable=True, comment="20日布林中軌")
    boll_upper20 = Column(DECIMAL(10, 2), nullable=True, comment="20日布林上軌")
    boll_lower20 = Column(DECIMAL(10, 2), nullable=True, comment="20日布林下軌")

    volume_ma5 = Column(DECIMAL(20, 2), nullable=True, comment="5日均量")

    __table_args__ = (
        Index("idx_ti_symbol_date", "symbol", "date"),
    )

    def __repr__(self) -> str:
        return f"<TechnicalIndicator(date={self.date}, symbol='{self.symbol}')>"
