from sqlalchemy.orm import Session
from sqlalchemy import func, and_, desc
from models.daily_price import DailyPrice
from typing import Optional, List, Tuple
from datetime import date, datetime
from decimal import Decimal


def get_daily_price(db: Session, symbol: str, date: date) -> Optional[DailyPrice]:
    """获取指定股票在指定日期的价格数据"""
    return db.query(DailyPrice).filter(
        DailyPrice.symbol == symbol,
        DailyPrice.date == date
    ).first()


def get_price_by_symbol(
    db: Session,
    symbol: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    skip: int = 0,
    limit: int = 100
) -> List[DailyPrice]:
    """获取指定股票的历史价格数据"""
    query = db.query(DailyPrice).filter(DailyPrice.symbol == symbol)
    
    if start_date:
        query = query.filter(DailyPrice.date >= start_date)
    if end_date:
        query = query.filter(DailyPrice.date <= end_date)
    
    return query.order_by(desc(DailyPrice.date)).offset(skip).limit(limit).all()


def get_price_count(
    db: Session,
    symbol: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None
) -> int:
    """获取指定条件的记录数量"""
    query = db.query(DailyPrice).filter(DailyPrice.symbol == symbol)
    
    if start_date:
        query = query.filter(DailyPrice.date >= start_date)
    if end_date:
        query = query.filter(DailyPrice.date <= end_date)
    
    return query.count()


def get_latest_price(db: Session, symbol: str) -> Optional[DailyPrice]:
    """获取指定股票的最新价格"""
    return db.query(DailyPrice).filter(
        DailyPrice.symbol == symbol
    ).order_by(desc(DailyPrice.date)).first()


def get_price_range(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date
) -> List[DailyPrice]:
    """获取指定日期范围的价格数据（用于K线图）"""
    return db.query(DailyPrice).filter(
        and_(
            DailyPrice.symbol == symbol,
            DailyPrice.date >= start_date,
            DailyPrice.date <= end_date
        )
    ).order_by(DailyPrice.date).all()


def get_price_statistics(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date
) -> dict:
    """获取指定时间范围的统计数据"""
    stats = db.query(
        func.max(DailyPrice.high).label('highest_price'),
        func.min(DailyPrice.low).label('lowest_price'),
        func.avg(DailyPrice.close).label('average_close'),
        func.sum(DailyPrice.volume_shares).label('total_volume'),
        func.sum(DailyPrice.amount).label('total_amount'),
        func.count(DailyPrice.date).label('trading_days')
    ).filter(
        and_(
            DailyPrice.symbol == symbol,
            DailyPrice.date >= start_date,
            DailyPrice.date <= end_date
        )
    ).first()
    
    return {
        'symbol': symbol,
        'start_date': start_date,
        'end_date': end_date,
        'highest_price': stats.highest_price,
        'lowest_price': stats.lowest_price,
        'average_close': stats.average_close,
        'total_volume': stats.total_volume or 0,
        'total_amount': stats.total_amount or 0,
        'trading_days': stats.trading_days or 0
    }


def get_multi_stock_prices(
    db: Session,
    symbols: List[str],
    start_date: date,
    end_date: date
) -> List[DailyPrice]:
    """获取多支股票的价格数据（用于比较）"""
    return db.query(DailyPrice).filter(
        and_(
            DailyPrice.symbol.in_(symbols),
            DailyPrice.date >= start_date,
            DailyPrice.date <= end_date
        )
    ).order_by(DailyPrice.date, DailyPrice.symbol).all()


def get_available_symbols(db: Session) -> List[str]:
    """获取所有可用的股票代号"""
    result = db.query(DailyPrice.symbol).distinct().order_by(DailyPrice.symbol).all()
    return [row[0] for row in result]


def get_date_range_for_symbol(db: Session, symbol: str) -> Optional[Tuple[date, date]]:
    """获取指定股票的日期范围"""
    result = db.query(
        func.min(DailyPrice.date).label('min_date'),
        func.max(DailyPrice.date).label('max_date')
    ).filter(DailyPrice.symbol == symbol).first()
    
    if result and result.min_date and result.max_date:
        return (result.min_date, result.max_date)
    return None
