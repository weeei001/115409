from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.finmind_extra import FinancialStatementRow
from app.db.models.stock_info import StockInfo


def stock_names(db: Session) -> dict[str, str]:
    return dict(db.execute(select(StockInfo.symbol, StockInfo.name).order_by(StockInfo.symbol)).all())


def symbol_range(db: Session, model, symbol: str, start_date: date, end_date: date):
    return list(db.scalars(select(model).where(
        model.symbol == symbol, model.date >= start_date, model.date <= end_date,
    ).order_by(model.date)))


def symbols(db: Session):
    return list(db.scalars(select(DailyPrice.symbol).distinct().order_by(DailyPrice.symbol)))

def stock_infos(db: Session):
    rows = db.execute(
        select(StockInfo.symbol, StockInfo.name, StockInfo.industry)
        .join(DailyPrice, DailyPrice.symbol == StockInfo.symbol)
        .distinct()
        .order_by(StockInfo.symbol)
    )
    return [dict(row) for row in rows.mappings()]


def latest(db: Session, symbol: str):
    return db.scalar(select(DailyPrice).where(DailyPrice.symbol == symbol)
                     .order_by(DailyPrice.date.desc()).limit(1))


def date_range(db: Session, symbol: str):
    return db.execute(select(func.min(DailyPrice.date), func.max(DailyPrice.date))
                      .where(DailyPrice.symbol == symbol)).one()


def history(db: Session, symbol: str, start_date, end_date, skip: int, limit: int):
    filters = [DailyPrice.symbol == symbol]
    if start_date is not None:
        filters.append(DailyPrice.date >= start_date)
    if end_date is not None:
        filters.append(DailyPrice.date <= end_date)
    count = db.scalar(select(func.count()).select_from(DailyPrice).where(*filters))
    rows = list(db.scalars(select(DailyPrice).where(*filters)
                          .order_by(DailyPrice.date.desc()).offset(skip).limit(limit)))
    return count, rows


def statistics(db: Session, symbol: str, start_date: date, end_date: date):
    return dict(db.execute(select(
        func.max(DailyPrice.high).label("highest_price"),
        func.min(DailyPrice.low).label("lowest_price"),
        func.avg(DailyPrice.close).label("average_close"),
        func.sum(DailyPrice.volume_shares).label("total_volume"),
        func.sum(DailyPrice.amount).label("total_amount"),
        func.count(DailyPrice.date).label("trading_days"),
    ).where(DailyPrice.symbol == symbol, DailyPrice.date >= start_date,
            DailyPrice.date <= end_date)).mappings().one())


def compare(db: Session, symbols: list[str], start_date: date, end_date: date):
    return list(db.scalars(select(DailyPrice).where(
        DailyPrice.symbol.in_(symbols), DailyPrice.date >= start_date,
        DailyPrice.date <= end_date,
    ).order_by(DailyPrice.date, DailyPrice.symbol)))


def financial_statements(db: Session, symbol: str, statement: str,
                         start_date: date, end_date: date, item_type: str | None):
    query = select(FinancialStatementRow).where(
        FinancialStatementRow.symbol == symbol, FinancialStatementRow.statement == statement,
        FinancialStatementRow.date >= start_date, FinancialStatementRow.date <= end_date,
    )
    if item_type:
        query = query.where(FinancialStatementRow.item_type == item_type)
    return list(db.scalars(query.order_by(FinancialStatementRow.date, FinancialStatementRow.item_type)))
