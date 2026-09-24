from sqlalchemy import BigInteger, Column, Date, Index, String

from app.db.base import Base


class InstitutionalTrade(Base):
    __tablename__ = "market_institutional_trades"

    date = Column(Date, primary_key=True, nullable=False)
    symbol = Column(String(10), primary_key=True, nullable=False)
    foreign_buy = Column(BigInteger, nullable=True)
    foreign_sell = Column(BigInteger, nullable=True)
    foreign_net = Column(BigInteger, nullable=True)
    investment_trust_buy = Column(BigInteger, nullable=True)
    investment_trust_sell = Column(BigInteger, nullable=True)
    investment_trust_net = Column(BigInteger, nullable=True)
    dealer_buy = Column(BigInteger, nullable=True)
    dealer_sell = Column(BigInteger, nullable=True)
    dealer_net = Column(BigInteger, nullable=True)
    total_institutional_buy = Column(BigInteger, nullable=True)
    total_institutional_sell = Column(BigInteger, nullable=True)
    total_institutional_net = Column(BigInteger, nullable=True)

    

    __table_args__ = (
        Index("idx_it_symbol_date", "symbol", "date"),
    )

    def __repr__(self) -> str:
        return f"<InstitutionalTrade(date={self.date}, symbol='{self.symbol}')>"
