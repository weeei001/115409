"""Signal check: detection on crossings and streaks, de-overlapped next-open outcomes against other stocks,
month-grouped margins, and the admin endpoints."""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.stock_info import StockInfo
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.signals.detection import MIN_RANKED, Day, detect, revenue_turns, thirds
from app.features.signals.evaluation import ROUND_TRIP_COST_PCT, Outcome, outcomes, peer_windows, summarize, t95
from app.features.signals.service import _revenue_since, recent_signals, revenue_months, series_from_rows
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
    """Days with the given closes, opening at the close unless ``open`` is given; each keyword is a list of
    values for that Day field."""
    columns.setdefault("open", closes)
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


def test_revenue_counts_as_known_from_the_legal_deadline_not_the_import_day():
    # Months re-imported in 2026 carry that day as their issue date; they were public long before.
    rows = [SimpleNamespace(revenue_year=2024, revenue_month=month, revenue=100, create_time="2026-10-08")
            for month in range(1, 13)]
    rows.append(SimpleNamespace(revenue_year=2025, revenue_month=12, revenue=120, create_time="2026-10-08"))
    months = revenue_months(rows)
    assert months[0][:2] == (2024 * 12 + 1, date(2024, 2, 10))
    assert months[11][1] == date(2025, 1, 10), "December's figures are due on 10 January"
    assert months[-1][:2] == (2025 * 12 + 12, date(2026, 1, 10)) and months[-1][2] == pytest.approx(20.0)
    broken = SimpleNamespace(revenue_year=0, revenue_month=12, revenue=100, create_time=None)
    assert revenue_months(rows + [broken]) == months, "a malformed year is skipped, not a server error"


def test_thirds_rank_against_the_day_and_need_enough_stocks():
    values = {f"{1100 + n}": float(n % 5) for n in range(MIN_RANKED)}
    ranked = thirds(values)
    # Three stocks share each value; ties go by stock code, so the order of the input does not matter.
    assert sorted(code for code, third in ranked.items() if third == -1) == ["1100", "1101", "1105", "1106", "1110"]
    assert sorted(code for code, third in ranked.items() if third == 1) == ["1104", "1108", "1109", "1113", "1114"]
    assert thirds(dict(reversed(list(values.items())))) == ranked
    assert thirds(dict(list(values.items())[:MIN_RANKED - 1])) == {}, "too few stocks to call a ranking"


def ranking_rows(count=15, length=40, first=date(2025, 3, 3)):
    """Flat prices; stock n has a price-to-book of 1 + n/10 and February revenue up n% on a year before."""
    days = trading_days(length, first)
    rows = {}
    for n in range(count):
        rows[f"{1100 + n}"] = {
            "prices": [SimpleNamespace(date=day, open=Decimal("10"), close=Decimal("10"), volume_shares=1000) for day in days],
            "indicators": [], "flows": [],
            "valuations": [SimpleNamespace(date=day, pbr=Decimal(str(1 + n / 10))) for day in days],
            "revenue": [SimpleNamespace(revenue_year=2024, revenue_month=2, revenue=100, create_time=None),
                        SimpleNamespace(revenue_year=2025, revenue_month=2, revenue=100 + n, create_time=None)],
        }
    return days, rows


def test_fundamental_rankings_use_only_what_was_known_that_day():
    days, rows = ranking_rows()
    series = series_from_rows(rows, list(rows))
    published = next(index for index, day in enumerate(days) if day >= date(2025, 3, 10))
    stale = next(index for index, day in enumerate(days) if (day - date(2025, 3, 10)).days > 45)
    low, middle, high = (series[code][0] for code in ("1100", "1107", "1114"))
    assert (low[0].pbr_third, middle[0].pbr_third, high[0].pbr_third) == (-1, 0, 1)
    assert low[published - 1].revenue_third is None, "February's figures are not due until 10 March"
    assert (low[published].revenue_third, high[published].revenue_third) == (-1, 1)
    assert high[stale].revenue_third is None, "a month whose deadline is over 45 days old no longer ranks"
    fired = series["1114"][1]
    assert fired["revenue_top"] == list(range(published, stale)) and fired["pbr_high"] == list(range(len(days)))
    assert series["1100"][1]["pbr_low"] == list(range(len(days))) and not series["1100"][1]["revenue_top"]
    # Cutting every table at a day leaves the rankings up to that day unchanged.
    cut = published + 3
    truncated = {code: {**tables, "prices": tables["prices"][:cut + 1], "valuations": tables["valuations"][:cut + 1]}
                 for code, tables in rows.items()}
    assert {code: days_[:cut + 1] for code, (days_, _) in series.items()} == \
        {code: days_ for code, (days_, _) in series_from_rows(truncated, list(rows)).items()}
    fewer = series_from_rows({code: rows[code] for code in list(rows)[:MIN_RANKED - 1]}, list(rows)[:MIN_RANKED - 1])
    assert all(day.pbr_third is None for days_, _ in fewer.values() for day in days_)
    # A ranking holds every day, so the recent list shows it once, on its latest day.
    recent = recent_signals(*series["1114"])
    assert [(item.key, item.date) for item in recent] == [("pbr_high", days[-1].isoformat()),
                                                          ("revenue_top", days[stale - 1].isoformat())]


def test_outcomes_skip_overlapping_windows_and_count_unfinished_ones():
    days = series([100 + index for index in range(20)])
    others = [series([200 + 2 * index for index in range(20)]), series([50.0] * 20)]
    peers = peer_windows([days, *others], 5)
    results, pending = outcomes(days, [0, 2, 5, 6, 12, 16, 17], 5, peers, days[0].date, days[-1].date)
    assert [item.date for item in results] == [days[0].date, days[5].date, days[12].date]
    # Day 16 is still inside day 12's window; day 17 is not, but has no 5th trading day after it yet.
    assert pending == 1
    # Bought at day 1's open, not day 0's close; sold at day 5's close.
    assert results[0].change == pytest.approx(105 / 101 - 1) and results[0].resolved_on == days[5].date
    assert results[0].peers == pytest.approx((210 / 202 - 1 + 0) / 2), "the other two stocks, not this one"
    outside, _ = outcomes(days, [0, 5], 5, peers, days[3].date, days[-1].date)
    assert [item.date for item in outside] == [days[5].date]
    # Unfinished events overlap like finished ones: days 16 and 18 fall inside day 15's window.
    assert outcomes(days, [15, 16, 18], 5, peers, days[0].date, days[-1].date) == ([], 1)
    alone = outcomes(days, [0], 5, peer_windows([days], 5), days[0].date, days[-1].date)[0]
    assert alone[0].peers is None, "no other stock to compare with"


def test_an_event_without_a_next_day_open_is_left_out():
    closes = [100 + index for index in range(12)]
    days = series(closes, open=[None if index == 1 else close for index, close in enumerate(closes)])
    results, pending = outcomes(days, [0, 6], 5, peer_windows([days], 5), days[0].date, days[-1].date)
    assert [item.date for item in results] == [days[6].date] and pending == 0


def test_summary_rates_and_cost_only_for_bullish_readings():
    items = [Outcome(START, 0.04, 0.01, START), Outcome(START, -0.02, -0.03, START), Outcome(START, 0.01, None, START)]
    bullish = summarize(items, "bullish")
    assert (bullish.events, bullish.avg_return_pct, bullish.up_rate) == (3, 1.0, 0.6667)
    assert (bullish.beat_peers_rate, bullish.vs_peers_pct, bullish.months) == (1.0, 2.0, 1)
    assert bullish.vs_peers_margin_pct is None, "one month gives no spread to measure"
    assert ROUND_TRIP_COST_PCT == 0.585 and bullish.net_return_pct == pytest.approx(0.415, abs=0.006)
    assert summarize(items, "bearish").net_return_pct is None
    assert summarize([], "bullish").model_dump() == {"events": 0, "months": 0, "avg_return_pct": None, "up_rate": None,
        "vs_peers_pct": None, "vs_peers_margin_pct": None, "beat_peers_rate": None, "net_return_pct": None}


def test_margin_treats_each_month_as_one_group():
    january, february, march = date(2026, 1, 12), date(2026, 2, 9), date(2026, 3, 9)
    # Excess over peers: January +1% and +3%, February -2%, March +4%.
    items = [Outcome(january, 0.02, 0.01, january), Outcome(january + timedelta(days=1), 0.03, 0.0, january),
             Outcome(february, -0.01, 0.01, february), Outcome(march, 0.05, 0.01, march)]
    stats = summarize(items, "bullish")
    assert (stats.vs_peers_pct, stats.months) == (1.5, 3)
    # Each month's sum minus its count times the mean: 0.04 - 2 * 0.015, -0.02 - 0.015, 0.04 - 0.015.
    spread = (0.01 ** 2 + 0.035 ** 2 + 0.025 ** 2) * 3 / 2
    # Three months: Student's t with 2 degrees of freedom, not the normal 1.96.
    assert stats.vs_peers_margin_pct == pytest.approx(4.303 * spread ** 0.5 / 4 * 100, abs=0.006)
    assert summarize(items[::-1], "bullish") == stats, "the order outcomes arrive in does not matter"
    # Taken as four independent months, the same numbers would claim a narrower range.
    apart = [Outcome(day, item.change, item.peers, day)
             for day, item in zip((january, february, march, date(2026, 4, 13)), items)]
    assert summarize(apart, "bullish").vs_peers_margin_pct < stats.vs_peers_margin_pct


def test_t_critical_values_shrink_toward_the_normal_one():
    assert (t95(1), t95(5), t95(30)) == (12.706, 2.571, 2.042)
    assert t95(31) == pytest.approx(2.0395, abs=0.0005) and t95(120) == pytest.approx(1.9799, abs=0.0005)
    assert t95(10_000) == pytest.approx(1.96, abs=0.001)


def seed_market(db, symbol, closes, first=date(2024, 6, 3)):
    days = trading_days(len(closes), first)
    db.add(StockInfo(symbol=symbol, name=f"股票{symbol}"))
    for index, (day, close) in enumerate(zip(days, closes)):
        db.add(DailyPrice(symbol=symbol, date=day, open=Decimal(str(close)), close=Decimal(str(close)),
                          volume_shares=1_000_000))
        db.add(TechnicalIndicator(symbol=symbol, date=day, ma20=Decimal("100"), volume_ma5=Decimal("1000000")))
        db.add(InstitutionalTrade(symbol=symbol, date=day, foreign_net=1000 if index % 10 < 5 else -1000))
    return days


def test_admin_signal_check_splits_periods_and_lists_recent_signals(client, db_session, settings):
    # Oscillating around the 20-day line so it is crossed in both periods.
    closes = [100 + (3 if (index // 7) % 2 else -3) + index * 0.01 for index in range(300)]
    days = seed_market(db_session, "2330", closes)
    seed_market(db_session, "2317", [50 + index * 0.1 for index in range(300)])
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
    # Each crossing is compared with the other stock over the same days; the steady riser beats it more often.
    assert crossing["discovery"]["vs_peers_pct"] < 0 and crossing["discovery"]["beat_peers_rate"] < 0.5
    assert crossing["discovery"]["months"] >= 2 and crossing["discovery"]["vs_peers_margin_pct"] > 0
    assert "不是買賣建議" in body["method_note"]

    single = client.get("/admin/signal-check", headers=admin, params={**params, "symbol": "2330"}).json()
    assert single["stock_count"] == 1
    alone = next(item for item in single["signals"] if item["key"] == "ma20_up")
    assert alone["discovery"] == crossing["discovery"], "one stock is still compared with the whole list"
    assert all(item["date"] >= days[-10].isoformat() for item in single["recent"])
    assert client.get("/admin/signal-check", headers=admin, params={**params, "symbol": "9999"}).status_code == 404
    assert client.get("/admin/signal-check", headers=admin, params={**params, "split": params["start"]}).status_code == 422
    assert client.get("/admin/signal-check", headers=admin, params={**params, "horizon": 7}).status_code == 422


# ── 截至當日的統計：停在某天查，和把資料砍到那天再算，結果必須一樣 ──

def wavy_series(symbol_offset, count=260):
    import math
    closes = [100 + 8 * math.sin(index / 6 + symbol_offset) + index * 0.03 for index in range(count)]
    return series(closes, open=[close + math.cos(index + symbol_offset) for index, close in enumerate(closes)],
                  ma20=[100 + index * 0.03 for index in range(count)],
                  kd_k=[50 + 45 * math.sin(index / 3 + symbol_offset) for index in range(count)],
                  kd_d=[50 + 45 * math.sin((index - 1) / 3 + symbol_offset) for index in range(count)],
                  macd_hist=[math.sin(index / 5 + symbol_offset) for index in range(count)],
                  foreign_net=[1 if (index // (5 + symbol_offset)) % 2 else -1 for index in range(count)],
                  trust_net=[1 if (index // 4) % 2 else -1 for index in range(count)])


def test_point_in_time_history_equals_history_rebuilt_on_data_cut_at_that_day():
    from app.features.signals.history import SignalHistory
    stocks = {code: wavy_series(offset) for code, offset in (("1101", 0), ("2330", 2), ("2454", 5))}
    full = {code: (days, detect(days)) for code, days in stocks.items()}
    for horizon in (5, 20):
        history = SignalHistory(full, horizon)
        for cut in (60, 140, 259):
            as_of = stocks["2330"][cut].date
            truncated = {code: (days[:cut + 1], detect(days[:cut + 1])) for code, days in stocks.items()}
            past = SignalHistory(truncated, horizon)
            index = history.decision_index("2330", as_of)
            assert index == cut
            assert history.baseline(as_of) == past.baseline(as_of)
            # Other stocks' windows must also stop at the cut: they close on the same day as the event's.
            assert history.evidence("2330", index) == past.evidence("2330", past.decision_index("2330", as_of))
    assert any(item.all_stocks.events and item.all_stocks.vs_peers_margin_pct
               for item in history.evidence("2330", 259)), "the test must exercise real events"


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
    seed_market(db_session, "2317", [50 + index * 0.1 for index in range(200)])
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
    assert any(item["all_stocks"]["vs_peers_pct"] is not None for item in body["items"])
    later = client.get("/admin/signal-evidence", headers=admin, params={"symbol": "2330", "as_of": days[-1].isoformat()}).json()
    assert later["baseline"]["events"] > body["baseline"]["events"], "more outcomes are known later"
    assert "判斷日之後才知道結果的事件一律不算" in body["method_note"]
    assert client.get("/admin/signal-evidence", headers=admin,
                      params={"symbol": "2330", "as_of": "2020-01-01"}).status_code == 404
    assert client.get("/admin/signal-evidence", params={"symbol": "2330"}).status_code == 403
