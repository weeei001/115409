from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice


def open_prices(db: Session, symbol: str, since: date) -> dict[date, float]:
    """Opening prices, the fill price for decisions made at the previous close."""
    return {row.date: float(row.open) for row in db.execute(
        select(DailyPrice.date, DailyPrice.open).where(
            DailyPrice.symbol == symbol, DailyPrice.date >= since, DailyPrice.open.is_not(None), DailyPrice.open > 0))}
