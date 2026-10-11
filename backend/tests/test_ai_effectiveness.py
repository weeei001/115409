"""AI effectiveness: text-brief track record against later closes, and chat answer feedback."""
import json
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.orm import sessionmaker

from app.db.models.chat_feedback import ChatMessageFeedback
from app.db.models.daily_price import DailyPrice
from app.db.models.llm_response import LLM_RESPONSE_KIND_TEXT_BRIEF, LlmResponse
from app.features.analysis import track_record as tr
from app.features.conversations.router import get_service
from app.features.conversations.service import ConversationService
from test_admin_chat_review import credentials
from test_conversations import FakeChat


START = date(2026, 1, 5)


def trading_days(count):
    days, current = [], START
    while len(days) < count:
        if current.weekday() < 5:
            days.append(current)
        current += timedelta(days=1)
    return days


def add_prices(db, symbol, closes):
    days = trading_days(len(closes))
    db.add_all([DailyPrice(symbol=symbol, date=day, close=close) for day, close in zip(days, closes)])
    return days


def add_brief(db, symbol, as_of, *, short="bullish", swing="neutral", medium="bearish",
              created=None, purpose="production", status="verified", fallback=False):
    response = {"symbol": symbol, "as_of_date": as_of.isoformat(), "status": status, "brief": {
        "overall_stance": short, "forward_views": {
            "short_1_5": {"stance": short}, "swing_6_20": {"stance": swing}, "medium_21_40": {"stance": medium}}}}
    db.add(LlmResponse(symbol=symbol, as_of_date=as_of, kind=LLM_RESPONSE_KIND_TEXT_BRIEF, config_hash="h",
                       config_json=json.dumps({"purpose": purpose}), is_fallback=fallback,
                       response_json=json.dumps(response),
                       created_at=created or datetime.combine(as_of, datetime.min.time()) + timedelta(hours=18)))


def test_track_record_scores_only_live_directional_calls_against_later_closes(client, db_session):
    # Prices rise for 30 sessions, then fall: a short bullish call hits and a 40-day bearish call is judged too.
    days = add_prices(db_session, "2330", [100 + i for i in range(30)] + [129 - 3 * i for i in range(30)])
    add_brief(db_session, "2330", days[0])                                  # short hit, swing no call, medium judged
    add_brief(db_session, "2330", days[1], short="bearish")                 # short miss
    add_brief(db_session, "2330", days[1], short="bullish")                 # newer row for the same day wins
    add_brief(db_session, "2330", days[2], created=datetime.combine(days[2], datetime.min.time()) + timedelta(days=30))
    add_brief(db_session, "2330", days[3], purpose="evaluation")
    add_brief(db_session, "2330", days[4], status="unavailable")
    add_brief(db_session, "2330", days[5], fallback=True)
    add_brief(db_session, "2330", days[55])                                 # too recent to score
    db_session.commit()

    result = tr.track_record(db_session, symbol="2330", days=365, today=days[-1])
    assert result.snapshot_count == 3
    short, swing, medium = result.horizons
    assert (short.directional_calls, short.hits, short.hit_rate, short.pending) == (2, 2, 1.0, 1)
    assert short.up_baseline_rate == 1.0
    assert (swing.directional_calls, swing.no_call, swing.hit_rate) == (0, 2, None)
    # Day 0 to day 40 closes: 100 -> 99, so the bearish 40-day call is a hit.
    assert (medium.directional_calls, medium.hits) == (2, 2)
    assert result.recent[0].as_of_date == days[55].isoformat()
    assert [outcome.result for outcome in result.recent[-1].outcomes] == ["hit", "no_call", "hit"]
    assert result.recent[-1].outcomes[0].return_pct == 5.0

    response = client.get("/analyze/stock-behavior/track-record",
                          params={"symbol": "2330", "days": 730})
    assert response.status_code == 200
    assert {item["horizon"] for item in response.json()["horizons"]} == {"short_1_5", "swing_6_20", "medium_21_40"}
    assert "過去表現不代表未來結果" in response.json()["method_note"]
    assert client.get("/analyze/stock-behavior/track-record", params={"symbol": "x;drop"}).status_code == 422
    assert client.get("/analyze/stock-behavior/track-record", params={"days": 5}).status_code == 422


def test_track_record_without_prices_is_pending_not_scored(db_session):
    add_brief(db_session, "2317", START)
    db_session.commit()
    result = tr.track_record(db_session, symbol=None, days=365, today=START + timedelta(days=90))
    assert result.snapshot_count == 1
    assert all(item.directional_calls == 0 and item.hit_rate is None and item.pending == 1
               for item in result.horizons)


def test_later_rerun_does_not_hide_the_live_brief_for_the_same_day(db_session):
    days = add_prices(db_session, "2330", [100 + i for i in range(10)])
    add_brief(db_session, "2330", days[0])
    add_brief(db_session, "2330", days[0], short="bearish",
              created=datetime.combine(days[0], datetime.min.time()) + timedelta(days=30))
    db_session.commit()
    result = tr.track_record(db_session, symbol="2330", days=365, today=days[-1])
    assert result.snapshot_count == 1
    assert result.recent[0].outcomes[0].stance == "bullish"
    assert (result.horizons[0].directional_calls, result.horizons[0].hits) == (1, 1)


@pytest.fixture
def conversations(app, db_session):
    service = ConversationService(sessionmaker(db_session.get_bind()), FakeChat())
    app.dependency_overrides[get_service] = lambda: service
    return service


def test_owner_rates_completed_answers_and_admin_sees_summary(client, conversations, db_session, settings):
    _, headers = credentials(db_session, settings)
    _, other = credentials(db_session, settings)
    conversation_id = client.post("/api/conversations", headers=headers, json={}).json()["id"]
    assert client.post(f"/api/conversations/{conversation_id}/ask", headers=headers,
                       json={"query": "台積電近況"}).status_code == 200
    user_message, answer = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()["messages"]
    assert answer["feedback"] is None
    url = f"/api/conversations/{conversation_id}/messages/{answer['id']}/feedback"

    assert client.put(url, json={"rating": "up"}).status_code == 401
    assert client.put(url, headers=other, json={"rating": "up"}).status_code == 404
    assert client.put(url, headers=headers, json={"rating": "meh"}).status_code == 422
    user_url = f"/api/conversations/{conversation_id}/messages/{user_message['id']}/feedback"
    assert client.put(user_url, headers=headers, json={"rating": "up"}).status_code == 404

    assert client.put(url, headers=headers, json={"rating": "up"}).json() == {"message_id": answer["id"], "rating": "up"}
    assert client.put(url, headers=headers, json={"rating": "down"}).status_code == 200
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
    assert detail["messages"][1]["feedback"] == "down"

    _, admin_headers = credentials(db_session, settings, admin=True)
    assert client.get("/admin/ai-feedback", headers=headers).status_code == 403
    summary = client.get("/admin/ai-feedback", headers=admin_headers).json()
    assert summary["ready"] and summary["completed_answers"] == 1
    assert (summary["rated"], summary["helpful"], summary["unhelpful"], summary["helpful_rate"]) == (1, 0, 1, 0.0)
    assert summary["recent_unhelpful"][0]["answer_excerpt"].startswith("FindMe")

    assert client.delete(url, headers=headers).json() == {"message_id": answer["id"], "rating": None}
    assert client.get(f"/api/conversations/{conversation_id}", headers=headers).json()["messages"][1]["feedback"] is None
    client.put(url, headers=headers, json={"rating": "up"})
    assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 204
    assert db_session.scalar(select(ChatMessageFeedback)) is None


def usage_row(db, *, metadata, latency_ms, fallback=False, age_days=0):
    db.add(LlmResponse(symbol="2330", as_of_date=START, kind=LLM_RESPONSE_KIND_TEXT_BRIEF, config_hash="h",
                       config_json="{}", is_fallback=fallback, latency_ms=latency_ms,
                       normalized_json=json.dumps({"payload": {}, "model_metadata": metadata}),
                       created_at=datetime.utcnow() - timedelta(days=age_days)))


def test_admin_sees_brief_tokens_latency_and_estimated_cost(client, db_session, settings):
    usage_row(db_session, latency_ms=3000, metadata={"prompt_tokens": 600, "completion_tokens": 120,
              "usage_total": {"prompt_tokens": 1000, "completion_tokens": 200}, "validation_attempts": 2})
    # Saved before retries were summed: only the last call's usage is known.
    usage_row(db_session, latency_ms=1000, metadata={"prompt_tokens": 800, "completion_tokens": 100,
                                                     "validation_attempts": 1})
    usage_row(db_session, latency_ms=None, metadata={"validation_attempts": 2}, fallback=True)
    # Two calls but no total (one went unreported): the last call alone would understate the cost.
    usage_row(db_session, latency_ms=None, metadata={"prompt_tokens": 500, "completion_tokens": 50,
                                                     "validation_attempts": 2})
    usage_row(db_session, latency_ms=9000, metadata={"prompt_tokens": 9, "completion_tokens": 9}, age_days=40)
    db_session.commit()
    _, headers = credentials(db_session, settings)
    _, admin = credentials(db_session, settings, admin=True)
    assert client.get("/admin/ai-usage").status_code == 403
    assert client.get("/admin/ai-usage", headers=headers).status_code == 403

    response = client.get("/admin/ai-usage", headers=admin)
    assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
    usage = response.json()
    assert (usage["briefs"], usage["unavailable"], usage["measured"]) == (4, 1, 2)
    assert (usage["avg_prompt_tokens"], usage["avg_completion_tokens"]) == (900.0, 150.0)
    assert usage["avg_latency_seconds"] == 2.0 and usage["retry_rate"] == pytest.approx(0.75)
    # (1000 × 0.20 + 200 × 1.20) / 1e6 and (800 × 0.20 + 100 × 1.20) / 1e6 at the default prices.
    assert (usage["input_price_per_m"], usage["output_price_per_m"]) == (0.2, 1.2)
    assert usage["avg_cost_usd"] == pytest.approx(0.00036) and usage["total_cost_usd"] == pytest.approx(0.0007)
    empty = client.get("/admin/ai-usage", headers=admin, params={"days": 1}).json()
    assert empty["briefs"] == 4
    assert client.get("/admin/ai-usage", headers=admin, params={"days": 0}).status_code == 422
