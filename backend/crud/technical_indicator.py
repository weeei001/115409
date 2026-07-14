from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
from math import sqrt
from typing import Dict, List, Optional, Sequence, Tuple

from sqlalchemy import and_, desc
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.orm import Session

from models.daily_price import DailyPrice
from models.technical_indicator import TechnicalIndicator


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


def _calc_kd(
    highs: Sequence[Optional[float]],
    lows: Sequence[Optional[float]],
    closes: Sequence[Optional[float]],
    period: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]]]:
    k_values: List[Optional[float]] = [None] * len(closes)
    d_values: List[Optional[float]] = [None] * len(closes)

    last_k = 50.0
    last_d = 50.0

    for idx in range(len(closes)):
        if idx < period - 1:
            continue

        high_window = highs[idx - period + 1 : idx + 1]
        low_window = lows[idx - period + 1 : idx + 1]
        close_value = closes[idx]

        if (
            close_value is None
            or any(v is None for v in high_window)
            or any(v is None for v in low_window)
        ):
            continue

        highest = max(high_window)  # type: ignore[arg-type]
        lowest = min(low_window)  # type: ignore[arg-type]
        if highest == lowest:
            rsv = 50.0
        else:
            rsv = ((close_value - lowest) / (highest - lowest)) * 100

        last_k = (2.0 / 3.0) * last_k + (1.0 / 3.0) * rsv
        last_d = (2.0 / 3.0) * last_d + (1.0 / 3.0) * last_k
        k_values[idx] = last_k
        d_values[idx] = last_d

    return k_values, d_values


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
        result[period] = 100.0
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
            result[idx] = 100.0
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


def _calc_macd(
    closes: Sequence[Optional[float]],
    fast: int = 12,
    slow: int = 26,
    signal: int = 9,
) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    ema_fast = _calc_ema(closes, fast)
    ema_slow = _calc_ema(closes, slow)

    macd_line: List[Optional[float]] = [None] * len(closes)
    for idx in range(len(closes)):
        if ema_fast[idx] is None or ema_slow[idx] is None:
            continue
        macd_line[idx] = ema_fast[idx] - ema_slow[idx]  # type: ignore[operator]

    signal_line = _calc_ema(macd_line, signal)
    hist: List[Optional[float]] = [None] * len(closes)
    for idx in range(len(closes)):
        if macd_line[idx] is None or signal_line[idx] is None:
            continue
        hist[idx] = macd_line[idx] - signal_line[idx]  # type: ignore[operator]

    return macd_line, signal_line, hist


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
        highest = max(v for v in high_window if v is not None)
        lowest = min(v for v in low_window if v is not None)
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


def _upsert_rows(db: Session, rows: Sequence[Dict], chunk_size: int = 1000) -> int:
    if not rows:
        return 0

    total = 0
    for start_idx in range(0, len(rows), chunk_size):
        chunk = list(rows[start_idx : start_idx + chunk_size])
        stmt = mysql_insert(TechnicalIndicator).values(chunk)
        update_columns = {
            "close": stmt.inserted.close,
            "ma5": stmt.inserted.ma5,
            "ma10": stmt.inserted.ma10,
            "ma20": stmt.inserted.ma20,
            "ma60": stmt.inserted.ma60,
            "ma120": stmt.inserted.ma120,
            "ma240": stmt.inserted.ma240,
            "rsi5": stmt.inserted.rsi5,
            "rsi10": stmt.inserted.rsi10,
            "rsv9": stmt.inserted.rsv9,
            "kd_k9": stmt.inserted.kd_k9,
            "kd_d9": stmt.inserted.kd_d9,
            "kd_j9": stmt.inserted.kd_j9,
            "ema12": stmt.inserted.ema12,
            "ema26": stmt.inserted.ema26,
            "macd_dif": stmt.inserted.macd_dif,
            "macd_dea": stmt.inserted.macd_dea,
            "macd_signal": stmt.inserted.macd_signal,
            "macd_hist": stmt.inserted.macd_hist,
            "boll_mid20": stmt.inserted.boll_mid20,
            "boll_upper20": stmt.inserted.boll_upper20,
            "boll_lower20": stmt.inserted.boll_lower20,
            "volume_ma5": stmt.inserted.volume_ma5,
        }
        stmt = stmt.on_duplicate_key_update(**update_columns)
        db.execute(stmt)
        total += len(chunk)

    db.commit()
    return total


def compute_all_for_symbol(
    db: Session,
    symbol: str,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> int:
    query = db.query(DailyPrice).filter(DailyPrice.symbol == symbol)
    if start_date is not None:
        query = query.filter(DailyPrice.date >= start_date)
    if end_date is not None:
        query = query.filter(DailyPrice.date <= end_date)

    prices = query.order_by(DailyPrice.date).all()
    rows = _build_indicator_rows(prices, symbol)
    return _upsert_rows(db, rows)


def compute_latest_for_symbol(
    db: Session,
    symbol: str,
    target_date: Optional[date] = None,
    lookback_days: int = 120,
) -> int:
    if target_date is None:
        latest_price = (
            db.query(DailyPrice)
            .filter(DailyPrice.symbol == symbol)
            .order_by(desc(DailyPrice.date))
            .first()
        )
        if latest_price is None:
            return 0
        target_date = latest_price.date

    start = target_date - timedelta(days=lookback_days)
    prices = (
        db.query(DailyPrice)
        .filter(
            and_(
                DailyPrice.symbol == symbol,
                DailyPrice.date >= start,
                DailyPrice.date <= target_date,
            )
        )
        .order_by(DailyPrice.date)
        .all()
    )
    rows = _build_indicator_rows(prices, symbol)
    if not rows:
        return 0
    return _upsert_rows(db, [rows[-1]])


def get_indicators(
    db: Session,
    symbol: str,
    start_date: date,
    end_date: date,
) -> List[TechnicalIndicator]:
    return (
        db.query(TechnicalIndicator)
        .filter(
            and_(
                TechnicalIndicator.symbol == symbol,
                TechnicalIndicator.date >= start_date,
                TechnicalIndicator.date <= end_date,
            )
        )
        .order_by(TechnicalIndicator.date)
        .all()
    )


def get_latest_indicator(db: Session, symbol: str) -> Optional[TechnicalIndicator]:
    return (
        db.query(TechnicalIndicator)
        .filter(TechnicalIndicator.symbol == symbol)
        .order_by(desc(TechnicalIndicator.date))
        .first()
    )
