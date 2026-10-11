"""Standard, explainable signals detected on one stock's trading days; pure functions, no database access.

Crossings, turns and streaks fire on the day the condition first becomes true (a streak on reaching its
length), not on every day it stays true. A 60-day high, a volume breakout and the fundamental rankings fire
on every day they hold; the event study skips windows that overlap, so a run of them still counts once per
window. The rankings compare a stock with the others on the same day, so they are set by ``thirds`` across
stocks before detection.
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from datetime import date
from typing import Literal

Reading = Literal["bullish", "bearish"]


@dataclass(frozen=True)
class Signal:
    key: str
    label: str
    definition: str
    # The conventional reading of the signal, used only to say which outcome would agree with it.
    reading: Reading
    source: str


SIGNALS: tuple[Signal, ...] = (
    Signal("ma20_up", "站上月線", "收盤由 20 日均線以下轉為高於 20 日均線", "bullish", "價格與均線"),
    Signal("ma20_down", "跌破月線", "收盤由 20 日均線以上轉為低於 20 日均線", "bearish", "價格與均線"),
    Signal("ma60_up", "站上季線", "收盤由 60 日均線以下轉為高於 60 日均線", "bullish", "價格與均線"),
    Signal("ma60_down", "跌破季線", "收盤由 60 日均線以上轉為低於 60 日均線", "bearish", "價格與均線"),
    Signal("high_60", "收盤創 60 日新高", "收盤高於前 60 個交易日的最高收盤", "bullish", "價格與均線"),
    Signal("volume_breakout", "帶量上漲", "收盤上漲，且成交量達 5 日均量 2 倍以上", "bullish", "成交量"),
    Signal("kd_golden_low", "KD 低檔黃金交叉", "K 值由下往上穿越 D 值，且交叉時 K 值低於 20", "bullish", "技術指標"),
    Signal("kd_dead_high", "KD 高檔死亡交叉", "K 值由上往下穿越 D 值，且交叉時 K 值高於 80", "bearish", "技術指標"),
    Signal("macd_turn_up", "MACD 柱狀體翻正", "MACD 柱狀體由 0 以下轉為正值", "bullish", "技術指標"),
    Signal("macd_turn_down", "MACD 柱狀體翻負", "MACD 柱狀體由 0 以上轉為負值", "bearish", "技術指標"),
    Signal("foreign_buy_5", "外資連續買超 5 日", "外資連續第 5 個交易日買超", "bullish", "法人籌碼"),
    Signal("foreign_sell_5", "外資連續賣超 5 日", "外資連續第 5 個交易日賣超", "bearish", "法人籌碼"),
    Signal("trust_buy_3", "投信連續買超 3 日", "投信連續第 3 個交易日買超", "bullish", "法人籌碼"),
    Signal("revenue_yoy_up", "月營收年增率轉正", "月營收年增率由 0 以下轉為正值；以法定公布期限（次月 10 日）當天計", "bullish", "月營收"),
    Signal("revenue_top", "月營收年增率排前 1/3", "最新已公布的月營收年增率，在當天有資料的股票裡排最高的三分之一", "bullish", "月營收"),
    Signal("revenue_bottom", "月營收年增率排後 1/3", "最新已公布的月營收年增率，在當天有資料的股票裡排最低的三分之一", "bearish", "月營收"),
    Signal("pbr_low", "股價淨值比排後 1/3", "股價淨值比在當天有資料的股票裡排最低的三分之一（相對便宜）", "bullish", "估值"),
    Signal("pbr_high", "股價淨值比排前 1/3", "股價淨值比在當天有資料的股票裡排最高的三分之一（相對昂貴）", "bearish", "估值"),
)
SIGNAL_BY_KEY = {signal.key: signal for signal in SIGNALS}
# Signals that hold on every day their condition does, rather than firing when it first becomes true.
RANKINGS = frozenset({"revenue_top", "revenue_bottom", "pbr_low", "pbr_high"})
HIGH_LOOKBACK = 60
# Fewer stocks with a value that day and a third is too few to call a ranking.
MIN_RANKED = 15


@dataclass(frozen=True)
class Day:
    date: date
    close: float
    # The earliest fill for a signal seen at the previous close.
    open: float | None = None
    volume: float | None = None
    ma20: float | None = None
    ma60: float | None = None
    kd_k: float | None = None
    kd_d: float | None = None
    macd_hist: float | None = None
    volume_ma5: float | None = None
    foreign_net: float | None = None
    trust_net: float | None = None
    pbr: float | None = None
    # Third of the stocks ranked that day: 1 highest, -1 lowest, 0 middle; None when not ranked.
    pbr_third: int | None = None
    revenue_third: int | None = None


def thirds(values: dict[str, float]) -> dict[str, int]:
    """Each stock's third on one day: 1 for the highest third of ``values``, -1 the lowest, 0 the rest.

    Ties are broken by stock code so the result does not depend on input order. Empty when fewer than
    ``MIN_RANKED`` stocks have a value.
    """
    if len(values) < MIN_RANKED:
        return {}
    ordered = sorted(values, key=lambda code: (values[code], code))
    size = len(ordered) // 3
    return {code: -1 if rank < size else 1 if rank >= len(ordered) - size else 0
            for rank, code in enumerate(ordered)}


def _crossed_above(previous_a, previous_b, a, b) -> bool:
    return None not in (previous_a, previous_b, a, b) and previous_a <= previous_b and a > b


def _crossed_below(previous_a, previous_b, a, b) -> bool:
    return None not in (previous_a, previous_b, a, b) and previous_a >= previous_b and a < b


def detect(days: list[Day], revenue_turns: list[date] = ()) -> dict[str, list[int]]:
    """Indexes into ``days`` where each signal fires.

    ``revenue_turns`` are the dates a positive year-on-year revenue month became available after a
    non-positive one; each fires on the first trading day on or after that date. Turns before the first
    loaded day are dropped: that day is not when the market learned of them.
    """
    fired: dict[str, list[int]] = {signal.key: [] for signal in SIGNALS}
    streaks = {"foreign_buy": 0, "foreign_sell": 0, "trust_buy": 0}
    for index, day in enumerate(days):
        streaks["foreign_buy"] = streaks["foreign_buy"] + 1 if day.foreign_net is not None and day.foreign_net > 0 else 0
        streaks["foreign_sell"] = streaks["foreign_sell"] + 1 if day.foreign_net is not None and day.foreign_net < 0 else 0
        streaks["trust_buy"] = streaks["trust_buy"] + 1 if day.trust_net is not None and day.trust_net > 0 else 0
        for key, streak, length in (("foreign_buy_5", "foreign_buy", 5), ("foreign_sell_5", "foreign_sell", 5),
                                    ("trust_buy_3", "trust_buy", 3)):
            if streaks[streak] == length:
                fired[key].append(index)
        for key, third, wanted in (("revenue_top", day.revenue_third, 1), ("revenue_bottom", day.revenue_third, -1),
                                   ("pbr_low", day.pbr_third, -1), ("pbr_high", day.pbr_third, 1)):
            if third == wanted:
                fired[key].append(index)
        if index == 0:
            continue
        previous = days[index - 1]
        for key, attribute in (("ma20", "ma20"), ("ma60", "ma60")):
            if _crossed_above(previous.close, getattr(previous, attribute), day.close, getattr(day, attribute)):
                fired[f"{key}_up"].append(index)
            if _crossed_below(previous.close, getattr(previous, attribute), day.close, getattr(day, attribute)):
                fired[f"{key}_down"].append(index)
        if _crossed_above(previous.kd_k, previous.kd_d, day.kd_k, day.kd_d) and day.kd_k < 20:
            fired["kd_golden_low"].append(index)
        if _crossed_below(previous.kd_k, previous.kd_d, day.kd_k, day.kd_d) and day.kd_k > 80:
            fired["kd_dead_high"].append(index)
        if previous.macd_hist is not None and day.macd_hist is not None:
            if previous.macd_hist <= 0 < day.macd_hist:
                fired["macd_turn_up"].append(index)
            if previous.macd_hist >= 0 > day.macd_hist:
                fired["macd_turn_down"].append(index)
        if (day.close > previous.close and day.volume is not None and day.volume_ma5
                and day.volume >= 2 * day.volume_ma5):
            fired["volume_breakout"].append(index)
        if index >= HIGH_LOOKBACK and day.close > max(item.close for item in days[index - HIGH_LOOKBACK:index]):
            fired["high_60"].append(index)
    dates = [day.date for day in days]
    for available in revenue_turns:
        index = bisect_left(dates, available)
        if dates and dates[0] <= available and index < len(days):
            fired["revenue_yoy_up"].append(index)
    fired["revenue_yoy_up"] = sorted(set(fired["revenue_yoy_up"]))
    return fired


def revenue_turns(months: list[tuple[int, date, float | None]]) -> list[date]:
    """Availability dates of months whose year-on-year growth turned positive.

    ``months`` are (year * 12 + month, availability date, yoy %) in period order; only adjacent
    months are compared, so a missing month or yoy breaks the comparison instead of skipping over it.
    """
    turns = []
    for (previous_period, _, previous), (period, available, current) in zip(months, months[1:]):
        if (period == previous_period + 1 and previous is not None and current is not None
                and previous <= 0 < current):
            turns.append(available)
    return turns
