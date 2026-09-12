import asyncio
import json
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.clients.llm import LlmResult
from app.core.errors import AppError
from app.db.models.daily_price import DailyPrice
from app.features.simulation.engine import FEE_RATE, TAX_RATE, Portfolio, compute_metrics
from app.features.simulation.repository import load_inputs
from app.features.simulation.schemas import Decision, SimulationRequest


def request(**changes):
    return SimulationRequest(**{"symbol": "2330", "start": "2025-01-02",
                                "end": "2025-01-03", "initial_cash": "10000.01", **changes})


def inputs():
    return {"prices": [{"date": "2025-01-02", "close": "100.00"},
                       {"date": "2025-01-03", "close": "110.00"}], "digests": []}


class FakeLlm:
    model_name = "simulation-test-model"

    def __init__(self, fail=False):
        self.calls = []
        self.fail = fail

    def require_enabled(self):
        pass

    async def generate(self, **kwargs):
        self.calls.append(kwargs)
        if self.fail:
            raise AppError("Provider unavailable", 503)
        decision = Decision(action="buy" if len(self.calls) % 2 else "sell",
                            buy_pct=1, sell_pct=1, reason="Test decision")
        return LlmResult(payload=decision.model_dump(), raw_text="", metadata={})


def collect(service, simulation_request, data):
    async def run():
        return [event async for event in service.events(simulation_request, data)]
    return asyncio.run(run())


def test_whole_share_fees_cash_and_profitable_sell_win_rate():
    initial = Decimal("10000.01")
    portfolio = Portfolio(initial)
    buy = portfolio.apply(Decision(action="buy", buy_pct=1, sell_pct=0, reason="Buy"), Decimal(100))
    assert buy["executed_shares"] == 99
    assert portfolio.cash == initial - 99 * Decimal(100) * (1 + FEE_RATE)
    assert 0 <= portfolio.cash < Decimal(100) * (1 + FEE_RATE)
    sell = portfolio.apply(Decision(action="sell", buy_pct=0, sell_pct=1, reason="Sell"), Decimal(110))
    assert portfolio.cash == initial - 9900 * (1 + FEE_RATE) + 10890 * (1 - FEE_RATE - TAX_RATE)
    assert portfolio.shares == 0
    metrics = compute_metrics([buy, sell], initial, portfolio)
    assert metrics["trade_count"] == 2
    assert metrics["sell_count"] == 1
    assert metrics["win_rate_pct"] == 100
    assert metrics["realized_pnl"] > 0


@pytest.mark.parametrize("changes", [{"confidence": 0}, {"confidence": 11},
    {"initial_cash": "NaN"}, {"initial_cash": "Infinity"}, {"initial_cash": "9999"},
    {"initial_cash": "10000.001"}, {"start": "2025-01-03"}, {"symbol": "../2330"}])
def test_request_rejects_invalid_inputs(changes):
    with pytest.raises(ValidationError):
        request(**changes)


def test_events_replay_typed_init_and_invalidate_cache(settings, tmp_path):
    from app.features.simulation.service import SimulationService

    settings = settings.model_copy(update={"SIMULATION_CACHE_DIR": tmp_path})
    llm = FakeLlm()
    service = SimulationService(settings, None, llm=llm)
    first = collect(service, request(), inputs())
    assert [event["type"] for event in first] == ["init", "day", "day", "done"]
    assert len(llm.calls) == 2
    cached = collect(service, request(), inputs())
    assert cached[0]["type"] == "init"
    assert cached[0]["cached"] is True
    assert len(llm.calls) == 2
    collect(service, request(confidence=6), inputs())
    collect(service, request(initial_cash="10000.02"), inputs())
    changed = inputs()
    changed["prices"][-1]["close"] = "111.00"
    collect(service, request(), changed)
    assert len(llm.calls) == 8
    settings.LLM_MODEL = "other-model"
    collect(service, request(), inputs())
    assert len(llm.calls) == 10
    settings.LLM_TEMPERATURE = 0.7
    collect(service, request(), inputs())
    assert len(llm.calls) == 12


def test_daily_payload_excludes_future_evidence_and_limits_snapshots():
    from app.features.simulation.service import build_daily_payload

    data = inputs()
    dates = ["2024-12-01", "2024-12-08", "2024-12-15", "2024-12-22", "2025-01-02", "2025-01-03"]
    data["digests"] = [{"as_of_date": day, "digest_json": {"overall": day}, "news_json": [
        {"pub_time": "2025-01-01 10:00:00", "title": "Available news"},
        {"pub_time": "2025-01-03 10:00:00", "title": "Future news"},
        {"title": "Undated news"},
    ]} for day in dates]
    payload = build_daily_payload(request(), data, "2025-01-02", Portfolio(Decimal(10000)))
    assert payload["closes"] == [100.0]
    assert [row["as_of_date"] for row in payload["weekly_digests"]] == dates[1:-1]
    assert payload["digest_as_of_date"] == "2025-01-02"
    assert [row["title"] for row in payload["news"]] == ["Available news"]


def test_failed_model_holds_without_caching(settings, tmp_path):
    from app.features.simulation.service import SimulationService

    settings = settings.model_copy(update={"SIMULATION_CACHE_DIR": tmp_path})
    llm = FakeLlm(fail=True)
    service = SimulationService(settings, None, llm=llm)
    events = collect(service, request(), inputs())
    assert [event["type"] for event in events] == ["init", "day", "day", "done"]
    assert all(event["action"] == "hold" for event in events if event["type"] == "day")
    previous_calls = len(llm.calls)
    collect(service, request(), inputs())
    assert len(llm.calls) > previous_calls
    assert not list(tmp_path.glob("*.json"))


def test_repository_limits_price_and_digest_dates(db_session, app, client, settings, tmp_path):
    db_session.add_all([DailyPrice(symbol="2330", date=date.fromisoformat(day), close=Decimal(100))
                        for day in ["2024-10-01", "2024-12-30", "2025-01-02", "2025-01-03", "2025-01-06"]])
    db_session.execute(text("CREATE TABLE analysis_digests (stock_id TEXT, period TEXT, "
                            "as_of_date TEXT, news_json TEXT, digest_json TEXT)"))
    dates = ["2024-11-01", "2024-12-01", "2024-12-08", "2024-12-15", "2024-12-22",
             "2025-01-02", "2025-01-06"]
    for day in dates:
        db_session.execute(text("INSERT INTO analysis_digests VALUES "
                                "('2330', 'week', :day, '[]', '{}')"), {"day": day})
    db_session.commit()
    data = load_inputs(db_session, request())
    assert [row["date"] for row in data["prices"]] == ["2024-12-30", "2025-01-02", "2025-01-03"]
    assert [row["as_of_date"] for row in data["digests"]] == dates[1:-1]
    with pytest.raises(AppError):
        load_inputs(db_session, request(end="2025-01-07"))
    from app.features.simulation.router import get_service
    from app.features.simulation.service import SimulationService

    service = SimulationService(settings.model_copy(update={"SIMULATION_CACHE_DIR": tmp_path}), None, llm=FakeLlm())
    app.dependency_overrides[get_service] = lambda: service
    response = client.get("/api/simulate_trading_stream", params={
        "start": "2025-01-02", "end": "2025-01-03", "initial_cash": "10000.01"})
    assert response.status_code == 200
    events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line]
    assert [event["type"] for event in events] == ["init", "day", "day", "done"]
    assert events[1]["digest_as_of_date"] == "2025-01-02"


def test_http_stream_and_cached_replay(app, client, settings, tmp_path):
    from app.features.simulation.router import get_inputs, get_service
    from app.features.simulation.service import SimulationService

    llm = FakeLlm()
    service = SimulationService(settings.model_copy(update={"SIMULATION_CACHE_DIR": tmp_path}), None, llm=llm)
    app.dependency_overrides[get_inputs] = lambda: (request(), inputs())
    app.dependency_overrides[get_service] = lambda: service
    for cached in (False, True):
        response = client.get("/api/simulate_trading_stream")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert response.headers["cache-control"] == "no-cache"
        assert response.headers["x-accel-buffering"] == "no"
        events = [json.loads(line.removeprefix("data: ")) for line in response.text.splitlines() if line]
        assert [event["type"] for event in events] == ["init", "day", "day", "done"]
        assert events[0]["cached"] is cached
    assert len(llm.calls) == 2


@pytest.mark.parametrize("changes", [{"confidence": "11"}, {"initial_cash": "NaN"},
                                    {"start": "2025-01-03"}, {"end": "invalid-date"}])
def test_http_rejects_invalid_query(client, changes):
    response = client.get("/api/simulate_trading_stream", params={
        "symbol": "2330", "start": "2025-01-02", "end": "2025-01-03", **changes})
    assert response.status_code == 422


def test_closing_generator_stops_model_calls_and_cache(settings, tmp_path):
    from app.features.simulation.service import SimulationService

    llm = FakeLlm()
    service = SimulationService(settings.model_copy(update={"SIMULATION_CACHE_DIR": tmp_path}), None, llm=llm)

    async def run():
        events = service.events(request(), inputs())
        assert (await anext(events))["type"] == "init"
        assert (await anext(events))["type"] == "day"
        await events.aclose()

    asyncio.run(run())
    assert len(llm.calls) == 1
    assert not list(tmp_path.glob("*.json"))
