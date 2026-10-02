"""Compute comparable price evidence from the existing market repository."""
import json
from datetime import date
from itertools import combinations
from math import isfinite, sqrt
from statistics import StatisticsError, correlation, stdev

from sqlalchemy.orm import Session

from app.features.market import repository

from .schemas import SourceChunk


MAX_COMPARISON_STOCKS = 6


def collect_comparison_source(db: Session, symbols: list[str], start_date: date,
                              end_date: date) -> SourceChunk | None:
    """Read with the caller's Session; never fill missing prices or returns."""
    requested = list(dict.fromkeys(symbol.strip().upper() for symbol in symbols if symbol.strip()))
    if start_date > end_date:
        raise ValueError("start_date must not be after end_date")
    if len(requested) > MAX_COMPARISON_STOCKS:
        raise ValueError("Comparison supports at most six stocks")
    if len(requested) < 2:
        return None

    rows = repository.compare(db, requested, start_date, end_date)
    observed_dates = sorted({row.date for row in rows})
    prices = {symbol: {} for symbol in requested}
    for row in rows:
        if row.close is not None and isfinite(value := float(row.close)) and value > 0:
            prices[row.symbol][row.date] = value
    common_dates = sorted(set.intersection(*(set(values) for values in prices.values())))
    common = set(common_dates)
    # ponytail: the observed union is the calendar; use an exchange calendar to detect dates missing for every stock.
    daily_pairs = [(previous, current) for previous, current in zip(observed_dates, observed_dates[1:])
                   if previous in common and current in common]
    daily_returns = {symbol: [values[current] / values[previous] - 1
                             for previous, current in daily_pairs]
                     for symbol, values in prices.items()}
    stocks = []
    for symbol, values in prices.items():
        closes = [values[day] for day in common_dates]
        returns = daily_returns[symbol]
        drawdown = None
        if len(closes) >= 2:
            peak, drawdown = closes[0], 0.0
            for close in closes[1:]:
                peak = max(peak, close)
                drawdown = min(drawdown, close / peak - 1)
        stocks.append({
            "symbol": symbol,
            "available_start_date": min(values).isoformat() if values else None,
            "available_end_date": max(values).isoformat() if values else None,
            "available_price_samples": len(values),
            "missing_observed_dates": len(observed_dates) - len(values),
            "first_common_close": closes[0] if closes else None,
            "last_common_close": closes[-1] if closes else None,
            "interval_return_pct": round((closes[-1] / closes[0] - 1) * 100, 6) if len(closes) >= 2 else None,
            "annualized_volatility_pct": round(stdev(returns) * sqrt(252) * 100, 6) if len(returns) >= 2 else None,
            "max_drawdown_pct": round(drawdown * 100, 6) if drawdown is not None else None,
        })
    correlations = []
    for first, second in combinations(requested, 2):
        try:
            value = correlation(daily_returns[first], daily_returns[second])
        except StatisticsError:
            value = None
        correlations.append({"symbols": [first, second],
                             "pearson_r": round(value, 6) if value is not None else None})

    limitations = [
        "Prices are unadjusted closes in TWD per share; returns exclude dividends, fees and taxes.",
        "The trading calendar is inferred from observed dates; dates missing for every stock cannot be detected.",
        "Missing or nonpositive prices are not filled. Null metrics mean insufficient evidence, not zero.",
    ]
    missing_symbols = [symbol for symbol, values in prices.items() if not values]
    if missing_symbols:
        limitations.append("No valid prices in the requested period for: " + ", ".join(missing_symbols) + ".")
    if not common_dates:
        limitations.append("No common valid closing date across all requested stocks; no fair comparison is available.")
    elif len(common_dates) < len(observed_dates):
        limitations.append("Only common closing dates are compared; excluded dates can hide drawdowns. "
                           "Returns spanning a missing observed date are excluded from daily statistics.")
    if len(daily_pairs) < 20:
        limitations.append("Fewer than 20 aligned daily returns; volatility and correlation estimates may be unstable.")
    content = {
        "requested_start_date": start_date.isoformat(),
        "requested_end_date": end_date.isoformat(),
        "common_start_date": common_dates[0].isoformat() if common_dates else None,
        "common_end_date": common_dates[-1].isoformat() if common_dates else None,
        "common_price_samples": len(common_dates),
        "common_daily_return_samples": len(daily_pairs),
        "daily_return_start_date": daily_pairs[0][0].isoformat() if daily_pairs else None,
        "daily_return_end_date": daily_pairs[-1][1].isoformat() if daily_pairs else None,
        "observed_union_date_count": len(observed_dates),
        "methods": {
            "alignment": "Every requested stock uses the same common valid closing dates. "
                         "Daily return endpoints must be adjacent in the observed union of stock dates.",
            "interval_return_pct": "(last common close / first common close - 1) * 100; requires at least 2 common closes.",
            "annualized_volatility_pct": "Sample standard deviation (n-1) of aligned daily fractional returns "
                                         "* sqrt(252) * 100; requires at least 2 daily returns.",
            "max_drawdown_pct": "Minimum (close / running peak - 1) * 100 across common closes; "
                                "zero or negative; requires at least 2 common closes.",
            "pearson_r": "Pearson correlation of aligned daily fractional returns; unitless [-1,1]; "
                         "requires at least 2 returns and nonzero variance in both stocks.",
        },
        "stocks": stocks,
        "correlations": correlations,
        "limitations": limitations,
    }
    latest = max((day for values in prices.values() for day in values), default=None)
    return SourceChunk(
        title=f"{'、'.join(requested)} 比較（{start_date} 至 {end_date}）",
        source="system_comparison", source_name="系統多股比較", category="comparison", stock_id="", stock_ids=requested,
        pub_time=latest.isoformat() if latest else "", url="", score=1,
        content=json.dumps(content, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
    )
