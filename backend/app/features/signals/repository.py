"""Read the market tables the signals use, one query per table for every requested stock."""
from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.market_extra import MonthlyRevenue
from app.db.models.technical_indicator import TechnicalIndicator
from app.db.models.stock_info import StockInfo


def catalog_symbols(db: Session) -> list[str]:
    return list(db.scalars(select(StockInfo.symbol).order_by(StockInfo.symbol)))


def _by_symbol(rows) -> dict[str, list[Any]]:
    grouped: dict[str, list[Any]] = {}
    for row in rows:
        grouped.setdefault(row.symbol, []).append(row)
    return grouped


def market_rows(db: Session, symbols: list[str], since: date, revenue_since: date) -> dict[str, dict[str, list[Any]]]:
    """Prices, indicators and institutional flows from ``since`` to the latest row, grouped by stock.

    Revenue starts at ``revenue_since`` so the first months in range still have a year-ago month.
    """
    def load(*columns, model):
        first = revenue_since if model is MonthlyRevenue else since
        return _by_symbol(db.execute(select(*columns).where(
            model.symbol.in_(symbols), model.date >= first).order_by(model.symbol, model.date)))
    prices = load(DailyPrice.symbol, DailyPrice.date, DailyPrice.close, DailyPrice.volume_shares, model=DailyPrice)
    indicators = load(TechnicalIndicator.symbol, TechnicalIndicator.date, TechnicalIndicator.ma20,
                      TechnicalIndicator.ma60, TechnicalIndicator.kd_k9, TechnicalIndicator.kd_d9,
                      TechnicalIndicator.macd_hist, TechnicalIndicator.volume_ma5, model=TechnicalIndicator)
    flows = load(InstitutionalTrade.symbol, InstitutionalTrade.date, InstitutionalTrade.foreign_net,
                 InstitutionalTrade.investment_trust_net, model=InstitutionalTrade)
    revenue = load(MonthlyRevenue.symbol, MonthlyRevenue.date, MonthlyRevenue.revenue, MonthlyRevenue.revenue_year,
                   MonthlyRevenue.revenue_month, MonthlyRevenue.create_time, model=MonthlyRevenue)
    return {symbol: {"prices": prices.get(symbol, []), "indicators": indicators.get(symbol, []),
                     "flows": flows.get(symbol, []), "revenue": revenue.get(symbol, [])} for symbol in symbols}
