"""AI backtest: fills and costs, next-open execution, the rule group's vote, anonymized model input, and the stream."""
import json
from datetime import date, timedelta
from decimal import Decimal

import pytest

from app.clients.llm import LlmResult
from app.core.errors import ServiceUnavailable
from app.db.models.benchmark_price import BenchmarkPrice
from app.db.models.daily_price import DailyPrice
from app.db.models.institutional_trade import InstitutionalTrade
from app.db.models.market_extra import MonthlyRevenue
from app.db.models.stock_info import StockInfo
from app.db.models.technical_indicator import TechnicalIndicator
from app.features.backtest import engine, prompts
from app.features.signals.schemas import PeriodStats, SignalEvidenceItem
from test_admin_chat_review import credentials
from test_signals import series, trading_days


def test_book_pays_fees_and_tax_and_never_spends_cash_it_lacks():
    book = engine.Book(100_000)
    assert book.rebalance(None, 50) == 0, "neutral keeps the position"
    assert book.rebalance(1.0, 100) == 998, "1,000 shares would need 100,142.5 with the fee"
    assert book.cash == pytest.approx(100_000 - 99_800 * 1.001425)
    assert book.rebalance(0.0, 110) == -998
    assert book.cash == pytest.approx(100_000 - 99_800 * 1.001425 + 109_780 * (1 - 0.001425 - 0.003))
    assert (book.shares, book.trades) == (0, 2)
    assert book.costs == pytest.approx(99_800 * 0.001425 + 109_780 * 0.004425)


def test_book_leaves_small_drift_from_the_target_alone_but_always_exits_in_full():
    book = engine.Book(100_000)
    assert book.rebalance(0.7, 100) == 700
    assert book.rebalance(0.7, 103) == 0, "drifted to about 71%: within 5 points of the target"
    assert book.rebalance(0.7, 130) == -49, "drifted to about 75%: trimmed back to 70%"
    book.rebalance(0.03, 130)
    assert 0 < book.shares * 130 / book.value(130) < engine.REBALANCE_BAND
    assert book.rebalance(0.0, 130) < 0 and book.shares == 0, "a zero target sells even a small remainder"


def test_decisions_at_the_close_fill_at_the_next_open():
    days = series([100, 100, 110, 120, 120, 120])
    opens = {days[2].date: 105.0}
    run = engine.simulate(days, opens, 0, 5, {1: "bullish", 4: "neutral", 5: "bearish"}, "standard", 10_000)
    assert run.traded[1] == (1.0, 95), "filled at day 2's open of 105, not day 1's close"
    assert run.equity[:2] == [10_000, 10_000] and run.equity[2] == pytest.approx(10_000 - 95 * 105 * 1.001425 + 95 * 110, abs=0.01)
    assert run.traded[4] == (None, 0), "neutral does not trade"
    assert 5 not in run.traded, "the last decision has no next trading day in range"
    assert run.exposure[0] == 0 and run.exposure[3] > 0.99


def evidence_item(key, events, edge, number=1):
    stats = PeriodStats(events=events, avg_return_pct=0.5)
    return SignalEvidenceItem(id=f"sg_{number:02d}", key=key, label=key, definition="", reading="bullish", source="",
                              fired_on="2026-01-05", trading_days_ago=0, all_stocks=stats, this_stock=PeriodStats(events=0),
                              edge_vs_baseline_pct=edge)


def test_rule_group_votes_with_known_edges_of_well_sampled_signals():
    votes = [evidence_item("ma20_up", 120, 0.3), evidence_item("foreign_buy_5", 80, 0.1, 2),
             evidence_item("kd_dead_high", 10, -2.0, 3), evidence_item("ma60_down", 90, None, 4)]
    stance, used, reason = engine.rule_stance(votes)
    assert (stance, used) == ("bullish", ["ma20_up", "foreign_buy_5"]), "thin and unknown edges do not vote"
    assert reason == "證據清單中，歷史上勝過任一天進場的訊號 2 個、輸給的 0 個"
    assert engine.rule_stance([evidence_item("ma20_down", 50, -0.2)])[0] == "mildly_bearish"
    assert engine.rule_stance([])[:2] == ("neutral", [])


def test_model_input_has_no_code_name_or_dates_and_only_published_revenue():
    days = series([800 + index for index in range(30)], ma20=[790.0] * 30)
    revenue = [(24300, days[5].date, 3.0), (24301, days[20].date, 12.5), (24302, days[29].date + timedelta(days=5), 40.0)]
    payload = prompts.snapshot(days, 25, revenue)
    text = json.dumps(payload, ensure_ascii=False)
    assert all(day.date.isoformat() not in text for day in days) and "800" not in text
    assert [row["t"] for row in payload["daily"]] == list(range(-19, 1))
    assert payload["daily"][0]["close"] == 100 and payload["daily"][-1]["close"] == pytest.approx(825 / 806 * 100, abs=0.01)
    assert payload["revenue_yoy_pct"] == [{"m": -1, "yoy": 3.0}, {"m": 0, "yoy": 12.5}], "next month is not out yet"
    rich = prompts.with_evidence(payload, PeriodStats(events=900, avg_return_pct=0.3), [evidence_item("ma20_up", 120, 0.3)])
    assert "fired_on" not in json.dumps(rich) and rich["signal_evidence"]["signals"][0]["id"] == "sg_01"


class FakeModel:
    """Plain group always mildly bullish; the evidence group bearish, citing its first id and one made-up id."""
    model_name = "fake-model"
    payloads: list = []
    fail = False

    def __init__(self, settings=None, http=None):
        pass

    def require_enabled(self):
        if FakeModel.fail == "disabled":
            raise ServiceUnavailable("model off")

    async def generate(self, *, system_prompt, payload, schema, examples=()):
        FakeModel.payloads.append(payload)
        if FakeModel.fail is True or (FakeModel.fail == "plain" and "signal_evidence" not in payload):
            raise ServiceUnavailable("down")
        if "signal_evidence" in payload:
            ids = [item["id"] for item in payload["signal_evidence"]["signals"]][:1] + ["sg_99"]
            answer = {"stance": "bearish", "evidence_ids": ids, "reason": "訊號偏弱。"}
        else:
            answer = {"stance": "mildly_bullish", "evidence_ids": [], "reason": "價格在均線上。"}
        return LlmResult(answer, json.dumps(answer), {})


def seed(db, symbol, count=400):
    days = trading_days(count, date(2024, 1, 2))
    db.add(StockInfo(symbol=symbol, name=f"股票{symbol}"))
    for index, day in enumerate(days):
        close = Decimal(str(round(100 + (4 if (index // 7) % 2 else -4) + index * 0.05, 2)))
        db.add(DailyPrice(symbol=symbol, date=day, open=close - Decimal("0.5"), close=close, volume_shares=1_000_000))
        db.add(TechnicalIndicator(symbol=symbol, date=day, ma20=Decimal("100") + Decimal(index) * Decimal("0.05"),
                                  volume_ma5=Decimal("1000000")))
        db.add(InstitutionalTrade(symbol=symbol, date=day, foreign_net=1000 if index % 12 < 6 else -1000))
    db.add(MonthlyRevenue(symbol=symbol, date=date(2024, 3, 10), revenue=100, revenue_year=2024, revenue_month=2))
    return days


@pytest.fixture
def market(db_session, settings, tmp_path, monkeypatch):
    days = seed(db_session, "2330")
    seed(db_session, "2317")
    db_session.add_all([BenchmarkPrice(symbol="TAIEX", date=day, close=Decimal(str(20000 + index)))
                        for index, day in enumerate(days)])
    db_session.commit()
    settings.SIMULATION_CACHE_DIR = tmp_path
    monkeypatch.setattr("app.features.admin.router.LlmClient", FakeModel)
    FakeModel.payloads, FakeModel.fail = [], False
    return days


def stream(client, headers, **params):
    response = client.get("/admin/ai-backtest/stream", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ")]


def test_stream_runs_three_groups_caches_the_result_and_hides_identity_from_the_model(client, db_session, settings, market):
    _, admin = credentials(db_session, settings, admin=True)
    params = {"symbol": "2330", "start": market[260].isoformat(), "end": market[360].isoformat()}
    assert client.get("/admin/ai-backtest/result", headers=admin, params=params).status_code == 404

    events = stream(client, admin, **params)
    assert events[0] == {"type": "init", "symbol": "2330", "decisions": 21, "groups": ["rule", "ai_plain", "ai_signals"],
                         "llm_calls": 42, "cached": False}
    assert [event["done"] for event in events if event["type"] == "progress"] == list(range(1, 22))
    result = events[-1]["result"]
    assert events[-1]["type"] == "done" and len(FakeModel.payloads) == 42
    text = json.dumps(FakeModel.payloads, ensure_ascii=False)
    assert "2330" not in text and "股票2330" not in text and "2024-" not in text, "the model never sees code, name or dates"

    groups = {group["key"]: group for group in result["groups"]}
    assert groups["ai_signals"]["trades"] == 0 and groups["ai_signals"]["avg_exposure"] == 0, "bearish from cash stays in cash"
    assert groups["ai_plain"]["trades"] >= 1 and groups["ai_plain"]["avg_exposure"] > 0.5
    assert {tier["stance"]: tier["count"] for tier in groups["ai_plain"]["tiers"]}["mildly_bullish"] == 21
    assert len(result["dates"]) == len(result["buy_and_hold"]) == len(result["market_index"]) == len(groups["rule"]["equity"])
    first = result["decisions"][0]
    assert first["execution_date"] == market[261].isoformat()
    assert all(key in first["active_signals"] for key in first["groups"]["ai_signals"]["signal_keys"]), "sg_99 was dropped"
    cited = {item["key"]: item for item in groups["ai_signals"]["citations"]}
    assert cited and all(item["cited"] <= item["available"] for item in cited.values())
    assert groups["ai_plain"]["citations"] == []

    again = stream(client, admin, **params)
    assert again[0]["cached"] is True and len(FakeModel.payloads) == 42, "the same conditions replay without the model"
    stored = client.get("/admin/ai-backtest/result", headers=admin, params=params)
    assert stored.status_code == 200 and stored.json()["groups"][0]["key"] == "rule"

    # Tomorrow's data lies past every close the result read, so the cache survives the daily update.
    later = market[-1] + timedelta(days=7)
    db_session.add_all([DailyPrice(symbol=code, date=later, open=Decimal("99"), close=Decimal("100"),
                                   volume_shares=1) for code in ("2330", "2317")]
                       + [BenchmarkPrice(symbol="TAIEX", date=later, close=Decimal("20000"))])
    db_session.commit()
    assert client.get("/admin/ai-backtest/result", headers=admin, params=params).status_code == 200
    # History it did read changed (on another stock, inside the range): the stored result is stale.
    db_session.delete(db_session.get(DailyPrice, {"symbol": "2317", "date": market[300]}))
    db_session.commit()
    assert client.get("/admin/ai-backtest/result", headers=admin, params=params).status_code == 404


def test_rule_only_runs_without_the_model_and_failures_are_not_cached(client, db_session, settings, market):
    _, admin = credentials(db_session, settings, admin=True)
    params = {"symbol": "2330", "start": market[300].isoformat(), "end": market[340].isoformat()}
    FakeModel.fail = "disabled"
    rule_only = stream(client, admin, **params, ai="false")
    assert rule_only[0]["groups"] == ["rule"] and rule_only[0]["llm_calls"] == 0 and not FakeModel.payloads
    assert [group["key"] for group in rule_only[-1]["result"]["groups"]] == ["rule"]

    assert stream(client, admin, **params)[-1] == {"type": "error", "message": "model off"}
    FakeModel.fail = "plain"
    failed = stream(client, admin, **params)[-1]["result"]
    assert {group["key"]: group["failed_calls"] for group in failed["groups"]} == {"rule": 0, "ai_plain": 9, "ai_signals": 0}
    assert failed["decisions"][0]["groups"]["ai_plain"]["stance"] is None
    assert stream(client, admin, **params)[0]["cached"] is False, "a run with failed calls is not replayed"

    # Every AI group failing on three decision days in a row stops the run instead of paying for the rest.
    FakeModel.fail, FakeModel.payloads = True, []
    stopped = stream(client, admin, **params)
    assert [event["type"] for event in stopped] == ["init", "progress", "progress", "progress", "error"]
    assert stopped[-1]["message"].startswith("模型連續 3 次判斷都沒有回覆")
    assert len(FakeModel.payloads) == 3 * 2 * 2, "three days, two groups, one retry each"


def test_backtest_validates_access_and_range(client, db_session, settings, market):
    _, user = credentials(db_session, settings)
    _, admin = credentials(db_session, settings, admin=True)
    params = {"symbol": "2330", "start": market[260].isoformat(), "end": market[300].isoformat()}
    assert client.get("/admin/ai-backtest/stream", headers=user, params=params).status_code == 403
    assert client.get("/admin/ai-backtest/stream", headers=admin, params={**params, "symbol": "9999"}).status_code == 404
    assert client.get("/admin/ai-backtest/stream", headers=admin,
                      params={**params, "start": params["end"]}).status_code == 422
    assert client.get("/admin/ai-backtest/stream", headers=admin,
                      params={**params, "start": market[0].isoformat(), "end": market[-1].isoformat()}).status_code == 200
    assert client.get("/admin/ai-backtest/stream", headers=admin, params={**params, "preset": "yolo"}).status_code == 422
