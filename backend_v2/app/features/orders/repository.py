from bisect import bisect_right
from collections import defaultdict
from datetime import date

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session, aliased

from app.db.models.daily_price import DailyPrice
from app.db.models.simulated_order import SimulatedOrder


def orders(db: Session, user_id: str, symbol: str | None = None, *, lock: bool = False):
    query = select(SimulatedOrder).where(SimulatedOrder.user_id == user_id)
    if symbol is not None:
        query = query.where(SimulatedOrder.symbol == symbol)
    query = query.order_by(SimulatedOrder.created_at.desc())
    if lock:
        query = query.with_for_update()
    return list(db.scalars(query))


def trade_price(db: Session, symbol: str, trade_date: date):
    return db.get(DailyPrice, {"symbol": symbol, "date": trade_date})


def valuation_prices(db: Session, records: list[SimulatedOrder], *, non_null_latest: bool = False):
    if not records:
        return {}, {}
    symbols = {order.symbol for order in records}
    latest_dates = select(DailyPrice.symbol, func.max(DailyPrice.date).label("date")).where(
        DailyPrice.symbol.in_(symbols),
    )
    if non_null_latest:
        latest_dates = latest_dates.where(DailyPrice.close.is_not(None))
    latest_dates = latest_dates.group_by(DailyPrice.symbol).subquery()
    latest = {row.symbol: row for row in db.scalars(select(DailyPrice).join(
        latest_dates, and_(DailyPrice.symbol == latest_dates.c.symbol, DailyPrice.date == latest_dates.c.date),
    ))}

    targets = {(order.symbol, order.planned_sell_date) for order in records
               if order.side == "buy" and order.sell_plan == "by_date"
               and order.planned_sell_date is not None and order.planned_sell_date <= date.today()}
    if not targets:
        return latest, {}
    other = aliased(DailyPrice)
    predicates = [and_(
        DailyPrice.symbol == symbol,
        DailyPrice.date == select(func.max(other.date)).where(
            other.symbol == symbol, other.date <= target,
        ).scalar_subquery(),
    ) for symbol, target in targets]
    by_symbol = defaultdict(dict)
    # Chunk the predicate list to keep SQLite's expression-depth limit bounded.
    for offset in range(0, len(predicates), 250):
        for row in db.scalars(select(DailyPrice).where(or_(*predicates[offset:offset + 250]))):
            by_symbol[row.symbol][row.date] = row
    dates = {symbol: sorted(rows) for symbol, rows in by_symbol.items()}
    planned = {}
    for symbol, target in targets:
        index = bisect_right(dates.get(symbol, []), target)
        planned[symbol, target] = by_symbol[symbol][dates[symbol][index - 1]] if index else None
    return latest, planned
