from sqlalchemy.orm import Session
from models.daily_price import DailyPrice
from typing import List, Dict
from datetime import date
from decimal import Decimal


def calculate_moving_average(prices: List[float], period: int) -> List[float]:
    """計算移動平均線"""
    if len(prices) < period:
        return [None] * len(prices)
    
    ma = []
    for i in range(len(prices)):
        if i < period - 1:
            ma.append(None)
        else:
            avg = sum(prices[i - period + 1:i + 1]) / period
            ma.append(round(avg, 2))
    return ma


def calculate_price_change_percent(current: float, previous: float) -> float:
    """計算漲跌幅百分比"""
    if previous == 0:
        return 0.0
    return round(((current - previous) / previous) * 100, 2)


def get_candlestick_with_ma(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date,
    ma_periods: List[int] = [5, 10, 20]
) -> Dict:
    """獲取K線圖數據並計算移動平均線"""
    from crud.daily_price import get_price_range
    
    prices = get_price_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    
    if not prices:
        return None
    
    dates = []
    closes = []
    candlestick_data = []
    
    for price in prices:
        if price.open and price.high and price.low and price.close:
            dates.append(price.date.isoformat())
            closes.append(float(price.close))
            candlestick_data.append({
                "date": price.date.isoformat(),
                "open": float(price.open),
                "high": float(price.high),
                "low": float(price.low),
                "close": float(price.close),
                "volume": price.volume_shares or 0,
                "amount": price.amount or 0,
                "change": float(price.change) if price.change else 0
            })
    
    # 計算移動平均線
    ma_data = {}
    for period in ma_periods:
        ma_values = calculate_moving_average(closes, period)
        ma_data[f"MA{period}"] = ma_values
    
    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "dates": dates,
        "candlestick": candlestick_data,
        "moving_averages": ma_data
    }


def get_volume_analysis(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date
) -> Dict:
    """獲取成交量分析數據"""
    from crud.daily_price import get_price_range
    
    prices = get_price_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    
    if not prices:
        return None
    
    volume_data = []
    for price in prices:
        volume_data.append({
            "date": price.date.isoformat(),
            "volume": price.volume_shares or 0,
            "amount": price.amount or 0,
            "close": float(price.close) if price.close else 0,
            "change": float(price.change) if price.change else 0
        })
    
    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "data": volume_data
    }


def get_price_change_data(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date
) -> Dict:
    """獲取價格變化數據（含漲跌幅百分比）"""
    from crud.daily_price import get_price_range
    
    prices = get_price_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    
    if not prices:
        return None
    
    change_data = []
    previous_close = None
    
    for price in prices:
        if price.close:
            current_close = float(price.close)
            change_percent = 0.0
            
            if previous_close is not None:
                change_percent = calculate_price_change_percent(current_close, previous_close)
            
            change_data.append({
                "date": price.date.isoformat(),
                "close": current_close,
                "change": float(price.change) if price.change else 0,
                "change_percent": change_percent
            })
            
            previous_close = current_close
    
    return {
        "symbol": symbol,
        "start_date": start_date,
        "end_date": end_date,
        "data": change_data
    }


def get_ohlc_summary(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date
) -> List[List]:
    """獲取OHLC數據（數組格式，適合某些圖表庫）"""
    from crud.daily_price import get_price_range
    
    prices = get_price_range(db, symbol=symbol, start_date=start_date, end_date=end_date)
    
    if not prices:
        return []
    
    ohlc_data = []
    for price in prices:
        if price.open and price.high and price.low and price.close:
            ohlc_data.append([
                price.date.isoformat(),
                float(price.open),
                float(price.high),
                float(price.low),
                float(price.close),
                price.volume_shares or 0
            ])
    
    return ohlc_data
