"""Signal check: which standard signals were followed by better-than-any-day results, in two separate periods."""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.features.analysis.evidence import revenue_availability
from app.features.analysis.repository import benchmark_series
from . import repository
from .detection import SIGNALS, Day, detect, revenue_turns
from .evaluation import ROUND_TRIP_COST_PCT, outcomes, summarize
from .history import SignalHistory, StockSeries
from .schemas import RecentSignal, SignalCheckResponse, SignalEvidenceResponse, SignalStats

# Enough trading days before the range for 60-day highs and the indicators' previous day.
PRICE_LEAD_DAYS = 150
REVENUE_LEAD_MONTHS = 15
RECENT_TRADING_DAYS = 10
HORIZONS = (5, 20)
# Point-in-time statistics use everything stored; the cut is by date at query time, not at load time.
HISTORY_START = date(1990, 1, 1)

EVIDENCE_NOTE = (
    "截至判斷日：只計入觀察期在判斷日收盤時已經走完的事件，判斷日之後才知道結果的事件一律不算，"
    "所以拿這份清單做歷史回測時，不會看到當時還不知道的結果。"
    "列出的是判斷日往前 N 個交易日內成立的訊號，觀察期還沒走完，仍和判斷有關；統計用判斷日當天已知的結果，不是訊號成立那天的。"
    "「全部股票」是目前股票清單裡的股票合計，後來下市或被換掉的股票不在裡面，可能讓結果偏好看。"
    "「這檔股票」的次數通常很少，只能參考。過去表現不代表未來結果，訊號不是買賣建議。"
)

METHOD_NOTE = (
    "事件研究：訊號成立當天收盤後，看之後第 N 個交易日收盤的漲跌，並和同期加權指數（未含息）比較。"
    "交叉、翻正、連續買賣超這類訊號只在條件剛成立的那天算一次，例如收盤剛站上月線，之後連續幾天都在月線上不重複計算；"
    "創 60 日新高與帶量上漲則是每次出現都算成立。"
    "同一檔股票的同一個訊號，上一次的觀察期還沒走完前又成立，不重複計算，避免重疊的行情被當成多份獨立樣本。"
    "法人買賣超與月營收多在收盤後才公布，從成立當天收盤起算，會比實際能進場的時間早一些。"
    "「任一天進場」是同一批股票、同一期間每隔 N 個交易日取一天的結果，訊號要比它好才有意義。"
    "挑選期與驗證期分開統計：只在挑選期好看、到了驗證期就不見的訊號，多半是運氣；"
    "挑選期最後幾個事件的觀察期會延伸到驗證期的頭幾天。"
    "「全部股票」是目前股票清單裡的股票，後來下市或被換掉的股票不在裡面，可能讓結果偏好看。"
    "扣成本以手續費 0.1425%（買賣各一次）加證交稅 0.3% 計算，只適用一般解讀偏多的訊號。"
    "行情為未還原價格，除權息造成的下跌也算下跌。過去表現不代表未來結果，訊號不是買賣建議。"
)


def _number(value: Any) -> float | None:
    return None if value is None else float(value)


def build_days(rows: dict[str, list[Any]]) -> list[Day]:
    indicators = {row.date: row for row in rows["indicators"]}
    flows = {row.date: row for row in rows["flows"]}
    days = []
    for price in rows["prices"]:
        if price.close is None or price.close <= 0:
            continue
        indicator, flow = indicators.get(price.date), flows.get(price.date)
        days.append(Day(
            date=price.date, close=float(price.close), volume=_number(price.volume_shares),
            ma20=_number(indicator and indicator.ma20), ma60=_number(indicator and indicator.ma60),
            kd_k=_number(indicator and indicator.kd_k9), kd_d=_number(indicator and indicator.kd_d9),
            macd_hist=_number(indicator and indicator.macd_hist), volume_ma5=_number(indicator and indicator.volume_ma5),
            foreign_net=_number(flow and flow.foreign_net), trust_net=_number(flow and flow.investment_trust_net),
        ))
    return days


def revenue_months(rows: list[Any]) -> list[tuple[int, date, float | None]]:
    """(year * 12 + month, availability date, yoy %) for each month with a usable availability date."""
    by_period: dict[int, tuple[date | None, float]] = {}
    for row in rows:
        try:
            period = int(row.revenue_year) * 12 + int(row.revenue_month)
        except (TypeError, ValueError):
            continue
        if row.revenue and row.revenue > 0:
            by_period[period] = (revenue_availability(row)[0], float(row.revenue))
    months = []
    for period in sorted(by_period):
        available, value = by_period[period]
        year_ago = by_period.get(period - 12)
        if available is not None:
            months.append((period, available, (value / year_ago[1] - 1) * 100 if year_ago else None))
    return months


def series_from_rows(rows: dict[str, dict[str, list[Any]]], symbols: list[str]) -> dict[str, StockSeries]:
    """Each stock's trading days and the indexes where every signal fired."""
    series = {}
    for code in symbols:
        days = build_days(rows[code])
        series[code] = (days, detect(days, revenue_turns(revenue_months(rows[code]["revenue"]))))
    return series


def load_series(db: Session, symbols: list[str], since: date, revenue_since: date) -> dict[str, StockSeries]:
    return series_from_rows(repository.market_rows(db, symbols, since, revenue_since), symbols)


def _revenue_since(start: date) -> date:
    """First revenue month a turn published on or after ``start`` can need.

    Rows are dated on the first of their month. The earliest such turn is usually last month's, whose
    previous month's growth compares with the month a year before that: 14 months back, plus one for
    reports published late.
    """
    index = start.year * 12 + start.month - 1 - REVENUE_LEAD_MONTHS
    return date(index // 12, index % 12 + 1, 1)


def _check_horizon(horizon: int) -> None:
    if horizon not in HORIZONS:
        raise AppError("觀察天數只能是 5 或 20 個交易日", status_code=422)


def _catalog(db: Session, symbol: str | None) -> list[str]:
    symbols = repository.catalog_symbols(db)
    if symbol is not None and symbol not in symbols:
        raise AppError(f"股票清單裡沒有 {symbol}", status_code=404)
    return symbols


def signal_evidence(db: Session, *, symbol: str, as_of: date, horizon: int) -> SignalEvidenceResponse:
    """The evidence list an AI decision on ``as_of`` may cite: recent signals with what was known that day."""
    _check_horizon(horizon)
    symbols = _catalog(db, symbol)
    history = SignalHistory(load_series(db, symbols, HISTORY_START, HISTORY_START), horizon,
                            benchmark_series(db, HISTORY_START))
    index = history.decision_index(symbol, as_of)
    if index is None:
        raise AppError(f"{symbol} 在 {as_of} 以前沒有行情資料", status_code=404)
    decision = history.series[symbol][0][index].date
    return SignalEvidenceResponse(
        symbol=symbol, as_of=as_of.isoformat(), decision_date=decision.isoformat(), horizon=horizon,
        baseline=history.baseline(decision), items=history.evidence(symbol, index), method_note=EVIDENCE_NOTE,
    )


def signal_check(db: Session, *, symbol: str | None, start: date, split: date, end: date,
                 horizon: int) -> SignalCheckResponse:
    _check_horizon(horizon)
    if not start < split <= end:
        raise AppError("日期須符合：起始日 < 分割日 ≤ 結束日", status_code=422)
    symbols = _catalog(db, symbol)
    if symbol is not None:
        symbols = [symbol]
    series = load_series(db, symbols, start - timedelta(days=PRICE_LEAD_DAYS), _revenue_since(start))
    benchmark = benchmark_series(db, start - timedelta(days=PRICE_LEAD_DAYS))

    collected = {signal.key: ([], [], 0) for signal in SIGNALS}
    baseline: tuple[list, list, int] = ([], [], 0)
    recent: list[RecentSignal] = []
    latest = None
    included = 0

    def split_add(bucket, results, pending):
        discovery, validation, waiting = bucket
        discovery.extend(item for item in results if item.date < split)
        validation.extend(item for item in results if item.date >= split)
        return discovery, validation, waiting + pending

    for code in symbols:
        days, fired = series[code]
        if not days:
            continue
        included += 1
        latest = max(latest, days[-1].date) if latest else days[-1].date
        for signal in SIGNALS:
            collected[signal.key] = split_add(collected[signal.key],
                                              *outcomes(days, fired[signal.key], horizon, benchmark, start, end))
        baseline = split_add(baseline, *outcomes(days, list(range(len(days))), horizon, benchmark, start, end))
        if symbol is not None:
            cutoff = days[max(0, len(days) - RECENT_TRADING_DAYS)].date
            recent = sorted((RecentSignal(date=days[index].date.isoformat(), key=signal.key, label=signal.label,
                                          reading=signal.reading)
                             for signal in SIGNALS for index in fired[signal.key] if days[index].date >= cutoff),
                            key=lambda item: (item.date, item.key), reverse=True)

    def stats(key, label, definition, reading, source, bucket):
        discovery, validation, pending = bucket
        return SignalStats(key=key, label=label, definition=definition, reading=reading, source=source,
                           discovery=summarize(discovery, reading), validation=summarize(validation, reading),
                           pending=pending)

    return SignalCheckResponse(
        symbol=symbol, stock_count=included, horizon=horizon, start=start.isoformat(), split=split.isoformat(),
        end=end.isoformat(), latest_date=latest.isoformat() if latest else None,
        round_trip_cost_pct=ROUND_TRIP_COST_PCT,
        baseline=stats("any_day", "任一天進場", f"每隔 {horizon} 個交易日取一天，不看任何訊號", "bullish", "對照組",
                       baseline),
        signals=[stats(signal.key, signal.label, signal.definition, signal.reading, signal.source,
                       collected[signal.key]) for signal in SIGNALS],
        recent=recent, method_note=METHOD_NOTE,
    )
