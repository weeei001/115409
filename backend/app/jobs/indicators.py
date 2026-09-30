"""Offline indicator recomputation; the HTTP application never imports this module."""
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from math import sqrt
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models.daily_price import DailyPrice
from app.db.models.technical_indicator import TechnicalIndicator


def _quantize(value: Optional[float], digits: str) -> Optional[Decimal]:
    if value is None:
        return None
    return Decimal(str(value)).quantize(Decimal(digits), rounding=ROUND_HALF_UP)


def _calc_sma(values: Sequence[Optional[float]], period: int) -> List[Optional[float]]:
    if period <= 0:
        raise ValueError("period must be positive")

    result: List[Optional[float]] = [None] * len(values)
    window_sum = 0.0
    window_count = 0

    for idx, value in enumerate(values):
        if value is not None:
            window_sum += value
            window_count += 1

        if idx >= period:
            old = values[idx - period]
            if old is not None:
                window_sum -= old
                window_count -= 1

        if idx >= period - 1 and window_count == period:
            result[idx] = window_sum / period

    return result


def _calc_rsi(closes: Sequence[Optional[float]], period: int = 14) -> List[Optional[float]]:
    if period <= 0:
        raise ValueError("period must be positive")

    result: List[Optional[float]] = [None] * len(closes)
    if len(closes) <= period:
        return result

    gains: List[float] = []
    losses: List[float] = []

    for idx in range(1, period + 1):
        if closes[idx] is None or closes[idx - 1] is None:
            return result
        diff = closes[idx] - closes[idx - 1]  # type: ignore[operator]
        gains.append(max(diff, 0.0))
        losses.append(max(-diff, 0.0))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    if avg_loss == 0:
        result[period] = 100.0 if avg_gain > 0 else 50.0
    else:
        rs = avg_gain / avg_loss
        result[period] = 100.0 - (100.0 / (1.0 + rs))

    for idx in range(period + 1, len(closes)):
        if closes[idx] is None or closes[idx - 1] is None:
            continue
        diff = closes[idx] - closes[idx - 1]  # type: ignore[operator]
        gain = max(diff, 0.0)
        loss = max(-diff, 0.0)
        avg_gain = ((avg_gain * (period - 1)) + gain) / period
        avg_loss = ((avg_loss * (period - 1)) + loss) / period

        if avg_loss == 0:
            result[idx] = 100.0 if avg_gain > 0 else 50.0
        else:
            rs = avg_gain / avg_loss
            result[idx] = 100.0 - (100.0 / (1.0 + rs))

    return result


def _calc_ema(values: Sequence[Optional[float]], period: int) -> List[Optional[float]]:
    if period <= 0:
        raise ValueError("period must be positive")

    result: List[Optional[float]] = [None] * len(values)
    alpha = 2.0 / (period + 1.0)
    last_ema: Optional[float] = None

    for idx, value in enumerate(values):
        if value is None:
            continue
        if last_ema is None:
            last_ema = value
        else:
            last_ema = (value * alpha) + (last_ema * (1.0 - alpha))
        result[idx] = last_ema

    return result


def _calc_bollinger(
    closes: Sequence[Optional[float]],
    period: int = 20,
    std_dev: float = 2.0,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    middle = _calc_sma(closes, period)
    upper: List[Optional[float]] = [None] * len(closes)
    lower: List[Optional[float]] = [None] * len(closes)

    for idx in range(period - 1, len(closes)):
        window = closes[idx - period + 1 : idx + 1]
        if any(v is None for v in window):
            continue

        window_vals = [v for v in window if v is not None]
        mean = sum(window_vals) / period
        variance = sum((x - mean) ** 2 for x in window_vals) / period
        std = sqrt(variance)
        upper[idx] = mean + std_dev * std
        lower[idx] = mean - std_dev * std

    return upper, middle, lower


def _build_indicator_rows(prices: Sequence[DailyPrice], symbol: str) -> List[Dict]:
    if not prices:
        return []

    dates = [p.date for p in prices]
    closes = [float(p.close) if p.close is not None else None for p in prices]
    highs = [float(p.high) if p.high is not None else None for p in prices]
    lows = [float(p.low) if p.low is not None else None for p in prices]
    volumes = [float(p.volume_shares) if p.volume_shares is not None else None for p in prices]

    ma5 = _calc_sma(closes, 5)
    ma10 = _calc_sma(closes, 10)
    ma20 = _calc_sma(closes, 20)
    ma60 = _calc_sma(closes, 60)
    ma120 = _calc_sma(closes, 120)
    ma240 = _calc_sma(closes, 240)
    volume_ma5 = _calc_sma(volumes, 5)

    rsi5 = _calc_rsi(closes, period=5)
    rsi10 = _calc_rsi(closes, period=10)

    rsv9_values: List[Optional[float]] = [None] * len(closes)
    kd_k9: List[Optional[float]] = [None] * len(closes)
    kd_d9: List[Optional[float]] = [None] * len(closes)
    kd_j9: List[Optional[float]] = [None] * len(closes)
    prev_k = 50.0
    prev_d = 50.0
    for idx in range(len(closes)):
        high_window = highs[max(0, idx - 8) : idx + 1]
        low_window = lows[max(0, idx - 8) : idx + 1]
        close_value = closes[idx]
        if close_value is None or not high_window or not low_window:
            continue
        valid_highs = [v for v in high_window if v is not None]
        valid_lows = [v for v in low_window if v is not None]
        if not valid_highs or not valid_lows:
            continue
        highest = max(valid_highs)
        lowest = min(valid_lows)
        if highest == lowest:
            rsv = 50.0
        else:
            rsv = ((close_value - lowest) / (highest - lowest)) * 100
        prev_k = (2.0 / 3.0) * prev_k + (1.0 / 3.0) * rsv
        prev_d = (2.0 / 3.0) * prev_d + (1.0 / 3.0) * prev_k
        rsv9_values[idx] = rsv
        kd_k9[idx] = prev_k
        kd_d9[idx] = prev_d
        kd_j9[idx] = 3.0 * prev_k - 2.0 * prev_d

    ema12 = _calc_ema(closes, 12)
    ema26 = _calc_ema(closes, 26)
    macd_dif = [None if ema12[idx] is None or ema26[idx] is None else ema12[idx] - ema26[idx] for idx in range(len(closes))]
    macd_dea = _calc_ema(macd_dif, 9)
    macd_hist = [None if macd_dif[idx] is None or macd_dea[idx] is None else macd_dif[idx] - macd_dea[idx] for idx in range(len(closes))]

    boll_mid20 = _calc_sma(closes, 20)
    boll_upper20, _, boll_lower20 = _calc_bollinger(closes, period=20, std_dev=2.0)

    rows: List[Dict] = []
    for idx, row_date in enumerate(dates):
        rows.append(
            {
                "date": row_date,
                "symbol": symbol,
                "close": _quantize(closes[idx], "0.01"),
                "ma5": _quantize(ma5[idx], "0.01"),
                "ma10": _quantize(ma10[idx], "0.01"),
                "ma20": _quantize(ma20[idx], "0.01"),
                "ma60": _quantize(ma60[idx], "0.01"),
                "ma120": _quantize(ma120[idx], "0.01"),
                "ma240": _quantize(ma240[idx], "0.01"),
                "rsi5": _quantize(rsi5[idx], "0.01"),
                "rsi10": _quantize(rsi10[idx], "0.01"),
                "rsv9": _quantize(rsv9_values[idx], "0.01"),
                "kd_k9": _quantize(kd_k9[idx], "0.01"),
                "kd_d9": _quantize(kd_d9[idx], "0.01"),
                "kd_j9": _quantize(kd_j9[idx], "0.01"),
                "ema12": _quantize(ema12[idx], "0.0001"),
                "ema26": _quantize(ema26[idx], "0.0001"),
                "macd_dif": _quantize(macd_dif[idx], "0.0001"),
                "macd_dea": _quantize(macd_dea[idx], "0.0001"),
                "macd_signal": _quantize(macd_dea[idx], "0.0001"),
                "macd_hist": _quantize(macd_hist[idx], "0.0001"),
                "boll_mid20": _quantize(boll_mid20[idx], "0.01"),
                "boll_upper20": _quantize(boll_upper20[idx], "0.01"),
                "boll_lower20": _quantize(boll_lower20[idx], "0.01"),
                "volume_ma5": _quantize(volume_ma5[idx], "0.01"),
            }
        )

    return rows


def recompute(db: Session, symbol: str, start: date | None = None, end: date | None = None) -> int:
    statement = select(DailyPrice).where(DailyPrice.symbol == symbol)
    if end is not None:
        statement = statement.where(DailyPrice.date <= end)
    prices = list(db.scalars(statement.order_by(DailyPrice.date)))
    rows = _build_indicator_rows(prices, symbol)
    if start is not None:
        rows = [row for row in rows if row["date"] >= start]
    dialect = db.get_bind().dialect.name
    if dialect == "mysql":
        from sqlalchemy.dialects.mysql import insert
    elif dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    else:
        raise ValueError("Indicator recomputation requires MySQL or SQLite")
    try:
        for offset in range(0, len(rows), 500):
            statement = insert(TechnicalIndicator).values(rows[offset:offset + 500])
            keys = [c.name for c in TechnicalIndicator.__table__.columns if not c.primary_key]
            if dialect == "mysql":
                statement = statement.on_duplicate_key_update(**{key: getattr(statement.inserted, key) for key in keys})
            else:
                statement = statement.on_conflict_do_update(
                    index_elements=["date", "symbol"],
                    set_={key: getattr(statement.excluded, key) for key in keys},
                )
            db.execute(statement)
        db.commit()
    except Exception:
        db.rollback()
        raise
    return len(rows)
