"""Exercise SSE over real loopback TCP; providers and the database are disposable."""
import asyncio
import json
import socket
import threading
import time
from types import SimpleNamespace

import httpx
import pytest
import uvicorn
from fastapi import FastAPI
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.clients.llm import LlmResult
from app.core.errors import UpstreamTimeout, install_error_handlers
from app.db.base import Base
from app.db.models.conversation import Conversation
from app.db.models.daily_price import DailyPrice
from app.db.models.user import User
from app.db.models.stock_info import StockInfo
from app.features.auth.service import create_access_token
from app.features.chat import service as chat_module
from app.features.chat.router import get_service, router as chat_router
from app.features.chat.schemas import ChatDashboard
from app.features.chat.service import ChatService
from app.features.conversations.router import router as conversations_router
from test_chat import ANSWER, MODEL_ANSWER, NOW, FakeModels, FakeRetrieval


class Gate:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.release.set()

    async def wait(self):
        self.entered.set()
        while not self.release.is_set():
            await asyncio.sleep(0.005)


class GatedModels(FakeModels):
    def __init__(self):
        super().__init__()
        self.intent_gate, self.answer_gate, self.repair_gate = Gate(), Gate(), Gate()
        self.stream_closed = threading.Event()

    async def generate(self, **kwargs):
        await self.intent_gate.wait()
        return await super().generate(**kwargs)

    async def stream_text(self, **kwargs):
        self.stream_closed.clear()
        try:
            yield SimpleNamespace(text=self.answer[:8], metadata={})
            await self.answer_gate.wait()
            if self.error:
                raise self.error
            yield SimpleNamespace(text=self.answer[8:], metadata=self.metadata)
        finally:
            self.stream_closed.set()

    async def text(self, **kwargs):
        await self.repair_gate.wait()
        return LlmResult({}, MODEL_ANSWER, self.metadata)


class GatedRetrieval(FakeRetrieval):
    def __init__(self):
        super().__init__()
        self.gate = Gate()

    async def search_question(self, *args, **kwargs):
        await self.gate.wait()
        return await super().search_question(*args, **kwargs)


def wait_until(predicate):
    # This is a failure deadline, not an assertion about expected network latency.
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, "Local SSE server did not reach the expected state"
        time.sleep(0.005)


@pytest.fixture
def live_chat(tmp_path, settings, monkeypatch):
    monkeypatch.setattr(chat_module, "taipei_now", lambda: NOW)
    engine = create_engine(f"sqlite:///{(tmp_path / 'chat.sqlite').as_posix()}",
                           connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(engine, expire_on_commit=False)
    with factory() as db, db.begin():
        user = User(email="tcp-chat@example.com", is_active=True)
        db.add(user)
        db.add_all([StockInfo(symbol="2330", name="TSMC"), StockInfo(symbol="2317", name="Foxconn")])
        db.add_all([DailyPrice(symbol=symbol, date=NOW.date(), open=100, high=110, low=95, close=105,
                               volume_shares=1000) for symbol in ("2330", "2317")])
        db.flush()
        token, _ = create_access_token(user.id, settings)
    models, retrieval = GatedModels(), GatedRetrieval()
    service = ChatService(http=None, settings=settings, llm=models, intent_llm=models,
                          retrieval=retrieval, session_factory=factory)
    app = FastAPI()
    app.state.settings, app.state.session_factory = settings, factory
    install_error_handlers(app)
    app.include_router(chat_router)
    app.include_router(conversations_router)
    app.dependency_overrides[get_service] = lambda: service
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    port = listener.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, lifespan="off", ws="none",
                                           log_level="error", access_log=False, timeout_graceful_shutdown=2))
    thread = threading.Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
    thread.start()
    try:
        wait_until(lambda: server.started)
        with httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=5, trust_env=False) as client:
            yield SimpleNamespace(client=client, models=models, retrieval=retrieval, factory=factory,
                                  headers={"Authorization": f"Bearer {token}"})
    finally:
        for gate in (models.intent_gate, models.answer_gate, models.repair_gate, retrieval.gate):
            gate.release.set()
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            server.force_exit = True
            thread.join(timeout=5)
        listener.close()
        engine.dispose()
        assert not thread.is_alive(), "SSE test server failed to shut down"


def frames(response):
    assert response.status_code == 200
    assert response.http_version == "HTTP/1.1"
    assert response.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert response.headers["cache-control"] == "no-cache"
    assert response.headers["x-accel-buffering"] == "no"
    assert response.headers["transfer-encoding"] == "chunked"
    assert "content-length" not in response.headers
    return (json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: "))


def new_conversation(live):
    response = live.client.post("/api/conversations", headers=live.headers, json={})
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.parametrize("authenticated", [False, True])
def test_live_progress_arrives_before_work_and_validated_text_is_atomic(live_chat, authenticated):
    live = live_chat
    live.models.intent["data_needs"] = ["news", "market"]
    conversation_id = new_conversation(live) if authenticated else None
    url = f"/api/conversations/{conversation_id}/ask" if authenticated else "/api/ask"
    headers = live.headers if authenticated else {}
    for gate in (live.models.intent_gate, live.retrieval.gate, live.models.answer_gate):
        gate.release.clear()
    with live.client.stream("POST", url, headers=headers, json={"query": "台積電", "stream": True}) as response:
        events = frames(response)
        assert next(events) == {"type": "status", "content": "正在理解問題與對話脈絡…"}
        assert live.models.intent_gate.entered.wait(5)
        assert not live.models.intent_gate.release.is_set()
        live.models.intent_gate.release.set()
        assert next(events) == {"type": "status", "content": "正在搜尋相關新聞與來源…"}
        assert live.retrieval.gate.entered.wait(5)
        assert not live.retrieval.gate.release.is_set()
        live.retrieval.gate.release.set()
        assert next(events) == {"type": "status", "content": "正在讀取行情、技術指標與基本面資料…"}
        assert next(events)["type"] == "dashboard"
        assert next(events) == {"type": "status", "content": "正在依據資料產生回答…"}
        # The fake has already yielded a partial answer, but it must remain buffered.
        assert live.models.answer_gate.entered.wait(5)
        live.models.answer_gate.release.set()
        assert next(events) == {"type": "status", "content": "正在核對回答的引用與數值…"}
        tail = list(events)
    assert [event["type"] for event in tail] == ["text", "done"]
    assert tail[0]["content"] == tail[1]["answer"] == ANSWER
    assert live.models.stream_closed.is_set()
    if authenticated:
        saved = live.client.get(f"/api/conversations/{conversation_id}", headers=headers).json()
        assistant = saved["messages"][-1]
        assert assistant["status"] == "completed" and assistant["content"] == ANSWER
        assert assistant["sources"][0]["content"] == "營收增加。"
        metrics = [item for block in assistant["dashboard"]["blocks"] if block["kind"] == "metrics"
                   for item in block["items"]]
        assert all("value" in item for item in metrics)
        assert any(item["value"] is None for item in metrics)
        assert ChatDashboard.model_validate(assistant["dashboard"]) == ChatDashboard.model_validate(tail[-1]["dashboard"])


def test_live_retry_never_publishes_rejected_text(live_chat):
    live = live_chat
    live.models.answer = "Rejected prose [S99]"
    live.models.repair_gate.release.clear()
    with live.client.stream("POST", "/api/ask", json={"query": "台積電", "stream": True}) as response:
        events, before = frames(response), []
        for event in events:
            before.append(event)
            if event == {"type": "status", "content": "回答未通過核對，正在依據來源重新產生…"}:
                break
        assert live.models.repair_gate.entered.wait(5)
        assert all(event["type"] not in {"text", "done", "error"} for event in before)
        live.models.repair_gate.release.set()
        assert next(events) == {"type": "status", "content": "正在重新核對回答的引用與數值…"}
        tail = list(events)
    assert [event["type"] for event in tail] == ["text", "done"]
    assert tail[0]["content"] == ANSWER
    assert "Rejected prose" not in json.dumps(before + tail)


def test_live_authenticated_failure_is_persisted(live_chat):
    live = live_chat
    conversation_id = new_conversation(live)
    url = f"/api/conversations/{conversation_id}/ask"
    assert live.client.post(url, json={"query": "台積電", "stream": True}).status_code == 401
    assert live.client.post(url, headers={"Authorization": "Bearer invalid"},
                            json={"query": "台積電", "stream": True}).status_code == 401
    assert not live.models.intent_gate.entered.is_set()
    live.models.error = UpstreamTimeout("Provider timed out")
    with live.client.stream("POST", url, headers=live.headers, json={"query": "台積電", "stream": True}) as response:
        events = list(frames(response))
    assert events[-1] == {"type": "error", "message": "Provider timed out"}
    assert all(event["type"] not in {"text", "done"} for event in events)
    assistant = live.client.get(f"/api/conversations/{conversation_id}", headers=live.headers).json()["messages"][-1]
    assert assistant["status"] == "failed" and assistant["error"] == "Provider timed out"
    assert assistant["content"] == "" and assistant["dashboard"]["blocks"]


def test_live_disconnect_releases_claim_and_closes_model(live_chat):
    live = live_chat
    conversation_id = new_conversation(live)
    url = f"/api/conversations/{conversation_id}/ask"
    live.models.answer_gate.release.clear()
    with live.client.stream("POST", url, headers=live.headers, json={"query": "台積電", "stream": True}) as response:
        events = frames(response)
        for event in events:
            if event == {"type": "status", "content": "正在依據資料產生回答…"}:
                break
        assert live.models.answer_gate.entered.wait(5)
        overlap = live.client.post(url, headers=live.headers, json={"query": "Overlap", "stream": True})
        assert overlap.status_code == 409
        assert overlap.headers["content-type"].startswith("application/json")
        assert "正在回覆" in overlap.json()["detail"]
        assert not live.models.answer_gate.release.is_set()
    # Closing the TCP response must cancel the provider without releasing its gate.
    assert live.models.stream_closed.wait(5)
    assert not live.models.answer_gate.release.is_set()

    def released():
        with live.factory() as db:
            return db.get(Conversation, conversation_id).active_turn is None

    wait_until(released)
    saved = live.client.get(f"/api/conversations/{conversation_id}", headers=live.headers).json()
    assert saved["messages"][-1]["status"] == "interrupted"
    assert saved["messages"][-1]["content"] == ""
    assert saved["messages"][-1]["dashboard"]["blocks"]
    live.models.answer_gate.release.set()
    with live.client.stream("POST", url, headers=live.headers, json={"query": "Continue", "stream": True}) as response:
        resumed = list(frames(response))
    assert resumed[-1]["type"] == "done"
    assert live.models.calls[-1][1]["payload"]["history"] == []
