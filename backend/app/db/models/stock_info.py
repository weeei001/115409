from sqlalchemy import Column, String

from app.db.base import Base


class StockInfo(Base):
    __tablename__ = "stock_info"

    symbol = Column(String(10), primary_key=True, nullable=False)
    name = Column(String(64), nullable=False)
    industry = Column(String(64), nullable=True)
