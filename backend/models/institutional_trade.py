from sqlalchemy import BigInteger, Column, Date, Index, String

from database import Base


class InstitutionalTrade(Base):
    __tablename__ = "institutional_trades"

    date = Column(Date, primary_key=True, nullable=False, comment="交易日期")
    symbol = Column(String(10), primary_key=True, nullable=False, comment="證券代號")
    foreign_buy = Column(BigInteger, nullable=True, comment="外資買進股數")
    foreign_sell = Column(BigInteger, nullable=True, comment="外資賣出股數")
    foreign_net = Column(BigInteger, nullable=True, comment="外資買賣超股數")
    investment_trust_buy = Column(BigInteger, nullable=True, comment="投信買進股數")
    investment_trust_sell = Column(BigInteger, nullable=True, comment="投信賣出股數")
    investment_trust_net = Column(BigInteger, nullable=True, comment="投信買賣超股數")
    dealer_buy = Column(BigInteger, nullable=True, comment="自營商買進股數")
    dealer_sell = Column(BigInteger, nullable=True, comment="自營商賣出股數")
    dealer_net = Column(BigInteger, nullable=True, comment="自營商買賣超股數")
    total_institutional_buy = Column(BigInteger, nullable=True, comment="三大法人買進股數")
    total_institutional_sell = Column(BigInteger, nullable=True, comment="三大法人賣出股數")
    total_institutional_net = Column(BigInteger, nullable=True, comment="三大法人買賣超股數")

    

    __table_args__ = (
        Index("idx_it_symbol_date", "symbol", "date"),
    )

    def __repr__(self) -> str:
        return f"<InstitutionalTrade(date={self.date}, symbol='{self.symbol}')>"
