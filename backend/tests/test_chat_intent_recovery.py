import asyncio
import json

import pytest

from app.clients.llm import LlmResult
from app.features.chat import service as chat_module
from app.features.chat.knowledge import reference_source
from app.features.chat.schemas import AskRequest
from test_chat import chat, plan_payload


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("raw", [
    '{"is_finance":true,"data_needs":["knowledge"]',
    "not-json",
    '{"standalone_query":"What is nominal revenue?"',
])
def test_malformed_intent_stops_without_news_or_arbitrary_no_classification(chat, stream, raw):
    client, _, llm, retrieval = chat
    llm.intent = {}
    llm.raw_intent = raw
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    data = response.json()
    assert response.status_code == 200
    assert data["detected_stocks"] == []
    assert data["sources"] == []
    assert not retrieval.calls
    assert "請稍後重試" in data["answer"]
    assert [kind for kind, _ in llm.calls] == ["intent", "intent"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("metadata", [
    {"finish_reason": "length"},
    {"finish_reason": "stop", "truncated": True},
    {"finish_reason": "content_filter"},
])
def test_incomplete_intent_payload_and_legacy_reply_are_not_trusted(chat, stream, metadata):
    client, _, llm, retrieval = chat

    async def incomplete(**kwargs):
        llm.calls.append(("intent", kwargs))
        return LlmResult({"is_finance": False, "stocks": ["2454"], "data_needs": ["help"]}, "NO", metadata)

    llm.generate = incomplete
    response = client.post("/api/ask", json={"query": "台積電最近營收", "stream": stream})
    data = response.json()
    assert response.status_code == 200
    assert data["detected_stocks"] == []
    assert data["sources"] == []
    assert not retrieval.calls
    assert "請稍後重試" in data["answer"]
    assert [kind for kind, _ in llm.calls] == ["intent", "intent"]


def test_legacy_no_without_task_plan_is_rejected(chat):
    client, _, llm, retrieval = chat
    llm.intent = {}
    llm.raw_intent = " NO "
    response = client.post("/api/ask", json={"query": "Tell me a joke"})
    assert response.status_code == 200
    assert response.json()["sources"] == []
    assert not retrieval.calls
    assert "請稍後重試" in response.json()["answer"]
    assert [kind for kind, _ in llm.calls] == ["intent", "intent"]


ACCOUNT_QUERY = "請先檢查我的模擬投資可用資金、持股與未成交委託，聚焦一項需要注意的配置問題，說明依據與資料缺口，再提供兩個可選的後續討論方向。"


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("authenticated", [False, True])
@pytest.mark.parametrize("first_payload,first_metadata", [
    ({}, {}),
    ({"is_finance": True, "stocks": []}, {}),
    ({"data_needs": ["portfolio"], "paper_order": {"mode": "invalid"}}, {}),
    ({"data_needs": ["portfolio"]}, {"finish_reason": "length"}),
])
def test_account_intent_retry_uses_verified_owner_and_snapshot_without_news(
        chat, monkeypatch, stream, authenticated, first_payload, first_metadata):
    _, service, llm, retrieval = chat
    reads = []
    snapshot = {"portfolio": {"initialized": True, "available_cash": 42000,
                              "positions": [], "orders": []}}

    def personal_reader(factory, owner, scopes, query=""):
        reads.append((owner, scopes, query))
        return [], reference_source("Account snapshot", json.dumps(snapshot), category="personal")

    async def classify(**kwargs):
        llm.calls.append(("intent", kwargs))
        number = sum(kind == "intent" for kind, _ in llm.calls)
        assert number <= 2
        metadata = {"prompt_tokens": 10, "completion_tokens": 3, "reasoning_tokens": 1}
        return LlmResult(plan_payload(first_payload if number == 1 else {"data_needs": ["portfolio"]}), "",
                         {**metadata, **(first_metadata if number == 1 else {"finish_reason": "stop"})})

    monkeypatch.setattr(chat_module, "read_personal_context", personal_reader)
    monkeypatch.setattr(llm, "generate", classify)
    request = AskRequest.model_validate({"query": ACCOUNT_QUERY, "stream": stream, "user_id": 99, "_user_id": 99,
                                        "history": [{"role": "user", "content": "I want to review my practice account."}]})
    if authenticated:
        request._user_id = 7

    async def run():
        return (await service.ask(request)).model_dump(mode="json")

    result = asyncio.run(run())
    assert not retrieval.calls
    assert reads == ([(7, {"portfolio"}, ACCOUNT_QUERY)] if authenticated else [])
    assert [kind for kind, _ in llm.calls] == ["intent", "intent"] + (
        ["text"] if authenticated else [])
    assert all(llm.calls[1][1]["payload"][key] == value for key, value in llm.calls[0][1]["payload"].items())
    assert llm.calls[1][1]["payload"]["previous_plan_issue"]
    assert llm.calls[1][1]["payload"]["history"] == [
        {"role": "user", "content": "I want to review my practice account."}]
    if authenticated:
        assert [source["category"] for source in result["sources"]] == ["personal"]
        assert '"available_cash": 42000' in llm.calls[-1][1]["prompt"]
        assert result["tokens"] == {"input": 120, "output": 36, "thinking": 2}
    else:
        assert "登入後" in result["answer"]
        assert result["sources"] == []
        assert result["tokens"] == {"input": 20, "output": 6, "thinking": 2}
