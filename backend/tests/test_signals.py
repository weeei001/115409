"""Signal check: detection on crossings and streaks, de-overlapped event outcomes, and the admin endpoint."""
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.db.models.benchmark_price import BenchmarkPrice
from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.stock_info import StockInfo
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.signals.detection import Day, detect, revenue_turns
from app.features.signals.evaluation import ROUND_TRIP_COST_PCT, Outcome, outcomes, summarize
from app.features.signals.service import _revenue_since
from test_admin_chat_review import credentials

START = date(2026, 1, 5)


def trading_days(count, first=START):
    days, current = [], first
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def series(closes, **columns):
    """Days with the given closes; each keyword is a list of values for that Day field."""
    return [Day(date=day, close=close, **{key: values[index] for key, values in columns.items()})
            for index, (day, close) in enumerate(zip(trading_days(len(closes)), closes))]


def test_signals_fire_once_when_the_condition_first_becomes_true():
    days = series([10, 9, 11, 12, 11, 9], ma20=[10, 10, 10, 10, 10, 10],
                  kd_k=[30, 15, 18, 85, 75, 50], kd_d=[25, 16, 16, 80, 80, 60],
                  macd_hist=[0.1, -0.2, 0.3, 0.4, -0.1, -0.2],
                  volume=[100, 100, 300, 100, 100, 100], volume_ma5=[100, 100, 120, 100, 100, 100])
    fired = detect(days)
    # 9 -> 11 crosses above the 20-day line once; staying above at 12 is not a new event.
    assert fired["ma20_up"] == [2] and fired["ma20_down"] == [1, 5]
    assert fired["kd_golden_low"] == [2], "K crossed D at 18, below 20"
    assert fired["kd_dead_high"] == [], "K crossed below D at 15 and 75, never above 80"
    assert fired["macd_turn_up"] == [2] and fired["macd_turn_down"] == [1, 4]
    assert fired["volume_breakout"] == [2], "up day with volume at least twice the 5-day average"


def test_kd_dead_cross_requires_a_high_level():
    days = series([10, 10, 10], kd_k=[85, 82, 70], kd_d=[80, 84, 75])
    assert detect(days)["kd_dead_high"] == [1]


def test_streaks_fire_on_the_exact_length_and_reset_on_gaps():
    flows = [1, 1, 1, 1, 1, 1, None, 1, 1, 1, 1, 1, -1, -1, -1, -1, -1]
    days = series([10] * len(flows), foreign_net=flows, trust_net=flows)
    fired = detect(days)
    assert fired["foreign_buy_5"] == [4, 11], "the 6th day continues the streak; a missing day restarts it"
    assert fired["trust_buy_3"] == [2, 9]
    assert fired["foreign_sell_5"] == [16]


def test_sixty_day_high_and_revenue_turn_on_the_next_trading_day():
    closes = [100] * 60 + [101, 100, 102]
    days = series(closes)
    assert detect(days)["high_60"] == [60, 62]
    friday = next(index for index, day in enumerate(days) if day.date.weekday() == 4)
    # Available on a trading day: that day. On a Saturday: the following Monday. Before or after the data: nothing.
    fired = detect(days, [days[0].date - timedelta(days=400), days[2].date,
                          days[friday].date + timedelta(days=1), days[-1].date + timedelta(days=3)])
    assert fired["revenue_yoy_up"] == [2, friday + 1]
    months = [(24312, date(2026, 2, 10), -3.0), (24313, date(2026, 3, 10), 4.0),
              (24315, date(2026, 5, 10), -1.0), (24317, date(2026, 7, 10), 2.0)]
    assert revenue_turns(months) == [date(2026, 3, 10)], "months 24315 and 24317 are not adjacent"
    # December's turn, out on 10 January, compares November with the November a year before: 14 months back.
    assert _revenue_since(date(2021, 1, 5)) == date(2019, 10, 1)
    assert _revenue_since(date(2021, 12, 31)) == date(2020, 9, 1)


def test_outcomes_skip_overlapping_windows_and_count_unfinished_ones():
    days = series([100 + index for index in range(20)])
    benchmark = [(day.date, 1000.0 + index * 2) for index, day in enumerate(days)]
    results, pending = outcomes(days, [0, 2, 5, 6, 12, 16, 17], 5, benchmark, days[0].date, days[-1].date)
    assert [item.date for item in results] == [days[0].date, days[5].date, days[12].date]
    # Day 16 is still inside day 12's window; day 17 is not, but has no 5th trading day after it yet.
    assert pending == 1
    assert results[0].change == pytest.approx(105 / 100 - 1)
    assert results[0].market == pytest.approx(1010 / 1000 - 1)
    outside, _ = outcomes(days, [0, 5], 5, benchmark, days[3].date, days[-1].date)
    assert [item.date for item in outside] == [days[5].date]
    # Unfinished events overlap like finished ones: days 16 and 18 fall inside day 15's window.
    assert outcomes(days, [15, 16, 18], 5, benchmark, days[0].date, days[-1].date) == ([], 1)


def test_summary_rates_and_cost_only_for_bullish_readings():
    items = [Outcome(START, 0.04, 0.01, START), Outcome(START, -0.02, -0.03, START), Outcome(START, 0.01, None, START)]
    bullish = summarize(items, "bullish")
    assert (bullish.events, bullish.avg_return_pct, bullish.up_rate) == (3, 1.0, 0.6667)
    assert (bullish.beat_market_rate, bullish.avg_excess_pct) == (1.0, 2.0)
    assert ROUND_TRIP_COST_PCT == 0.585 and bullish.net_return_pct == pytest.approx(0.415, abs=0.006)
    assert summarize(items, "bearish").net_return_pct is None
    assert summarize([], "bullish").model_dump() == {"events": 0, "avg_return_pct": None, "up_rate": None,
        "beat_market_rate": None, "avg_excess_pct": None, "net_return_pct": None}


def seed_market(db, symbol, closes, first=date(2024, 6, 3)):
    days = trading_days(len(closes), first)
    db.add(StockInfo(symbol=symbol, name=f"股票{symbol}"))
    for index, (day, close) in enumerate(zip(days, closes)):
        db.add(DailyPrice(symbol=symbol, date=day, close=Decimal(str(close)), volume_shares=1_000_000))
        db.add(TechnicalIndicator(symbol=symbol, date=day, ma20=Decimal("100"), volume_ma5=Decimal("1000000")))
        db.add(InstitutionalTrade(symbol=symbol, date=day, foreign_net=1000 if index % 10 < 5 else -1000))
    return days


def test_admin_signal_check_splits_periods_and_lists_recent_signals(client, db_session, settings):
    # Oscillating around the 20-day line so it is crossed in both periods.
    closes = [100 + (3 if (index // 7) % 2 else -3) + index * 0.01 for index in range(300)]
    days = seed_market(db_session, "2330", closes)
    seed_market(db_session, "2317", [50 + index * 0.1 for index in range(300)])
    db_session.add_all([BenchmarkPrice(symbol="TAIEX", date=day, close=Decimal(str(20000 + index)))
                        for index, day in enumerate(days)])
    db_session.commit()
    _, user = credentials(db_session, settings)
    _, admin = credentials(db_session, settings, admin=True)
    split = days[150].isoformat()
    params = {"start": days[0].isoformat(), "split": split, "end": days[-1].isoformat(), "horizon": 5}
    assert client.get("/admin/signal-check", params=params).status_code == 403
    assert client.get("/admin/signal-check", headers=user, params=params).status_code == 403

    response = client.get("/admin/signal-check", headers=admin, params=params)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    body = response.json()
    assert body["stock_count"] == 2 and body["symbol"] is None and body["recent"] == []
    crossing = next(item for item in body["signals"] if item["key"] == "ma20_up")
    assert crossing["discovery"]["events"] > 0 and crossing["validation"]["events"] > 0
    assert crossing["reading"] == "bullish" and crossing["discovery"]["net_return_pct"] is not None
    assert next(item for item in body["signals"] if item["key"] == "ma20_down")["discovery"]["net_return_pct"] is None
    assert body["baseline"]["discovery"]["events"] >= 2 * (150 // 5) - 2
    assert body["baseline"]["discovery"]["beat_market_rate"] is not None
    assert "不是買賣建議" in body["method_note"]

    single = client.get("/admin/signal-check", headers=admin, params={**params, "symbol": "2330"}).json()
    assert single["stock_count"] == 1
    assert all(item["date"] >= days[-10].isoformat() for item in single["recent"])
    assert client.get("/admin/signal-check", headers=admin, params={**params, "symbol": "9999"}).status_code == 404
    assert client.get("/admin/signal-check", headers=admin, params={**params, "split": params["start"]}).status_code == 422
    assert client.get("/admin/signal-check", headers=admin, params={**params, "horizon": 7}).status_code == 422


# ── 截至當日的統計：停在某天查，和把資料砍到那天再算，結果必須一樣 ──

def wavy_series(symbol_offset, count=260):
    import math
    closes = [100 + 8 * math.sin(index / 6 + symbol_offset) + index * 0.03 for index in range(count)]
    return series(closes, ma20=[100 + index * 0.03 for index in range(count)],
                  kd_k=[50 + 45 * math.sin(index / 3 + symbol_offset) for index in range(count)],
                  kd_d=[50 + 45 * math.sin((index - 1) / 3 + symbol_offset) for index in range(count)],
                  macd_hist=[math.sin(index / 5 + symbol_offset) for index in range(count)],
                  foreign_net=[1 if (index // (5 + symbol_offset)) % 2 else -1 for index in range(count)],
                  trust_net=[1 if (index // 4) % 2 else -1 for index in range(count)])


def test_point_in_time_history_equals_history_rebuilt_on_data_cut_at_that_day():
    from app.features.signals.history import SignalHistory
    stocks = {code: wavy_series(offset) for code, offset in (("1101", 0), ("2330", 2), ("2454", 5))}
    full = {code: (days, detect(days)) for code, days in stocks.items()}
    benchmark = [(day.date, 1000.0 + index * 1.5 + (index % 7)) for index, day in enumerate(stocks["2330"])]
    for horizon in (5, 20):
        history = SignalHistory(full, horizon, benchmark)
        for cut in (60, 140, 259):
            as_of = stocks["2330"][cut].date
            truncated = {code: (days[:cut + 1], detect(days[:cut + 1])) for code, days in stocks.items()}
            past = SignalHistory(truncated, horizon, [item for item in benchmark if item[0] <= as_of])
            index = history.decision_index("2330", as_of)
            assert index == cut
            assert history.baseline(as_of) == past.baseline(as_of)
            # The benchmark must also stop at the cut: an exit day's index level is only known that day.
            assert history.evidence("2330", index) == past.evidence("2330", past.decision_index("2330", as_of))
    assert any(item.all_stocks.events for item in history.evidence("2330", 259)), "the test must exercise real events"


def test_cumulative_stats_only_count_outcomes_already_resolved():
    from app.features.signals.evaluation import CumulativeStats
    days = trading_days(6)
    items = [Outcome(days[0], 0.05, 0.01, days[3]), Outcome(days[1], -0.02, None, days[4]),
             Outcome(days[2], 0.01, 0.02, days[5])]
    stats = CumulativeStats(items)
    assert stats.upto(days[2], "bullish").events == 0
    assert stats.upto(days[4], "bullish") == summarize(items[:2], "bullish")
    assert stats.upto(days[5], "bearish") == summarize(items, "bearish")


def test_admin_signal_evidence_lists_recent_signals_with_what_was_known_that_day(client, db_session, settings):
    closes = [100 + (3 if (index // 7) % 2 else -3) + index * 0.01 for index in range(200)]
    days = seed_market(db_session, "2330", closes)
    db_session.add_all([BenchmarkPrice(symbol="TAIEX", date=day, close=Decimal(str(20000 + index)))
                        for index, day in enumerate(days)])
    db_session.commit()
    _, admin = credentials(db_session, settings, admin=True)
    saturday = next(day for day in days[100:] if day.weekday() == 4) + timedelta(days=1)
    response = client.get("/admin/signal-evidence", headers=admin, params={"symbol": "2330", "as_of": saturday.isoformat()})
    assert response.status_code == 200
    body = response.json()
    assert body["decision_date"] == (saturday - timedelta(days=1)).isoformat(), "a Saturday uses Friday's close"
    assert body["items"], "the oscillating price crosses the 20-day line within any 5 trading days"
    assert [item["id"] for item in body["items"]] == [f"sg_{n:02d}" for n in range(1, len(body["items"]) + 1)]
    assert all(0 <= item["trading_days_ago"] < 5 and item["fired_on"] <= body["decision_date"] for item in body["items"])
    later = client.get("/admin/signal-evidence", headers=admin, params={"symbol": "2330", "as_of": days[-1].isoformat()}).json()
    assert later["baseline"]["events"] > body["baseline"]["events"], "more outcomes are known later"
    assert "判斷日之後才知道結果的事件一律不算" in body["method_note"]
    assert client.get("/admin/signal-evidence", headers=admin,
                      params={"symbol": "2330", "as_of": "2020-01-01"}).status_code == 404
    assert client.get("/admin/signal-evidence", params={"symbol": "2330"}).status_code == 403
