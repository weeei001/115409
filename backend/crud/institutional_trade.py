from __future__ import annotations

from datetime import date
from typing import List, Optional

from sqlalchemy import and_, desc
from sqlalchemy.orm import Session

from models.institutional_trade import InstitutionalTrade


def get_by_symbol_range(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date,
) -> List[InstitutionalTrade]:
    return (
        db.query(InstitutionalTrade)
        .filter(
            and_(
                InstitutionalTrade.symbol == symbol,
                InstitutionalTrade.date >= start_date,
                InstitutionalTrade.date <= end_date,
            )
        )
        .order_by(InstitutionalTrade.date)
        .all()
    )


def get_latest(db: Session, symbol: str) -> Optional[InstitutionalTrade]:
    return (
        db.query(InstitutionalTrade)
        .filter(InstitutionalTrade.symbol == symbol)
        .order_by(desc(InstitutionalTrade.date))
        .first()
    )
