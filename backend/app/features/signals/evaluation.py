"""Event study of signals: what followed each one, against the other stocks over the same days; pure functions.

A signal is known at a close, so the earliest fill is the next trading day's open: every outcome runs from that
open to the close N trading days after the signal day. Each outcome is compared with the average of the other
stocks over the same days. Signals bunch up in some stretches of the market, and a plain average would credit
a signal with whatever the whole market did while it kept firing.
"""
from __future__ import annotations

from bisect import bisect_right
from dataclasses import dataclass, replace
from datetime import date
from math import sqrt
from typing import Iterable

from .detection import Day, Reading
from .schemas import PeriodStats

FEE_RATE = 0.001425
SELL_TAX_RATE = 0.003
ROUND_TRIP_COST_PCT = round((2 * FEE_RATE + SELL_TAX_RATE) * 100, 4)
# Two-sided 95% points of Student's t for 1 to 30 degrees of freedom. With a few months as clusters the normal
# 1.96 makes the range too narrow; beyond 30 a Cornish-Fisher expansion of 1.96 is accurate to three decimals.
_T95 = (12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.160, 2.145, 2.131,
        2.120, 2.110, 2.101, 2.093, 2.086, 2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042)


def t95(degrees: int) -> float:
    if degrees <= len(_T95):
        return _T95[degrees - 1]
    z = 1.959964
    return z + (z ** 3 + z) / (4 * degrees) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * degrees ** 2)

# (signal day, exit day) -> (sum of window returns, number of stocks) over every stock with that window.
PeerWindows = dict[tuple[date, date], tuple[float, int]]


@dataclass(frozen=True)
class Outcome:
    date: date
    change: float
    # Average change of the other stocks over the same window; None when no other stock had it.
    peers: float | None
    # The close that ended the window: from this day on, the outcome is known.
    resolved_on: date


def window_return(days: list[Day], index: int, horizon: int) -> float | None:
    """From the open after ``index`` to the close ``horizon`` trading days after it; None without that open."""
    entry = days[index + 1].open
    return days[index + horizon].close / entry - 1 if entry and entry > 0 else None


def peer_windows(stocks: Iterable[list[Day]], horizon: int) -> PeerWindows:
    windows: PeerWindows = {}
    for days in stocks:
        for index in range(len(days) - horizon):
            change = window_return(days, index, horizon)
            if change is not None:
                key = (days[index].date, days[index + horizon].date)
                total, count = windows.get(key, (0.0, 0))
                windows[key] = (total + change, count + 1)
    return windows


def outcomes(days: list[Day], indexes: list[int], horizon: int, peers: PeerWindows,
             start: date, end: date) -> tuple[list[Outcome], int]:
    """Outcomes of events dated within [start, end], and how many have not finished their window.

    ``peers`` must include this stock's own windows, which are taken back out of the average. An event is
    skipped while an earlier event of the same signal, counted or pending, is still inside its window:
    overlapping windows share most of their price path and would be counted as independent samples. An event
    without a usable next-day open is left out.
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
        change = window_return(days, index, horizon)
        if change is None:
            continue
        exit_day = days[index + horizon].date
        total, count = peers[(days[index].date, exit_day)]
        others = (total - change) / (count - 1) if count > 1 else None
        results.append(Outcome(days[index].date, change, others, exit_day))
    return results, pending


@dataclass(frozen=True)
class Totals:
    count: int = 0
    total: float = 0.0
    rises: int = 0
    # Outcomes with a peer average, and their sums.
    compared: int = 0
    beats: int = 0
    excess: float = 0.0
    # Months of the compared events, with Σ(month's excess)², Σ(month's excess × month's count) and
    # Σ(month's count)²: enough for a standard error that treats each month as one cluster.
    months: int = 0
    month_squares: float = 0.0
    month_cross: float = 0.0
    month_counts: int = 0


class _Running:
    """Totals after each added outcome; events of the same month move together and are grouped."""

    def __init__(self):
        self.totals = Totals()
        self._months: dict[tuple[int, int], tuple[float, int]] = {}

    def add(self, item: Outcome) -> Totals:
        t = self.totals
        count, total, rises = t.count + 1, t.total + item.change, t.rises + (item.change > 0)
        if item.peers is None:
            self.totals = replace(t, count=count, total=total, rises=rises)
            return self.totals
        excess = item.change - item.peers
        month = (item.date.year, item.date.month)
        before, size = self._months.get(month, (0.0, 0))
        self._months[month] = (before + excess, size + 1)
        self.totals = replace(
            t, count=count, total=total, rises=rises, compared=t.compared + 1, beats=t.beats + (excess > 0),
            excess=t.excess + excess, months=t.months + (size == 0),
            month_squares=t.month_squares + 2 * before * excess + excess * excess,
            month_cross=t.month_cross + before + excess * (size + 1),
            month_counts=t.month_counts + 2 * size + 1,
        )
        return self.totals


def _stats(t: Totals, reading: Reading | None) -> PeriodStats:
    if not t.count:
        return PeriodStats(events=0)
    average = t.total / t.count
    vs_peers = margin = beats = None
    if t.compared:
        mean = t.excess / t.compared
        vs_peers, beats = round(mean * 100, 2), round(t.beats / t.compared, 4)
        if t.months >= 2:
            # Σ over months of (month's excess − month's count × mean)², with the usual small-sample factor.
            spread = max(t.month_squares - 2 * mean * t.month_cross + mean * mean * t.month_counts, 0.0)
            margin = round(t95(t.months - 1) * sqrt(spread * t.months / (t.months - 1)) / t.compared * 100, 2)
    return PeriodStats(
        events=t.count, months=t.months, avg_return_pct=round(average * 100, 2), up_rate=round(t.rises / t.count, 4),
        vs_peers_pct=vs_peers, vs_peers_margin_pct=margin, beat_peers_rate=beats,
        # A bearish reading means staying out, so there is no trade whose cost to subtract.
        net_return_pct=round(average * 100 - ROUND_TRIP_COST_PCT, 2) if reading == "bullish" else None,
    )


def summarize(items: list[Outcome], reading: Reading | None) -> PeriodStats:
    running = _Running()
    for item in items:
        running.add(item)
    return _stats(running.totals, reading)


class CumulativeStats:
    """Outcomes ordered by the day their window closed, so the stats known on any date are one lookup away.

    ``upto(day)`` counts only outcomes resolved on or before ``day``: an event whose window was still open
    on that day is invisible, which is what keeps a backtest from reading results it could not have had.
    """

    def __init__(self, items: list[Outcome]):
        ordered = sorted(items, key=lambda item: (item.resolved_on, item.date))
        self._dates = [item.resolved_on for item in ordered]
        running = _Running()
        self._totals = [running.totals] + [running.add(item) for item in ordered]

    def upto(self, day: date, reading: Reading | None) -> PeriodStats:
        return _stats(self._totals[bisect_right(self._dates, day)], reading)
