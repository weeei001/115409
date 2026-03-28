from sqlalchemy import BigInteger, Column, Date, DateTime, Index, String, func

from database import Base


class InstitutionalTrade(Base):
    __tablename__ = "institutional_trades"

    date = Column(Date, primary_key=True, nullable=False, comment="交易日期")
    symbol = Column(String(10), primary_key=True, nullable=False, comment="證券代號")
    stock_name = Column(String(100), nullable=True, comment="證券名稱")

    foreign_excl_dealer_buy = Column(BigInteger, nullable=True, comment="外陸資買進股數(不含外資自營商)")
    foreign_excl_dealer_sell = Column(BigInteger, nullable=True, comment="外陸資賣出股數(不含外資自營商)")
    foreign_excl_dealer_net = Column(BigInteger, nullable=True, comment="外陸資買賣超股數(不含外資自營商)")
    foreign_dealer_buy = Column(BigInteger, nullable=True, comment="外資自營商買進股數")
    foreign_dealer_sell = Column(BigInteger, nullable=True, comment="外資自營商賣出股數")
    foreign_dealer_net = Column(BigInteger, nullable=True, comment="外資自營商買賣超股數")

    investment_trust_buy = Column(BigInteger, nullable=True, comment="投信買進股數")
    investment_trust_sell = Column(BigInteger, nullable=True, comment="投信賣出股數")
    investment_trust_net = Column(BigInteger, nullable=True, comment="投信買賣超股數")

    dealer_net_total = Column(BigInteger, nullable=True, comment="自營商買賣超股數")
    dealer_self_buy = Column(BigInteger, nullable=True, comment="自營商買進股數(自行買賣)")
    dealer_self_sell = Column(BigInteger, nullable=True, comment="自營商賣出股數(自行買賣)")
    dealer_self_net = Column(BigInteger, nullable=True, comment="自營商買賣超股數(自行買賣)")
    dealer_hedge_buy = Column(BigInteger, nullable=True, comment="自營商買進股數(避險)")
    dealer_hedge_sell = Column(BigInteger, nullable=True, comment="自營商賣出股數(避險)")
    dealer_hedge_net = Column(BigInteger, nullable=True, comment="自營商買賣超股數(避險)")

    total_net = Column(BigInteger, nullable=True, comment="三大法人買賣超股數")

    created_at = Column(DateTime, nullable=False, server_default=func.now(), comment="建立時間")
    updated_at = Column(
        DateTime, nullable=False, server_default=func.now(), onupdate=func.now(), comment="更新時間"
    )

    __table_args__ = (
        Index("idx_it_date_symbol", "date", "symbol"),
        Index("idx_it_date", "date"),
        Index("idx_it_symbol", "symbol"),
    )

    def __repr__(self) -> str:
        return f"<InstitutionalTrade(date={self.date}, symbol='{self.symbol}')>"
