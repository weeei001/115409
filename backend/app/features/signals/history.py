"""Point-in-time signal history: what was known about each signal at the close of any given day.

Built once from full data, then queried for many decision dates; every query only sees events whose
window had closed by that date, so the result equals what the same query would return on data cut at
that date (tests check this).
"""
from __future__ import annotations

from bisect import bisect_right
from datetime import date

from .detection import SIGNALS, Day
from .evaluation import CumulativeStats, outcomes
from .schemas import SignalEvidenceItem

StockSeries = tuple[list[Day], dict[str, list[int]]]


class SignalHistory:
    def __init__(self, series: dict[str, StockSeries], horizon: int, benchmark: list[tuple[date, float]]):
        self.series, self.horizon = series, horizon
        pooled: dict[str, list] = {signal.key: [] for signal in SIGNALS}
        baseline: list = []
        self._own: dict[tuple[str, str], CumulativeStats] = {}
        for symbol, (days, fired) in series.items():
            if not days:
                continue
            first, last = days[0].date, days[-1].date
            for signal in SIGNALS:
                results, _ = outcomes(days, fired[signal.key], horizon, benchmark, first, last)
                pooled[signal.key].extend(results)
                self._own[(signal.key, symbol)] = CumulativeStats(results)
            baseline.extend(outcomes(days, list(range(len(days))), horizon, benchmark, first, last)[0])
        self._pooled = {key: CumulativeStats(items) for key, items in pooled.items()}
        self._baseline = CumulativeStats(baseline)

    def decision_index(self, symbol: str, as_of: date) -> int | None:
        days = self.series[symbol][0]
        index = bisect_right(days, as_of, key=lambda day: day.date) - 1
        return index if index >= 0 else None

    def baseline(self, day: date):
        return self._baseline.upto(day, "bullish")

    def evidence(self, symbol: str, index: int) -> list[SignalEvidenceItem]:
        """Signals that fired on this stock within the last ``horizon`` trading days up to ``index``.

        A signal from three days ago is still inside its own window, so it is still relevant to a
        decision today; the statistics are those known on the decision day, not on the day it fired.
        """
        days, fired = self.series[symbol]
        decision = days[index].date
        base = self.baseline(decision)
        found = []
        for order, signal in enumerate(SIGNALS):
            recent = [hit for hit in fired[signal.key] if index - self.horizon < hit <= index]
            if not recent:
                continue
            pooled = self._pooled[signal.key].upto(decision, signal.reading)
            edge = (round(pooled.avg_return_pct - base.avg_return_pct, 2)
                    if pooled.avg_return_pct is not None and base.avg_return_pct is not None else None)
            found.append((index - recent[-1], order, signal, days[recent[-1]].date, pooled, edge))
        found.sort(key=lambda item: (item[0], item[1]))
        return [SignalEvidenceItem(
            id=f"sg_{number:02d}", key=signal.key, label=signal.label, definition=signal.definition,
            reading=signal.reading, source=signal.source, fired_on=fired_on.isoformat(), trading_days_ago=ago,
            all_stocks=pooled, this_stock=self._own[(signal.key, symbol)].upto(decision, signal.reading),
            edge_vs_baseline_pct=edge,
        ) for number, (ago, _, signal, fired_on, pooled, edge) in enumerate(found, 1)]
