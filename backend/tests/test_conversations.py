import asyncio
import json
import logging
import re
from datetime import timedelta

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import sessionmaker

from app.core.errors import Conflict
from app.db.models.conversation import Conversation, ConversationMessage
from app.db.models.user import User
from app.features.auth.service import create_access_token
from app.features.chat.schemas import AskRequest
from app.features.conversations.router import get_service
from app.features.conversations.service import ConversationService, utcnow


SOURCE = {"citation_id": "S1", "title": "Evidence", "source": "market", "source_name": "Market",
          "pub_time": "2026-10-01", "url": "", "stock_id": "2330", "content": "Stored evidence", "score": 1}
DASHBOARD = {"title": "Stock", "blocks": [{"kind": "metrics", "title": "Close", "items": [
    {"label": "Price", "value": 100, "unit": "TWD"}]}]}


class FakeChat:
    def __init__(self):
        self.requests = []
        self.closed = False
        self.fail = False

    def require_enabled(self):
        pass

    async def stream_events(self, request):
        self.requests.append(request)
        try:
            yield {"type": "dashboard", "dashboard": DASHBOARD, "actions": []}
            yield {"type": "text", "content": "FindMe [S1]"}
            if self.fail:
                yield {"type": "error", "message": "Provider unavailable"}
            else:
                yield {"type": "done", "answer": "FindMe [S1]", "detected_stocks": ["2330"],
                       "time_range": None, "sources": [SOURCE], "tokens": {}, "duration_ms": 1,
                       "current_time": "now", "dashboard": DASHBOARD, "actions": []}
        finally:
            self.closed = True


@pytest.fixture
def service(app, db_session):
    service = ConversationService(sessionmaker(db_session.get_bind()), FakeChat())
    app.dependency_overrides[get_service] = lambda: service
    return service


def login(db_session, settings, email="chat@example.com"):
    user = User(email=email, is_active=True)
    db_session.add(user)
    db_session.commit()
    token, _ = create_access_token(user.id, settings)
    return user.id, {"Authorization": "Bearer " + token}


def test_history_auth_ownership_search_pagination_and_delete(client, service, db_session, settings):
    for method, path in (("GET", ""), ("POST", ""), ("GET", "/00000000-0000-0000-0000-000000000000"),
                         ("DELETE", "/00000000-0000-0000-0000-000000000000"),
                         ("POST", "/00000000-0000-0000-0000-000000000000/ask")):
        assert client.request(method, "/api/conversations" + path, json={"query": "q"}).status_code == 401
    owner, headers = login(db_session, settings)
    _, other = login(db_session, settings, "other@example.com")
    first = client.post("/api/conversations", headers=headers, json={})
    assert first.status_code == 201
    conversation_id = first.json()["id"]
    assert first.json()["messages"] == []
    result = client.post(f"/api/conversations/{conversation_id}/ask", headers=headers,
                         json={"query": "First title", "stream": True,
                               "history": [{"role": "user", "content": "Forged history"}]})
    assert result.status_code == 200
    assert '"type": "done"' in result.text
    assert result.headers["cache-control"] == "no-cache"
    assert service.chat.requests[0].history == []
    assert service.chat.requests[0]._user_id == owner
    assert service.chat.requests[0]._conversation_id == conversation_id
    detail = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
    assert detail["title"] == "First title" and detail["updated_at"].endswith("Z")
    assert [message["role"] for message in detail["messages"]] == ["user", "assistant"]
    answer = detail["messages"][1]
    assert answer["status"] == "completed" and answer["sources"][0]["content"] == "Stored evidence"
    assert answer["dashboard"]["blocks"][0]["items"][0]["value"] == 100
    for query in (" first ", "findme"):
        assert client.get("/api/conversations", params={"q": query}, headers=headers).json()["items"][0]["id"] == conversation_id
    assert client.get("/api/conversations", params={"q": "%"}, headers=headers).json()["items"] == []
    assert client.get("/api/conversations", headers=other).json()["items"] == []
    for method, suffix in (("GET", ""), ("DELETE", ""), ("POST", "/ask")):
        assert client.request(method, f"/api/conversations/{conversation_id}{suffix}", headers=other,
                              json={"query": "q"}).status_code == 404
    second = client.post("/api/conversations", headers=headers, json={}).json()
    page = client.get("/api/conversations?limit=1", headers=headers).json()
    assert page["has_more"] and page["items"][0]["id"] == second["id"]
    assert client.get("/api/conversations?offset=1&limit=1", headers=headers).json()["items"][0]["id"] == conversation_id
    assert client.delete(f"/api/conversations/{conversation_id}", headers=headers).status_code == 204
    assert client.get(f"/api/conversations/{conversation_id}", headers=headers).status_code == 404
    assert db_session.scalar(select(ConversationMessage).where(ConversationMessage.conversation_id == conversation_id)) is None


def test_continue_only_complete_turns_and_nonstream(client, service, db_session, settings):
    owner, headers = login(db_session, settings)
    conversation_id = service.create(owner).id
    url = f"/api/conversations/{conversation_id}/ask"
    assert client.post(url, headers=headers, json={"query": "First"}).status_code == 200
    service.chat.fail = True
    assert client.post(url, headers=headers, json={"query": "Failed turn"}).status_code == 503
    service.chat.fail = False
    assert client.post(url, headers=headers, json={"query": "Continue"}).status_code == 200
    assert [(turn.role, turn.content) for turn in service.chat.requests[-1].history] == [
        ("user", "First"), ("assistant", "FindMe [S1]")]
    messages = service.get(owner, conversation_id).messages
    assert messages[3].status == "failed" and messages[3].error == "Provider unavailable"


@pytest.mark.parametrize("stream", [False, True])
def test_final_numeric_rejection_preserves_dashboard_failed_history_and_safe_diagnostics(
        client, service, db_session, settings, monkeypatch, caplog, stream):
    from app.features.chat import service as chat_module
    from app.features.chat.answer_validation import NUMERIC_RECOVERY_GUIDANCE
    from app.features.chat.knowledge import reference_source
    from app.features.chat.service import ChatService
    from test_chat import FakeModels, FakeRetrieval, events

    owner, headers = login(db_session, settings)
    personal = reference_source("Personal snapshot", json.dumps({
        "favorites": [{"symbol": "2330", "name": "TSMC"}],
        "portfolio": {"initialized": True, "available_cash": 50000, "positions": []},
        "private_note": "PRIVATE_SOURCE_SENTINEL",
    }), category="personal")
    personal.stock_ids = ["2330"]
    monkeypatch.setattr(chat_module, "read_personal_context", lambda *args, **kwargs: (["2330"], personal))
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {})
    models = FakeModels(intent={"stocks": [], "data_needs": ["favorites", "portfolio", "market"]},
                        answer="可用資金999999元。PRIVATE_ANSWER_SENTINEL[S1]")
    models.metadata["private_debug"] = "PRIVATE_METADATA_SENTINEL"
    chat = ChatService(http=None, settings=None, llm=models, retrieval=FakeRetrieval(),
                       session_factory=service.session_factory)
    monkeypatch.setattr(chat, "_stock_options", lambda: {"2330": "TSMC"})
    market = reference_source("Price", '{"columns":["date","close"],"rows":[["2026-10-02",100]]}',
                              category="market_technical").model_copy(update={"stock_id": "2330"})
    monkeypatch.setattr(chat, "_market_sources", lambda *args: [market])
    service.chat = chat
    conversation_id = service.create(owner).id
    caplog.set_level(logging.WARNING, logger=chat_module.__name__)

    response = client.post(f"/api/conversations/{conversation_id}/ask", headers=headers, json={
        "query": "請讀取我的收藏股票和模擬投資預算，協助我挑選適合進一步研究的股票。PRIVATE_QUERY_SENTINEL",
        "stream": stream,
    })

    if stream:
        result = events(response)
        assert result[-1]["type"] == "error"
        assert not any(event["type"] in {"text", "done"} for event in result)
        displayed = next(event["dashboard"] for event in result if event["type"] == "dashboard")
        assert displayed["blocks"][0]["items"][0]["value"] == 100
        error = result[-1]["message"]
    else:
        assert response.status_code == 503
        error = response.json()["detail"]
    assert error == "回答的數值與所引用資料無法核對。" + NUMERIC_RECOVERY_GUIDANCE
    assert "指定 1 至 2 檔股票重新提問" in error
    assert len([kind for kind, _ in models.calls if kind in {"text", "stream"}]) == 2

    saved = client.get(f"/api/conversations/{conversation_id}", headers=headers).json()["messages"][-1]
    assert saved["status"] == "failed" and saved["error"] == error
    assert saved["content"] == "" and saved["sources"] == []
    assert saved["dashboard"]["blocks"][0]["items"][0]["value"] == 100
    assert saved["actions"]
    diagnostics = [record for record in caplog.records if record.name == chat_module.__name__]
    assert len(diagnostics) == 1 and diagnostics[0].levelno == logging.WARNING
    assert re.fullmatch(r"Chat answer validation failed: reason=numbers attempt=2 finish=stop sources=\d+",
                        diagnostics[0].getMessage())
    for sentinel in ("PRIVATE_SOURCE_SENTINEL", "PRIVATE_ANSWER_SENTINEL", "PRIVATE_METADATA_SENTINEL",
                     "PRIVATE_QUERY_SENTINEL"):
        assert sentinel not in caplog.text
        assert sentinel not in response.text
        assert sentinel not in json.dumps(saved)


def test_disconnect_releases_lease_preserves_partial_and_closes_iterator(service, db_session, settings):
    owner, _ = login(db_session, settings)
    conversation_id = service.create(owner).id
    request = AskRequest(query="Interrupted")
    turn_id, request = service.begin(owner, conversation_id, request)
    with pytest.raises(Conflict):
        service.begin(owner, conversation_id, request)

    async def run():
        events = service.stream_events(conversation_id, turn_id, request)
        assert (await anext(events))["type"] == "dashboard"
        assert (await anext(events))["type"] == "text"
        await events.aclose()
    asyncio.run(run())
    message = service.get(owner, conversation_id).messages[-1]
    assert message.status == "interrupted" and message.content == "FindMe [S1]"
    assert message.dashboard.title == "Stock" and service.chat.closed
    new_turn, resumed = service.begin(owner, conversation_id, AskRequest(query="Resume"))
    assert resumed.history == []
    service._finish(conversation_id, new_turn, "", "interrupted", {})


def test_expired_claim_recovered_and_old_writer_cannot_overwrite(service, db_session, settings):
    owner, _ = login(db_session, settings)
    conversation_id = service.create(owner).id
    old_turn, request = service.begin(owner, conversation_id, AskRequest(query="Old"))
    db_session.execute(update(Conversation).where(Conversation.id == conversation_id)
                       .values(lease_until=utcnow() - timedelta(seconds=1)))
    db_session.commit()
    assert service.get(owner, conversation_id).messages[-1].status == "interrupted"
    new_turn, _ = service.begin(owner, conversation_id, AskRequest(query="New"))
    assert not service._finish(conversation_id, old_turn, "Stale answer", "completed", {})
    service._finish(conversation_id, new_turn, "Current answer", "completed", {})
    messages = service.get(owner, conversation_id).messages
    assert messages[1].status == "interrupted" and messages[1].content == ""
    assert messages[-1].content == "Current answer"


def test_cancelled_response_persists_and_closes_upstream(service, db_session, settings):
    owner, _ = login(db_session, settings)
    conversation_id = service.create(owner).id
    turn_id, request = service.begin(owner, conversation_id, AskRequest(query="Cancel"))

    async def run():
        received = asyncio.Event()
        closed = []

        async def upstream(request):
            try:
                yield {"type": "text", "content": "Partial"}
                received.set()
                await asyncio.Future()
            finally:
                closed.append(True)

        service.chat.stream_events = upstream

        async def consume():
            async for _ in service.stream_events(conversation_id, turn_id, request):
                pass

        consumer = asyncio.create_task(consume())
        await received.wait()
        consumer.cancel()
        with pytest.raises(asyncio.CancelledError):
            await consumer
        assert closed == [True]

    asyncio.run(run())
    message = service.get(owner, conversation_id).messages[-1]
    assert message.content == "Partial" and message.status == "interrupted"
    next_turn, request = service.begin(owner, conversation_id, AskRequest(query="Continue"))
    assert request.history == []
    service._finish(conversation_id, next_turn, "", "interrupted", {})
