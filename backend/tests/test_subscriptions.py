from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import sessionmaker

from app.db.models.conversation import Conversation
from app.db.models.favorite_stock import FavoriteStock
from app.db.models.stock_info import StockInfo
from app.db.models.subscription import AiAskUsage, UserSubscription
from app.db.models.user import User
from app.features.auth.service import create_access_token
from app.features.conversations.router import get_service
from app.features.conversations.service import ConversationService
from app.features.subscriptions.plans import add_months, ask_resets_at, taipei_today
from app.features.subscriptions.service import AskQuota, AskQuotaExceeded
from test_conversations import FakeChat


def login(db, settings, email="plan@example.com", plan=None, billing="monthly"):
    user = User(email=email, is_active=True)
    db.add(user)
    db.flush()
    if plan:
        db.add(UserSubscription(user_id=user.id, plan=plan, billing=billing, started_on=date(2026, 10, 1)))
    db.commit()
    token, _ = create_access_token(user.id, settings)
    return user.id, {"Authorization": "Bearer " + token}


@pytest.fixture
def conversations(app, db_session):
    service = ConversationService(sessionmaker(db_session.get_bind()), FakeChat())
    app.dependency_overrides[get_service] = lambda: service
    return service


def test_guest_status_uses_the_free_guest_quota(client):
    body = client.get("/subscription").json()
    assert body["plan"] == "free" and body["signed_in"] is False and body["subscription"] is None
    assert body["ask"]["per"] == "day" and body["ask"]["limit"] == 3 and body["ask"]["guest"] is True
    assert body["ask"]["used"] == 0 and body["ask"]["remaining"] == 3
    assert body["limits"] == {"favorites": 10, "compare": 5, "history_days": 30, "push": False}
    assert body["favorites_used"] is None
    assert client.get("/subscription", headers={"Authorization": "Bearer broken"}).status_code == 401


def test_demo_activation_switches_plan_and_cancel_returns_to_free(client, db_session, settings):
    user_id, headers = login(db_session, settings)
    assert client.put("/subscription", json={"plan": "plus", "billing": "monthly"}).status_code == 403
    free = client.get("/subscription", headers=headers).json()
    assert free["plan"] == "free" and free["ask"]["limit"] == 5 and free["ask"]["guest"] is False
    assert free["favorites_used"] == 0

    plus = client.put("/subscription", headers=headers, json={"plan": "plus", "billing": "yearly"}).json()
    today = taipei_today()
    assert plus["plan"] == "plus" and plus["subscription"]["billing"] == "yearly"
    assert plus["subscription"]["started_on"] == today.isoformat()
    assert plus["subscription"]["renews_on"] == add_months(today, 12).isoformat()
    assert plus["ask"] == {**plus["ask"], "per": "month", "limit": 300}
    assert plus["limits"] == {"favorites": None, "compare": 30, "history_days": None, "push": True}

    db_session.execute(update(UserSubscription).values(started_on=date(2026, 1, 31)))
    db_session.commit()
    same = client.put("/subscription", headers=headers, json={"plan": "plus", "billing": "yearly"}).json()
    assert same["subscription"]["started_on"] == "2026-01-31"
    pro = client.put("/subscription", headers=headers, json={"plan": "pro", "billing": "monthly"}).json()
    assert pro["plan"] == "pro" and pro["ask"]["limit"] == 1000 and pro["subscription"]["started_on"] == today.isoformat()
    assert client.put("/subscription", headers=headers, json={"plan": "free", "billing": "monthly"}).status_code == 422

    assert client.delete("/subscription", headers=headers).json()["plan"] == "free"
    assert db_session.get(UserSubscription, user_id) is None


def test_member_quota_blocks_after_limit_and_failed_answers_are_returned(client, conversations, db_session, settings):
    user_id, headers = login(db_session, settings)
    conversation_id = conversations.create(user_id).id
    url = f"/api/conversations/{conversation_id}/ask"
    conversations.chat.fail = True
    assert client.post(url, headers=headers, json={"query": "fails"}).status_code == 503
    conversations.chat.fail = False
    for i in range(5):
        assert client.post(url, headers=headers, json={"query": f"q{i}"}).status_code == 200
    asked = len(conversations.chat.requests)
    blocked = client.post(url, headers=headers, json={"query": "one more"})
    assert blocked.status_code == 429
    assert "5 次" in blocked.json()["detail"] and int(blocked.headers["Retry-After"]) > 0
    assert len(conversations.chat.requests) == asked
    status = client.get("/subscription", headers=headers).json()["ask"]
    assert status["used"] == 5 and status["remaining"] == 0

    client.put("/subscription", headers=headers, json={"plan": "plus", "billing": "monthly"})
    assert client.post(url, headers=headers, json={"query": "after upgrade"}).status_code == 200


def test_quota_refunds_requests_rejected_before_answering(client, conversations, db_session, settings):
    _, headers = login(db_session, settings)
    missing = "/api/conversations/00000000-0000-0000-0000-000000000000/ask"
    for _ in range(6):
        assert client.post(missing, headers=headers, json={"query": "q"}).status_code == 404
    assert client.get("/subscription", headers=headers).json()["ask"]["used"] == 0


def test_guest_and_monthly_quotas(db_session):
    factory = sessionmaker(db_session.get_bind(), expire_on_commit=False)
    now = datetime(2026, 10, 31, 15, 59, tzinfo=timezone.utc)  # 23:59 in Taipei
    guest = AskQuota(factory, "guest:a", now=lambda: now)
    for _ in range(3):
        with guest.reserve():
            pass
    with pytest.raises(AskQuotaExceeded) as exceeded:
        with guest.reserve():
            pass
    assert exceeded.value.status_code == 429 and exceeded.value.headers["Retry-After"] == "60"
    with AskQuota(factory, "guest:b", now=lambda: now).reserve():
        pass

    user = User(email="monthly@example.com", is_active=True)
    db_session.add(user)
    db_session.flush()
    db_session.add_all([UserSubscription(user_id=user.id, plan="plus", billing="monthly", started_on=date(2026, 10, 1)),
                        AiAskUsage(subject=f"user:{user.id}", day=date(2026, 10, 1), count=200),
                        AiAskUsage(subject=f"user:{user.id}", day=date(2026, 9, 30), count=500)])
    db_session.commit()
    subject = f"user:{user.id}"
    member = AskQuota(factory, subject, user.id, now=lambda: now)
    for _ in range(100):
        with member.reserve():
            pass
    with pytest.raises(AskQuotaExceeded):
        with member.reserve():
            pass
    with AskQuota(factory, subject, user.id, now=lambda: now + timedelta(minutes=2)).reserve():
        pass
    assert db_session.scalar(select(AiAskUsage.count).where(
        AiAskUsage.subject == subject, AiAskUsage.day == date(2026, 11, 1))) == 1


def test_favorite_limit_follows_the_plan(client, db_session, settings):
    user_id, headers = login(db_session, settings)
    db_session.add_all([StockInfo(symbol=str(2300 + i), name=f"Stock {i}") for i in range(12)])
    db_session.commit()
    for i in range(10):
        assert client.put(f"/favorites/{2300 + i}", headers=headers).status_code == 200
    assert client.put("/favorites/2300", headers=headers).status_code == 200
    blocked = client.put("/favorites/2310", headers=headers)
    assert blocked.status_code == 403 and "10 檔" in blocked.json()["detail"]
    assert client.get("/subscription", headers=headers).json()["favorites_used"] == 10

    client.put("/subscription", headers=headers, json={"plan": "plus", "billing": "monthly"})
    assert client.put("/favorites/2310", headers=headers).status_code == 200
    client.delete("/subscription", headers=headers)
    # Downgrading keeps existing favorites but stops new ones.
    assert len(client.get("/favorites/", headers=headers).json()["items"]) == 11
    assert client.put("/favorites/2311", headers=headers).status_code == 403
    assert db_session.scalar(select(FavoriteStock).where(FavoriteStock.symbol == "2311")) is None


def test_free_plan_hides_conversations_older_than_30_days(client, conversations, db_session, settings):
    user_id, headers = login(db_session, settings)
    old, recent = conversations.create(user_id).id, conversations.create(user_id).id
    db_session.execute(update(Conversation).where(Conversation.id == old)
                       .values(updated_at=datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=31)))
    db_session.commit()
    assert [item["id"] for item in client.get("/api/conversations", headers=headers).json()["items"]] == [recent]
    assert client.get(f"/api/conversations/{old}", headers=headers).status_code == 404

    client.put("/subscription", headers=headers, json={"plan": "plus", "billing": "monthly"})
    assert {item["id"] for item in client.get("/api/conversations", headers=headers).json()["items"]} == {old, recent}
    assert client.get(f"/api/conversations/{old}", headers=headers).status_code == 200


def test_calendar_helpers_use_taipei_time_and_month_ends():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2026, 11, 30), 3) == date(2027, 2, 28)
    assert taipei_today(datetime(2026, 10, 31, 16, tzinfo=timezone.utc)) == date(2026, 11, 1)
    assert ask_resets_at("day", date(2026, 10, 31)) == datetime(2026, 10, 31, 16, tzinfo=timezone.utc)
    assert ask_resets_at("month", date(2026, 12, 15)) == datetime(2026, 12, 31, 16, tzinfo=timezone.utc)
