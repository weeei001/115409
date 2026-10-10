"""透過本機 TCP 驗證完整 JSON 回答，模型與資料庫皆使用測試資料。"""
import asyncio
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

from app.core.errors import UpstreamTimeout, install_error_handlers
from app.db.base import Base
from app.db.models.daily_price import DailyPrice
from app.db.models.user import User
from app.db.models.stock_info import StockInfo
from app.features.auth.service import create_access_token
from app.features.chat import service as chat_module
from app.features.chat.router import get_service, router as chat_router
from app.features.chat.schemas import ChatDashboard
from app.features.chat.service import ChatService
from app.features.conversations.router import router as conversations_router
from test_chat import ANSWER, NOW, FakeModels, FakeRetrieval


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
        self.intent_gate, self.answer_gate = Gate(), Gate()

    async def generate(self, **kwargs):
        await self.intent_gate.wait()
        return await super().generate(**kwargs)

    async def text(self, **kwargs):
        await self.answer_gate.wait()
        return await super().text(**kwargs)


class GatedRetrieval(FakeRetrieval):
    def __init__(self):
        super().__init__()
        self.gate = Gate()

    async def search_question(self, *args, **kwargs):
        await self.gate.wait()
        return await super().search_question(*args, **kwargs)


def wait_until(predicate):
    # 此期限只用來偵測失敗，不要求特定網路延遲。
    deadline = time.monotonic() + 5
    while not predicate():
        assert time.monotonic() < deadline, "Local JSON server did not reach the expected state"
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
        for gate in (models.intent_gate, models.answer_gate, retrieval.gate):
            gate.release.set()
        server.should_exit = True
        thread.join(timeout=5)
        if thread.is_alive():
            server.force_exit = True
            thread.join(timeout=5)
        listener.close()
        engine.dispose()
        assert not thread.is_alive(), "JSON test server failed to shut down"


def new_conversation(live):
    response = live.client.post("/api/conversations", headers=live.headers, json={})
    assert response.status_code == 201
    return response.json()["id"]


@pytest.mark.parametrize("authenticated", [False, True])
def test_live_json_is_returned_after_generation_and_persistence(live_chat, authenticated):
    live = live_chat
    live.models.intent["data_needs"] = ["news", "market"]
    conversation_id = new_conversation(live) if authenticated else None
    url = f"/api/conversations/{conversation_id}/ask" if authenticated else "/api/ask"
    headers = live.headers if authenticated else {}
    live.models.answer_gate.release.clear()
    results = []
    def request():
        results.append(live.client.post(url, headers=headers, json={"query": "台積電", "stream": True}))
    thread = threading.Thread(target=request)
    thread.start()
    try:
        assert live.models.answer_gate.entered.wait(5)
        assert not results
        if authenticated:
            overlap = live.client.post(url, headers=headers, json={"query": "Overlap"})
            assert overlap.status_code == 409
        live.models.answer_gate.release.set()
        thread.join(timeout=5)
        assert not thread.is_alive()
    finally:
        live.models.answer_gate.release.set()
        thread.join(timeout=5)
    response, = results
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    data = response.json()
    assert data["answer"] == ANSWER
    assert data["sources"][0]["citation_id"] == "S1"
    if authenticated:
        assistant = live.client.get(f"/api/conversations/{conversation_id}", headers=headers).json()["messages"][-1]
        assert assistant["status"] == "completed" and assistant["content"] == ANSWER
        assert assistant["id"] == data["message_id"]
        assert ChatDashboard.model_validate(assistant["dashboard"]) == ChatDashboard.model_validate(data["dashboard"])


def test_live_answer_preserves_model_text(live_chat):
    live = live_chat
    live.models.answer = "Unverified prose [S99]"
    response = live.client.post("/api/ask", json={"query": "2330"})
    assert response.status_code == 200
    assert response.json()["answer"] == live.models.answer


def test_live_authenticated_failure_is_persisted(live_chat):
    live = live_chat
    conversation_id = new_conversation(live)
    url = f"/api/conversations/{conversation_id}/ask"
    assert live.client.post(url, json={"query": "台積電"}).status_code == 401
    assert live.client.post(url, headers={"Authorization": "Bearer invalid"}, json={"query": "台積電"}).status_code == 401
    assert not live.models.intent_gate.entered.is_set()
    live.models.error = UpstreamTimeout("Provider timed out")
    response = live.client.post(url, headers=live.headers, json={"query": "台積電"})
    assert response.status_code == 504
    assert response.json()["detail"] == "Provider timed out"
    assistant = live.client.get(f"/api/conversations/{conversation_id}", headers=live.headers).json()["messages"][-1]
    assert assistant["status"] == "failed" and assistant["error"] == "Provider timed out"
    assert assistant["content"] == ""
