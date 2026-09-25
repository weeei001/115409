from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models.benchmark_price import BenchmarkPrice


SOURCE_URL = "https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html"


class BenchmarkDay(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    date: date
    close: float


class BenchmarkHistory(BaseModel):
    id: Literal["TAIEX"] = "TAIEX"
    name: str = "臺灣加權股價指數"
    basis: Literal["price_index_excluding_dividends"] = "price_index_excluding_dividends"
    source: Literal["TWSE"] = "TWSE"
    source_url: str = SOURCE_URL
    start_date: date
    end_date: date
    total: int
    data: list[BenchmarkDay]


def history(db: Session, start_date: date, end_date: date):
    if start_date > end_date:
        raise AppError("start_date must be on or before end_date", status_code=400)
    rows = list(db.scalars(select(BenchmarkPrice).where(
        BenchmarkPrice.symbol == "TAIEX", BenchmarkPrice.date >= start_date,
        BenchmarkPrice.date <= end_date, BenchmarkPrice.close > 0,
    ).order_by(BenchmarkPrice.date)))
    return BenchmarkHistory(start_date=start_date, end_date=end_date, total=len(rows), data=rows)
