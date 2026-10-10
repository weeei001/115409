import asyncio
import json

import pytest
from pydantic import ValidationError

from app.clients.llm import LlmResult
from app.features.chat import service as chat_module
from app.features.chat.evidence import assess_evidence
from app.features.chat.knowledge import reference_source
from app.features.chat.planning import TaskPlan, compile_plan
from app.features.chat.schemas import AskRequest
from test_chat import chat, plan_payload


QUERY = "請先檢查我的模擬投資可用資金、持股與未成交委託，聚焦一項需要注意的配置問題，說明依據與資料缺口，再提供兩個可選的後續討論方向。"


async def respond(service, request, stream):
    request.stream = stream
    return (await service.ask(request)).model_dump(mode="json")


def scripted_planning(monkeypatch, models, results):
    remaining = iter(results)

    async def generate(**kwargs):
        schema, payload, metadata = next(remaining)
        assert kwargs["schema"] is schema
        models.calls.append(("intent", kwargs))
        return LlmResult(payload, "", {"prompt_tokens": 2, "completion_tokens": 1,
                                     "reasoning_tokens": 1, **metadata})

    monkeypatch.setattr(models, "generate", generate)


@pytest.mark.parametrize("stream", [False, True])
def test_valid_plan_reads_account_once_without_another_model_review(chat, monkeypatch, stream):
    _, service, models, retrieval = chat
    models.intent = {"data_needs": ["portfolio"]}
    reads = []

    def personal_reader(factory, owner, scopes, query=""):
        assert [kind for kind, _ in models.calls] == ["intent"]
        reads.append((owner, scopes))
        return [], reference_source("Account", json.dumps({"portfolio": {
            "initialized": True, "available_cash": 42000, "positions": [], "orders": []}}), category="personal")

    monkeypatch.setattr(chat_module, "read_personal_context", personal_reader)
    request = AskRequest(query=QUERY)
    request._user_id = 7
    result = asyncio.run(respond(service, request, stream))
    assert reads == [(7, {"portfolio"})]
    assert not retrieval.calls
    assert [kind for kind, _ in models.calls] == ["intent", "text"]
    assert [source["category"] for source in result["sources"]] == ["personal"]
    assert '\"available_cash\": 42000' in models.calls[-1][1]["prompt"]
    assert len(request._planning_trace) == 1
    assert request._planning_trace[0]["effective_needs"] == ["portfolio"]
    assert request._evidence_trace["status"] == "ready"


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("payload,metadata,status", [
    ({"tasks": ["portfolio_review"]}, {}, "invalid"),
    ({**plan_payload({"data_needs": ["portfolio"]}), "portfolio_access": "forbidden"}, {}, "inconsistent"),
    (plan_payload({"data_needs": ["portfolio"]}), {"finish_reason": "length"}, "incomplete"),
])
def test_invalid_plans_stop_after_one_retry_without_data_access(chat, monkeypatch, stream, payload, metadata, status):
    _, service, models, retrieval = chat
    scripted_planning(monkeypatch, models, [(TaskPlan, payload, metadata)] * 2)

    def forbidden(*args, **kwargs):
        pytest.fail("An invalid plan accessed personal evidence")

    monkeypatch.setattr(chat_module, "read_personal_context", forbidden)
    request = AskRequest(query=QUERY)
    request._user_id = 7
    result = asyncio.run(respond(service, request, stream))
    assert [kind for kind, _ in models.calls] == ["intent", "intent"]
    assert not retrieval.calls
    assert result["sources"] == []
    assert "請稍後重試" in result["answer"]
    assert request._planning_trace[-1]["status"] == status
    assert result["tokens"] == {"input": 4, "output": 2, "thinking": 2}


@pytest.mark.parametrize("tasks,portfolio,favorites", [
    (["portfolio_review"], "forbidden", "not_needed"),
    (["portfolio_review"], "not_needed", "not_needed"),
    (["news_search"], "requested", "not_needed"),
    (["favorites_review"], "not_needed", "forbidden"),
    (["portfolio_review"], "requested", "requested"),
    (["non_finance", "news_search"], "not_needed", "not_needed"),
])
def test_compiler_rejects_contradictory_personal_access(tasks, portfolio, favorites):
    plan = TaskPlan(tasks=tasks, portfolio_access=portfolio, favorites_access=favorites)
    with pytest.raises(ValueError):
        compile_plan(plan)


@pytest.mark.parametrize("missing", ["tasks", "portfolio_access", "favorites_access"])
def test_plan_requires_explicit_task_and_access_contract(missing):
    payload = plan_payload({"data_needs": ["portfolio"]})
    del payload[missing]
    with pytest.raises(ValidationError):
        TaskPlan.model_validate(payload)


def test_compiler_owns_requirements_and_preserves_explicit_no_work():
    plan = TaskPlan.model_validate({**plan_payload({"data_needs": ["portfolio"]}), "data_needs": ["news"]})
    assert compile_plan(plan).data_needs == ["portfolio"]
    assert compile_plan(TaskPlan(tasks=[], portfolio_access="forbidden", favorites_access="forbidden")).data_needs == []


@pytest.mark.parametrize("content", ["{}", '{"favorites":[]}', "invalid-json", "[]"])
@pytest.mark.parametrize("stream", [False, True])
def test_missing_portfolio_contract_blocks_answer_even_when_personal_source_exists(
        chat, monkeypatch, stream, content):
    _, service, models, retrieval = chat
    models.intent = {"data_needs": ["portfolio"]}
    monkeypatch.setattr(chat_module, "read_personal_context", lambda *args, **kwargs: (
        [], reference_source("Incomplete personal evidence", content, category="personal")))
    request = AskRequest(query=QUERY)
    request._user_id = 7
    result = asyncio.run(respond(service, request, stream))
    assert [kind for kind, _ in models.calls] == ["intent"]
    assert not retrieval.calls
    assert result["sources"] == []
    assert "尚未取得" in result["answer"]
    assert request._evidence_trace["missing"] == ["portfolio"]
    assert request._evidence_trace["blocked"] is True


def test_news_and_availability_cannot_satisfy_personal_evidence_contract():
    sources = [reference_source("News", "Investment news", category="news"),
               reference_source("Missing", "Account unavailable", category="availability")]
    coverage = assess_evidence({"portfolio", "news"}, sources)
    assert coverage == {"requested": ["news", "portfolio"], "available": ["news"],
                        "missing": ["portfolio"], "blocked": True, "status": "blocked"}


@pytest.mark.parametrize("symbols", [[], ["2330"]])
def test_independent_macro_news_is_not_removed_or_filtered_by_personal_positions(chat, monkeypatch, symbols):
    _, service, models, retrieval = chat
    models.intent = {"data_needs": ["portfolio", "news"], "news_scope": "market_wide"}
    monkeypatch.setattr(chat_module, "read_personal_context", lambda *args, **kwargs: (
        symbols, reference_source("帳戶快照", '{"portfolio":{"initialized":true}}', category="personal")))
    request = AskRequest(query="檢查我的帳戶，並說明最近央行政策新聞")
    request._user_id = 7
    response = asyncio.run(service.ask(request))
    assert len(retrieval.calls) == 1
    assert retrieval.calls[0]["symbols"] == []
    assert {source.category for source in response.sources} == {"personal", "news"}
    assert request._evidence_trace["missing"] == []
