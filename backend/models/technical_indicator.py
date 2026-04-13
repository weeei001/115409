from sqlalchemy import Column, Date, DECIMAL, Index, String

from database import Base


class TechnicalIndicator(Base):
    __tablename__ = "technical_indicators"

    date = Column(Date, primary_key=True, nullable=False, comment="日期")
    symbol = Column(String(10), primary_key=True, nullable=False, comment="股票代號")

    ma5 = Column(DECIMAL(10, 2), nullable=True, comment="5日均線")
    ma10 = Column(DECIMAL(10, 2), nullable=True, comment="10日均線")
    ma20 = Column(DECIMAL(10, 2), nullable=True, comment="20日均線")
    ma60 = Column(DECIMAL(10, 2), nullable=True, comment="60日均線")

    k_value = Column(DECIMAL(6, 2), nullable=True, comment="KD指標 K值")
    d_value = Column(DECIMAL(6, 2), nullable=True, comment="KD指標 D值")
    rsi14 = Column(DECIMAL(6, 2), nullable=True, comment="14日RSI")

    macd = Column(DECIMAL(10, 4), nullable=True, comment="MACD線")
    macd_signal = Column(DECIMAL(10, 4), nullable=True, comment="MACD訊號線")
    macd_hist = Column(DECIMAL(10, 4), nullable=True, comment="MACD柱狀圖")

    bb_upper = Column(DECIMAL(10, 2), nullable=True, comment="布林通道上軌")
    bb_middle = Column(DECIMAL(10, 2), nullable=True, comment="布林通道中軌")
    bb_lower = Column(DECIMAL(10, 2), nullable=True, comment="布林通道下軌")

    volume_ma5 = Column(DECIMAL(20, 2), nullable=True, comment="5日均量")

    __table_args__ = (
        Index("idx_ti_symbol_date", "symbol", "date"),
    )

    def __repr__(self) -> str:
        return f"<TechnicalIndicator(date={self.date}, symbol='{self.symbol}')>"
