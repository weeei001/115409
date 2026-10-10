import asyncio

import pytest

from app.clients.llm import LlmResult
from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest, ChatTurn
from app.features.chat.prompts import INSUFFICIENT_EVIDENCE_ANSWER
from test_chat import chat
from test_chat_hub import hub


async def respond(service, request, stream):
    if not stream:
        return (await service.ask(request)).model_dump(mode="json")
    events = [event async for event in service.stream_events(request)]
    assert events[-1]["type"] == "done"
    return events[-1]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("authenticated", [False, True])
@pytest.mark.parametrize("query,stocks,needs", [
    ("回顧台積電去年營收", ["2330"], ["market"]),
    ("不要讀取我的持股，只解釋本益比", [], ["knowledge"]),
    ("我想知道政府預算對台股的影響", [], ["news"]),
    ("不要推薦哪檔買，只解釋本益比", [], ["knowledge"]),
    ("不要預測台積電下週會不會漲，只解釋 KD", ["2330"], ["knowledge"]),
    ("先不要查我的收藏或持股", [], []),
])
def test_public_semantic_needs_are_not_overridden_by_query_words(
        hub, monkeypatch, stream, authenticated, query, stocks, needs):
    _, service, models, retrieval = hub
    models.intent = {"stocks": stocks, "data_needs": needs, "forward_outlook": False}

    def forbidden(*args, **kwargs):
        pytest.fail("Public semantic intent accessed private context")

    monkeypatch.setattr(chat_module, "read_personal_context", forbidden)
    market_reads = []
    original_market_sources = service._market_sources

    def market_sources(symbols, as_of, start_date):
        market_reads.append(symbols)
        return original_market_sources(symbols, as_of, start_date)

    monkeypatch.setattr(service, "_market_sources", market_sources)
    request = AskRequest(query=query)
    if authenticated:
        request._user_id = 7
    result = asyncio.run(respond(service, request, stream))

    assert not any(source["category"] == "personal" for source in result["sources"])
    assert "登入後" not in result["answer"]
    assert bool(retrieval.calls) == ("news" in needs)
    assert bool(market_reads) == ("market" in needs)
    assert [kind for kind, _ in models.calls] == (
        ["intent", "stream" if stream else "text"] if needs else ["intent"])
    if needs:
        assert "這是未來走勢問題" not in models.calls[-1][1]["prompt"]
    else:
        assert result["answer"] == INSUFFICIENT_EVIDENCE_ANSWER
        assert result["sources"] == []


@pytest.mark.parametrize("stream", [False, True])
def test_macro_words_do_not_replace_semantic_market_clarification_with_news(hub, monkeypatch, stream):
    _, service, models, retrieval = hub
    models.intent = {"stocks": [], "data_needs": ["market"]}

    def forbidden(*args, **kwargs):
        pytest.fail("Unresolved stock intent accessed private context")

    monkeypatch.setattr(chat_module, "read_personal_context", forbidden)
    result = asyncio.run(respond(service, AskRequest(query="政府預算對台股的行情影響"), stream))
    assert "哪幾檔股票" in result["answer"]
    assert result["sources"] == []
    assert not retrieval.calls
    assert [kind for kind, _ in models.calls] == ["intent"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("query,forward_outlook,needs", [
    ("台積電去年是否上漲？", False, ["market"]),
    ("不要預測台積電下週會不會漲，只說明營收", False, ["market"]),
    ("照剛才談的情境，那明年呢？", True, ["market", "news"]),
])
def test_semantic_outlook_controls_prompt_and_dashboard_without_another_classifier(
        hub, stream, query, forward_outlook, needs):
    _, service, models, retrieval = hub
    models.intent = {"stocks": ["2330"], "data_needs": needs, "forward_outlook": forward_outlook,
                     "display_focus": ["fundamental"], "standalone_query": query}
    request = AskRequest(query=query, history=[ChatTurn(role="user", content="討論台積電的表現")])
    result = asyncio.run(respond(service, request, stream))
    prompt = models.calls[-1][1]["prompt"]
    assert ("這是未來走勢問題" in prompt) == forward_outlook
    blocks = result["dashboard"]["blocks"] if result["dashboard"] else []
    assert any(block["title"] == "收盤價走勢" for block in blocks) == forward_outlook
    assert bool(retrieval.calls) == ("news" in needs)
    assert [kind for kind, _ in models.calls] == ["intent", "stream" if stream else "text"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("payload,metadata", [
    ({}, {}),
    ({"stocks": None, "data_needs": ["portfolio"]}, {}),
    ({"data_needs": ["favorites"], "forward_outlook": "true"}, {}),
    ({"data_needs": ["portfolio"], "paper_order": {"mode": "invalid"}}, {}),
    ({"data_needs": ["portfolio"]}, {"finish_reason": "length"}),
    ({"data_needs": ["favorites"]}, {"finish_reason": "stop", "truncated": True}),
])
def test_invalid_or_incomplete_intent_recovers_without_private_data_access(
        hub, monkeypatch, stream, payload, metadata):
    _, service, models, retrieval = hub
    models.intent = payload
    generate = models.generate

    async def classified(**kwargs):
        result = await generate(**kwargs)
        return LlmResult(result.payload, result.raw_text, metadata)

    def forbidden(*args, **kwargs):
        pytest.fail("Untrusted classifier output accessed private context")

    monkeypatch.setattr(models, "generate", classified)
    monkeypatch.setattr(chat_module, "read_personal_context", forbidden)
    request = AskRequest(query="回顧台積電，提到我的收藏、持股與預算")
    request._user_id = 7
    result = asyncio.run(respond(service, request, stream))
    assert result["detected_stocks"] == ["2330"]
    assert result["sources"]
    assert not any(source["category"] == "personal" for source in result["sources"])
    assert retrieval.calls[0]["symbols"] == ["2330"]
    assert "登入後" not in result["answer"]
    assert "這是未來走勢問題" not in models.calls[-1][1]["prompt"]
    assert [kind for kind, _ in models.calls] == ["intent", "stream" if stream else "text"]
