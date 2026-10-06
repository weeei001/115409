from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.technical_indicator import TechnicalIndicator
from app.db.models.market_extra import (
    DividendResult, ForeignShareholding, HoldingShareLevel, MarginTrade,
    MonthlyRevenue, StockValuation,
)
from app.features.market import repository


def symbols(db: Session):
    return repository.symbols(db)

def stock_infos(db: Session):
    return repository.stock_infos(db)


def latest(db: Session, symbol: str):
    row = repository.latest(db, symbol.upper())
    if row is None:
        raise AppError(f"找不到股票 {symbol} 的價格數據", status_code=404)
    return row


def date_range(db: Session, symbol: str):
    first, last = repository.date_range(db, symbol.upper())
    if first is None or last is None:
        raise AppError(f"找不到股票 {symbol} 的數據", status_code=404)
    return {"symbol": symbol.upper(), "min_date": first, "max_date": last}


def _range(symbol: str, start_date: date, end_date: date):
    return {"symbol": symbol, "start_date": start_date, "end_date": end_date}


def _require_rows(rows, symbol: str, label: str = "數據"):
    if not rows:
        raise AppError(f"在指定日期範圍內找不到股票 {symbol} 的{label}", status_code=404)
    return rows


def history(db: Session, symbol: str, start_date=None, end_date=None, skip=0, limit=100):
    symbol = symbol.upper()
    if start_date is None and end_date is None:
        end_date = date.today()
        start_date = end_date - timedelta(days=30)
    total, rows = repository.history(db, symbol, start_date, end_date, skip, limit)
    return {**_range(symbol, start_date or date.min, end_date or date.today()),
            "total": total, "data": rows}


def statistics(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    result = repository.statistics(db, symbol, start_date, end_date)
    _require_rows(result["trading_days"], symbol)
    for key in ("total_volume", "total_amount", "trading_days"):
        result[key] = result[key] or 0
    return {**_range(symbol, start_date, end_date), **result}


def compare(db: Session, symbols: str, start_date: date, end_date: date):
    requested = [symbol.strip().upper() for symbol in symbols.split(",")]
    rows = repository.compare(db, requested, start_date, end_date)
    if not rows:
        raise AppError("找不到任何股票數據", status_code=404)
    by_date = {}
    for row in rows:
        values = by_date.setdefault(row.date.isoformat(), dict.fromkeys(requested))
        values[row.symbol] = float(row.close) if row.close else None
    return {"start_date": start_date, "end_date": end_date, "symbols": requested,
            "data": [{"date": day, "prices": by_date[day]} for day in sorted(by_date)]}


def moving_average(prices: list[float], period: int):
    # ponytail: O(n * period), at most five series; use a rolling sum if profiling warrants it.
    return [None if index < period - 1 else round(sum(prices[index - period + 1:index + 1]) / period, 2)
            for index in range(len(prices))]


def candlestick(db: Session, symbol: str, start_date: date, end_date: date, ma_periods: str):
    symbol = symbol.upper()
    try:
        periods = [int(value.strip()) for value in ma_periods.split(",")]
        if len(periods) > 5:
            raise ValueError("最多支援5條移動平均線")
        if any(period <= 0 for period in periods):
            raise ValueError("移動平均線週期必須大於0")
        query_start = start_date - timedelta(days=max(periods) * 3)
    except (ValueError, OverflowError) as exc:
        raise AppError(f"移動平均線週期格式錯誤: {exc}", status_code=400) from exc
    prices = repository.symbol_range(db, DailyPrice, symbol, query_start, end_date)
    prices = [row for row in prices if row.open and row.high and row.low and row.close]
    visible = [index for index, row in enumerate(prices) if start_date <= row.date <= end_date]
    _require_rows(visible, symbol)
    closes = [float(row.close) for row in prices]
    averages = {}
    for period in periods:
        values = moving_average(closes, period)
        averages[f"MA{period}"] = [values[index] for index in visible]
    candles = [{"date": row.date.isoformat(), "open": float(row.open), "high": float(row.high),
                "low": float(row.low), "close": float(row.close),
                "volume": row.volume_shares or 0, "amount": row.amount or 0,
                "change": float(row.change or 0)} for row in (prices[index] for index in visible)]
    return {**_range(symbol, start_date, end_date), "dates": [row["date"] for row in candles],
            "candlestick": candles, "moving_averages": averages}


def volume(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    prices = _require_rows(repository.symbol_range(db, DailyPrice, symbol, start_date, end_date), symbol)
    return {**_range(symbol, start_date, end_date), "data": [
        {"date": row.date.isoformat(), "volume": row.volume_shares or 0, "amount": row.amount or 0,
         "close": float(row.close or 0), "change": float(row.change or 0)} for row in prices]}


def price_change(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    prices = _require_rows(repository.symbol_range(db, DailyPrice, symbol, start_date, end_date), symbol)
    previous, data = None, []
    for row in prices:
        if row.close:
            current = float(row.close)
            if previous is None and row.change is not None and current - float(row.change) > 0:
                # The range's first row has no in-window predecessor; its own change gives the prior close.
                previous = current - float(row.change)
            percent = round((current - previous) / previous * 100, 2) if previous else 0.0
            data.append({"date": row.date.isoformat(), "close": current,
                         "change": float(row.change or 0), "change_percent": percent})
            previous = current
    return {**_range(symbol, start_date, end_date), "data": data}


def institutional_trades(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    rows = repository.symbol_range(db, InstitutionalTrade, symbol, start_date, end_date)
    _require_rows(rows, symbol, "三大法人數據")
    return {**_range(symbol, start_date, end_date), "total": len(rows), "data": rows}


def technical_indicators(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    rows = repository.symbol_range(db, TechnicalIndicator, symbol, start_date, end_date)
    _require_rows(rows, symbol, "技術指標數據")
    return {**_range(symbol, start_date, end_date), "total": len(rows), "data": rows}


def _float(value):
    return float(value) if value is not None else None


def _chips_rows(prices, trades):
    by_date = {row.date: row for row in trades}
    return [{"date": row.date.isoformat(), "close": _float(row.close), "volume": row.volume_shares,
             **{field: getattr(by_date[row.date], field) for field in (
                 "foreign_net", "investment_trust_net", "dealer_net", "total_institutional_net")}}
            for row in prices if row.date in by_date]


def volume_with_chips(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    prices = repository.symbol_range(db, DailyPrice, symbol, start_date, end_date)
    trades = repository.symbol_range(db, InstitutionalTrade, symbol, start_date, end_date)
    _require_rows(prices and trades, symbol, "完整數據")
    return {**_range(symbol, start_date, end_date), "data": _chips_rows(prices, trades)}


def integrated_chart(db: Session, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    prices = repository.symbol_range(db, DailyPrice, symbol, start_date, end_date)
    trades = repository.symbol_range(db, InstitutionalTrade, symbol, start_date, end_date)
    indicators = repository.symbol_range(db, TechnicalIndicator, symbol, start_date, end_date)
    _require_rows(prices or trades or indicators, symbol, "圖表數據")
    price_rows = [{"date": row.date.isoformat(), "close": _float(row.close),
                   "volume": row.volume_shares, "volume_shares": row.volume_shares,
                   "amount": row.amount, "change": _float(row.change)} for row in prices]
    trade_fields = ("foreign_buy", "foreign_sell", "foreign_net", "investment_trust_buy",
                    "investment_trust_sell", "investment_trust_net", "dealer_buy", "dealer_sell",
                    "dealer_net", "total_institutional_buy", "total_institutional_sell", "total_institutional_net")
    trade_rows = [{"date": row.date.isoformat(), "symbol": row.symbol,
                   **{field: getattr(row, field) for field in trade_fields},
                   "trust_net": row.investment_trust_net, "total_net": row.total_institutional_net}
                  for row in trades]
    indicator_fields = ("close", "ma5", "ma10", "ma20", "ma60", "rsi5", "rsi10", "rsv9",
                        "kd_k9", "kd_d9", "kd_j9", "ema12", "ema26", "macd_dif", "macd_dea",
                        "macd_signal", "macd_hist", "volume_ma5")
    indicator_rows = [{"date": row.date.isoformat(), "symbol": row.symbol,
                       **{field: _float(getattr(row, field)) for field in indicator_fields}}
                      for row in indicators]
    return {**_range(symbol, start_date, end_date), "price_volume": price_rows,
            "institutional_trades": trade_rows, "technical_indicators": indicator_rows,
            "volume_with_chips": _chips_rows(prices, trades)}


def financial_statements(db: Session, symbol: str, statement: str,
                         start_date: date, end_date: date, item_type: str | None):
    symbol = symbol.upper()
    rows = repository.financial_statements(db, symbol, statement, start_date, end_date, item_type)
    _require_rows(rows, symbol, "財報資料")
    return {**_range(symbol, start_date, end_date), "total": len(rows), "data": rows}


_DATASETS = {
    "monthly_revenues": (MonthlyRevenue, "月營收"),
    "valuations": (StockValuation, "估值"),
    "dividend_results": (DividendResult, "除權息結果"),
    "margin_trades": (MarginTrade, "融資融券"),
    "foreign_shareholding": (ForeignShareholding, "外資持股"),
    "holding_share_levels": (HoldingShareLevel, "持股分級"),
}


def dataset(db: Session, name: str, symbol: str, start_date: date, end_date: date):
    symbol = symbol.upper()
    model, label = _DATASETS[name]
    rows = repository.symbol_range(db, model, symbol, start_date, end_date)
    _require_rows(rows, symbol, f"{label}資料")
    return {**_range(symbol, start_date, end_date), "total": len(rows), "data": rows}
