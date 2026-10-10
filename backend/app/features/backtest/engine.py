"""Backtest mechanics: five stances, preset position rules, next-open fills with costs, and scoring; pure functions."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from app.features.analysis.track_record import benchmark_change
from app.features.signals.detection import SIGNAL_BY_KEY, Day
from app.features.signals.evaluation import FEE_RATE, SELL_TAX_RATE
from app.features.signals.schemas import SignalEvidenceItem
from .schemas import CitationStats, DecisionRecord, GroupResult, Preset, Stance, TierStats

TIERS: tuple[Stance, ...] = ("bullish", "mildly_bullish", "neutral", "mildly_bearish", "bearish")
UP, DOWN = {"bullish", "mildly_bullish"}, {"mildly_bearish", "bearish"}
# Target share of the portfolio held in the stock; None keeps the current position.
PRESETS: dict[Preset, dict[Stance, float | None]] = {
    "conservative": {"bullish": 0.6, "mildly_bullish": 0.4, "neutral": None, "mildly_bearish": 0.2, "bearish": 0.0},
    "standard": {"bullish": 1.0, "mildly_bullish": 0.7, "neutral": None, "mildly_bearish": 0.3, "bearish": 0.0},
    "aggressive": {"bullish": 1.0, "mildly_bullish": 1.0, "neutral": None, "mildly_bearish": 0.5, "bearish": 0.0},
}
MIN_EVIDENCE_EVENTS = 30
FORWARD_DAYS = 5
# Holdings within this many points of the target stay as they are.
REBALANCE_BAND = 0.05


def rule_stance(evidence: list[SignalEvidenceItem]) -> tuple[Stance, list[str], str]:
    """The no-AI group: count active signals whose known history beat (or trailed) any day.

    Only signals with enough past events vote; each votes +1 if its average followed by better results
    than any day, -1 if worse. Two or more net votes is the strong stance, one is the mild one.
    """
    used = [item for item in evidence
            if item.all_stocks.events >= MIN_EVIDENCE_EVENTS and item.edge_vs_baseline_pct]
    better = sum(item.edge_vs_baseline_pct > 0 for item in used)
    score = better - (len(used) - better)
    stance = ("bullish" if score >= 2 else "mildly_bullish" if score == 1 else "neutral" if score == 0
              else "mildly_bearish" if score == -1 else "bearish")
    reason = f"證據清單中，歷史上勝過任一天進場的訊號 {better} 個、輸給的 {len(used) - better} 個"
    return stance, [item.key for item in used], reason


@dataclass
class Book:
    """Cash-only, whole shares, no shorting; fees on both sides and the sell tax are paid in cash."""
    cash: float
    shares: int = 0
    trades: int = 0
    costs: float = 0.0

    def value(self, price: float) -> float:
        return self.cash + self.shares * price

    def rebalance(self, target: float | None, price: float) -> int:
        if target is None or price <= 0:
            return 0
        value = self.value(price)
        # A repeated stance usually meets only price drift; trading back to the target every time would pile up
        # small trades and fees. Exiting to zero is always done in full.
        if target > 0 and value and abs(self.shares * price / value - target) < REBALANCE_BAND:
            return 0
        desired = int(target * value // price)
        if desired > self.shares:
            change = min(desired - self.shares, int(self.cash // (price * (1 + FEE_RATE))))
            if change <= 0:
                return 0
            fee = change * price * FEE_RATE
            self.cash -= change * price + fee
        elif desired < self.shares:
            change = desired - self.shares
            fee = -change * price * (FEE_RATE + SELL_TAX_RATE)
            self.cash += -change * price - fee
        else:
            return 0
        self.costs += fee
        self.shares += change
        self.trades += 1
        return change


@dataclass
class Simulation:
    equity: list[float]
    exposure: list[float]
    traded: dict[int, tuple[float | None, int]] = field(default_factory=dict)
    book: Book | None = None


def simulate(days: list[Day], opens: dict[date, float], first: int, last: int, stances: dict[int, Stance | None],
             preset: Preset, initial_cash: float) -> Simulation:
    """Decide at the close of each decision day, fill at the next trading day's open, mark at every close."""
    book, pending = Book(initial_cash), {}
    result = Simulation([], [], book=book)
    for index in range(first, last + 1):
        if index in pending:
            decided, target = pending.pop(index)
            price = opens.get(days[index].date) or days[index].close
            result.traded[decided] = (target, book.rebalance(target, price))
        close = days[index].close
        result.equity.append(round(book.value(close), 2))
        result.exposure.append(book.shares * close / book.value(close) if book.value(close) else 0.0)
        if index in stances and index + 1 <= last:
            stance = stances[index]
            target = PRESETS[preset][stance] if stance else None
            pending[index + 1] = (index, target)
            result.traded[index] = (target, 0)
    return result


def buy_and_hold(days: list[Day], opens: dict[date, float], first: int, last: int, initial_cash: float) -> list[float]:
    book = Book(initial_cash)
    curve = []
    for index in range(first, last + 1):
        if index == first + 1:
            book.rebalance(1.0, opens.get(days[index].date) or days[index].close)
        curve.append(round(book.value(days[index].close), 2))
    return curve


def market_curve(dates: list[date], benchmark: list[tuple[date, float]], initial_cash: float) -> list[float]:
    """The index scaled to the same starting money; a day without an index close keeps the previous level."""
    levels, cursor, level = {}, 0, None
    for day in dates:
        while cursor < len(benchmark) and benchmark[cursor][0] <= day:
            level = benchmark[cursor][1]
            cursor += 1
        levels[day] = level
    start = levels[dates[0]] if dates else None
    if not start:
        return [initial_cash for _ in dates]
    return [round(initial_cash * (levels[day] or start) / start, 2) for day in dates]


def max_drawdown(equity: list[float]) -> float:
    peak, worst = 0.0, 0.0
    for value in equity:
        peak = max(peak, value)
        if peak:
            worst = max(worst, (peak - value) / peak)
    return round(worst * 100, 2)


def forward(days: list[Day], index: int, benchmark: list[tuple[date, float]]) -> tuple[float | None, float | None]:
    if index + FORWARD_DAYS >= len(days):
        return None, None
    start, end = days[index], days[index + FORWARD_DAYS]
    return end.close / start.close - 1, benchmark_change(benchmark, start.date, end.date)


def _rate(flags: list[bool]) -> float | None:
    return round(sum(flags) / len(flags), 4) if flags else None


def _hit(stance: str | None, change: float | None) -> bool | None:
    if stance not in UP | DOWN or change is None:
        return None
    return change > 0 if stance in UP else change < 0


def score_group(key, label, records: list[DecisionRecord], simulation: Simulation, initial_cash: float,
                evidence_edges: list[dict[str, float | None]]) -> GroupResult:
    """Totals, per-stance outcomes and, for groups that use signals, how cited signals fared."""
    calls = [(record.groups[key], record) for record in records]
    tiers = []
    for stance in TIERS:
        chosen = [record for decision, record in calls if decision.stance == stance]
        changes = [record.forward_return_pct for record in chosen if record.forward_return_pct is not None]
        tiers.append(TierStats(stance=stance, count=len(chosen),
                               avg_forward_pct=round(sum(changes) / len(changes), 2) if changes else None,
                               hit_rate=_rate([_hit(stance, change / 100) for change in changes]) if stance != "neutral" else None))
    hits = [_hit(decision.stance, record.forward_return_pct / 100 if record.forward_return_pct is not None else None)
            for decision, record in calls]
    beats = [_hit(decision.stance, (record.forward_return_pct - record.market_return_pct) / 100)
             for decision, record in calls
             if record.forward_return_pct is not None and record.market_return_pct is not None]
    citations = []
    if key != "ai_plain":
        for signal_key in sorted({name for record in records for name in record.active_signals},
                                 key=lambda name: list(SIGNAL_BY_KEY).index(name)):
            available = [(decision, record, edges.get(signal_key)) for (decision, record), edges in zip(calls, evidence_edges)
                         if signal_key in record.active_signals]
            cited = [(decision, record) for decision, record, _ in available if signal_key in decision.signal_keys]
            known = [edge for _, _, edge in available if edge is not None]
            outcome = [_hit(decision.stance, record.forward_return_pct / 100 if record.forward_return_pct is not None else None)
                       for decision, record in cited]
            citations.append(CitationStats(
                key=signal_key, label=SIGNAL_BY_KEY[signal_key].label, available=len(available), cited=len(cited),
                avg_edge_pct=round(sum(known) / len(known), 2) if known else None,
                cited_hit_rate=_rate([flag for flag in outcome if flag is not None])))
    equity = simulation.equity
    book = simulation.book
    return GroupResult(
        key=key, label=label, final_value=equity[-1] if equity else initial_cash,
        total_return_pct=round((equity[-1] / initial_cash - 1) * 100, 2) if equity else 0.0,
        max_drawdown_pct=max_drawdown(equity), trades=book.trades, costs_paid=round(book.costs, 2),
        avg_exposure=round(sum(simulation.exposure) / len(simulation.exposure), 4) if simulation.exposure else 0.0,
        directional_calls=sum(flag is not None for flag in hits), hit_rate=_rate([flag for flag in hits if flag is not None]),
        beat_market_rate=_rate([flag for flag in beats if flag is not None]),
        failed_calls=sum(decision.failed for decision, _ in calls), tiers=tiers, citations=citations, equity=equity,
    )
