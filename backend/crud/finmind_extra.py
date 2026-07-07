from __future__ import annotations

from datetime import date
from typing import Optional, Type

from sqlalchemy.orm import Session

from models.finmind_extra import (
    DividendResult,
    FinancialStatementRow,
    ForeignShareholding,
    HoldingShareLevel,
    MarginTrade,
    MonthlyRevenue,
    StockDividend,
    StockValuation,
)


def _symbol_range(db: Session, model: Type, symbol: str, start_date: date, end_date: date):
    return (
        db.query(model)
        .filter(model.symbol == symbol, model.date >= start_date, model.date <= end_date)
        .order_by(model.date)
        .all()
    )


def get_financial_statements(
    db: Session,
    symbol: str,
    statement: str,
    start_date: date,
    end_date: date,
    item_type: Optional[str] = None,
) -> list[FinancialStatementRow]:
    query = db.query(FinancialStatementRow).filter(
        FinancialStatementRow.symbol == symbol,
        FinancialStatementRow.statement == statement,
        FinancialStatementRow.date >= start_date,
        FinancialStatementRow.date <= end_date,
    )
    if item_type:
        query = query.filter(FinancialStatementRow.item_type == item_type)
    return query.order_by(FinancialStatementRow.date, FinancialStatementRow.item_type).all()


def get_monthly_revenues(db: Session, symbol: str, start_date: date, end_date: date) -> list[MonthlyRevenue]:
    return _symbol_range(db, MonthlyRevenue, symbol, start_date, end_date)


def get_valuations(db: Session, symbol: str, start_date: date, end_date: date) -> list[StockValuation]:
    return _symbol_range(db, StockValuation, symbol, start_date, end_date)


def get_dividends(db: Session, symbol: str, start_date: date, end_date: date) -> list[StockDividend]:
    return _symbol_range(db, StockDividend, symbol, start_date, end_date)


def get_dividend_results(db: Session, symbol: str, start_date: date, end_date: date) -> list[DividendResult]:
    return _symbol_range(db, DividendResult, symbol, start_date, end_date)


def get_margin_trades(db: Session, symbol: str, start_date: date, end_date: date) -> list[MarginTrade]:
    return _symbol_range(db, MarginTrade, symbol, start_date, end_date)


def get_foreign_shareholdings(
    db: Session, symbol: str, start_date: date, end_date: date
) -> list[ForeignShareholding]:
    return _symbol_range(db, ForeignShareholding, symbol, start_date, end_date)


def get_holding_share_levels(
    db: Session, symbol: str, start_date: date, end_date: date
) -> list[HoldingShareLevel]:
    return _symbol_range(db, HoldingShareLevel, symbol, start_date, end_date)
