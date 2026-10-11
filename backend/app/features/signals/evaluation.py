"""Event study of signals: what followed each one, against the market and against any day; pure functions."""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass
from datetime import date

from app.features.analysis.track_record import benchmark_change
from .detection import Day, Reading
from .schemas import PeriodStats

FEE_RATE = 0.001425
SELL_TAX_RATE = 0.003
ROUND_TRIP_COST_PCT = round((2 * FEE_RATE + SELL_TAX_RATE) * 100, 4)


@dataclass(frozen=True)
class Outcome:
    date: date
    change: float
    market: float | None
    # The close that ended the window: from this day on, the outcome is known.
    resolved_on: date


def outcomes(days: list[Day], indexes: list[int], horizon: int, benchmark: list[tuple[date, float]],
             start: date, end: date) -> tuple[list[Outcome], int]:
    """Outcomes of events dated within [start, end], and how many have not finished their window.

    An event is skipped while an earlier event of the same signal, counted or pending, is still inside its
    window: overlapping windows share most of their price path and would be counted as independent samples.
    """
    results, pending, last = [], 0, None
    for index in indexes:
        if not start <= days[index].date <= end:
            continue
        if last is not None and index < last + horizon:
            continue
        last = index
        if index + horizon >= len(days):
            pending += 1
            continue
        base, exit_ = days[index], days[index + horizon]
        results.append(Outcome(base.date, exit_.close / base.close - 1,
                               benchmark_change(benchmark, base.date, exit_.date), exit_.date))
    return results, pending


# Running (count, sum of changes, rises, compared with market, beat market, sum of excess).
Totals = tuple[int, float, int, int, int, float]
NO_TOTALS: Totals = (0, 0, 0, 0, 0, 0.0)


def _add(totals: Totals, item: Outcome) -> Totals:
    count, total, rises, compared, beats, excess = totals
    known = item.market is not None
    return (count + 1, total + item.change, rises + (item.change > 0), compared + known,
            beats + (known and item.change > item.market), excess + (item.change - item.market if known else 0.0))


def _stats(totals: Totals, reading: Reading | None) -> PeriodStats:
    count, total, rises, compared, beats, excess = totals
    if not count:
        return PeriodStats(events=0)
    average = total / count
    return PeriodStats(
        events=count, avg_return_pct=round(average * 100, 2), up_rate=round(rises / count, 4),
        beat_market_rate=round(beats / compared, 4) if compared else None,
        avg_excess_pct=round(excess / compared * 100, 2) if compared else None,
        # A bearish reading means staying out, so there is no trade whose cost to subtract.
        net_return_pct=round(average * 100 - ROUND_TRIP_COST_PCT, 2) if reading == "bullish" else None,
    )


def summarize(items: list[Outcome], reading: Reading | None) -> PeriodStats:
    totals = NO_TOTALS
    for item in items:
        totals = _add(totals, item)
    return _stats(totals, reading)


class CumulativeStats:
    """Outcomes ordered by the day their window closed, so the stats known on any date are one lookup away.

    ``upto(day)`` counts only outcomes resolved on or before ``day``: an event whose window was still open
    on that day is invisible, which is what keeps a backtest from reading results it could not have had.
    """

    def __init__(self, items: list[Outcome]):
        ordered = sorted(items, key=lambda item: (item.resolved_on, item.date))
        self._dates = [item.resolved_on for item in ordered]
        self._totals = [NO_TOTALS]
        for item in ordered:
            self._totals.append(_add(self._totals[-1], item))

    def upto(self, day: date, reading: Reading | None) -> PeriodStats:
        return _stats(self._totals[bisect_right(self._dates, day)], reading)
