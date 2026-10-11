from sqlalchemy import Column, Date, DECIMAL, String

from app.db.base import Base

# The only benchmark stored: the TWSE capitalization-weighted price index, excluding dividends.
TAIEX = "TAIEX"


class BenchmarkPrice(Base):
    __tablename__ = "market_benchmark_prices"

    symbol = Column(String(10), primary_key=True, nullable=False)
    date = Column(Date, primary_key=True, nullable=False)
    close = Column(DECIMAL(12, 2), nullable=False)
