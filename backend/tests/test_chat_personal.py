import asyncio
import json
from contextlib import nullcontext
from types import SimpleNamespace
from uuid import UUID

import pytest
from pydantic import ValidationError

from app.features.chat import service as chat_module
from app.features.chat.personal_context import paper_draft, paper_draft_offers, read_personal_context
from app.features.chat.schemas import AskRequest, AskResponse, ChatTurn, Intent, PaperOrderIntent
from app.features.chat.service import ChatService
from test_chat import FakeModels, FakeRetrieval


def trusted(query):
    request = AskRequest(query=query)
    request._user_id = 7
    request._conversation_id = "owned-conversation"
    return request


def test_public_body_cannot_supply_personal_owner(monkeypatch):
    request = AskRequest.model_validate({"query": "我的收藏有哪些", "_user_id": 7, "user_id": 7})
    assert request._user_id is None
    assert "_user_id" not in request.model_dump()
    def forbidden(*args):
        pytest.fail("Anonymous request read private data")
    monkeypatch.setattr(chat_module, "read_personal_context", forbidden)
    models = FakeModels(intent={"stocks": [], "data_needs": ["favorites"]})
    service = ChatService(http=None, settings=None, llm=models, retrieval=FakeRetrieval())
    response = asyncio.run(service.ask(request))
    assert "登入" in response.answer
    assert response.sources == []


def test_personal_reader_uses_trusted_owner(monkeypatch):
    from app.features.favorites import repository
    owners = []
    def favorites(db, owner):
        owners.append(owner)
        return [SimpleNamespace(symbol="2330", name="TSMC")]
    monkeypatch.setattr(repository, "favorites", favorites)
    symbols, source = read_personal_context(lambda: nullcontext(object()), 7, {"favorites"})
    assert owners == [7]
    assert symbols == ["2330"]
    assert json.loads(source.content)["favorites"] == [{"symbol": "2330", "name": "TSMC"}]


def test_personal_reader_exposes_taipei_snapshot_time_without_changing_instant(monkeypatch):
    from app.features.paper_portfolio import service
    monkeypatch.setattr(service, "snapshot", lambda db, owner: {
        "as_of": "2026-10-08T18:30:00+00:00", "positions": [],
    })
    _, source = read_personal_context(lambda: nullcontext(object()), 7, {"portfolio"})
    portfolio = json.loads(source.content)["portfolio"]
    assert portfolio["as_of"] == "2026-10-08T18:30:00+00:00"
    assert portfolio["as_of_taipei"] == "2026-10-09T02:30:00+08:00"
    assert source.pub_time == portfolio["as_of_taipei"]


def test_personal_reader_samples_favorites_before_remaining_positions_without_duplicates(monkeypatch):
    from app.features.favorites import repository
    from app.features.paper_portfolio import service

    favorites = [SimpleNamespace(symbol=str(1100 + index), name=f"Company {index}") for index in range(8)]
    monkeypatch.setattr(repository, "favorites", lambda db, owner: favorites)
    monkeypatch.setattr(service, "snapshot", lambda db, owner: {"positions": [
        {"symbol": "1100"}, {"symbol": "2330"}, {"symbol": "2330"}, {"symbol": "2317"},
    ]})
    symbols, source = read_personal_context(lambda: nullcontext(object()), 7, {"favorites", "portfolio"})
    assert symbols == [row.symbol for row in favorites[:3]]
    assert source.stock_ids == [row.symbol for row in favorites] + ["2330", "2317"]
    assert len(json.loads(source.content)["favorites"]) == 8
    assert len(json.loads(source.content)["portfolio"]["positions"]) == 4


def test_favorites_resolve_before_news_retrieval(monkeypatch, chat_session_factory):
    from app.features.chat.knowledge import reference_source
    seen = []
    def reader(factory, owner, scopes, query=""):
        seen.append((owner, scopes))
        return ["2330"], reference_source("Owned favorites", "2330", category="personal")
    monkeypatch.setattr(chat_module, "read_personal_context", reader)
    models = FakeModels(intent={"stocks": [], "data_needs": ["favorites", "news"]})
    retrieval = FakeRetrieval()
    service = ChatService(http=None, settings=None, llm=models, retrieval=retrieval, session_factory=chat_session_factory)
    response, _, _ = asyncio.run(service._prepare(trusted("我的收藏有什麼新聞")))
    assert seen == [(7, {"favorites"})]
    assert retrieval.calls[0]["symbols"] == ["2330"]
    assert response.detected_stocks == ["2330"]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("contradiction", [False, True])
@pytest.mark.parametrize("favorites_count", [3, 40])
@pytest.mark.parametrize("query", [
    "請讀取我的收藏股票和模擬投資預算，協助我挑選適合進一步研究的股票。",
    "請參考我的模擬投資可用資金、持股與收藏股票，協助我討論下一步投資安排",
])
def test_order_ai_help_resolves_personal_symbols_and_returns_raw_proposals(monkeypatch, stream, contradiction, favorites_count, query):
    from app.features.favorites import repository
    from app.features.paper_portfolio import service as portfolio_service
    from app.features.chat.knowledge import reference_source

    favorites = [SimpleNamespace(symbol=str(1100 + index), name=f"Company {index}") for index in range(favorites_count)]
    monkeypatch.setattr(repository, "favorites", lambda db, owner: favorites)
    monkeypatch.setattr(portfolio_service, "snapshot", lambda db, owner: {
        "initialized": True, "available_cash": 50000, "cash": 50000, "equity": 50000,
        "cash_allocation_pct": 100, "holdings_allocation_pct": 0, "positions": [],
    })
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {})
    answer = (f"可用資金50000元，持股占比0%，收藏清單有{favorites_count}檔。[S1]\n\n"
              "建議先投入可用資金20%至30%，建議保留50%現金。[S1]")
    invalid_answer = "可用資金999999元。[S1]"
    models = FakeModels(intent={"stocks": [], "data_needs": ["favorites", "portfolio", "market", "news"]},
                        answer=invalid_answer if contradiction else answer)
    retrieval = FakeRetrieval()
    service = ChatService(http=None, settings=None, llm=models, retrieval=retrieval,
                          session_factory=lambda: nullcontext(object()))
    monkeypatch.setattr(service, "_stock_options", lambda: {row.symbol: row.name for row in favorites})
    market_calls = []

    def market_sources(symbols, as_of, start_date):
        market_calls.append(symbols)
        return [reference_source("Market", json.dumps({"columns": ["date", "close"],
            "rows": [["2026-10-02", 100]]}), category="market_technical").model_copy(update={"stock_id": symbol})
            for symbol in symbols]

    monkeypatch.setattr(service, "_market_sources", market_sources)
    request = trusted(query)

    async def run():
        if not stream:
            return (await service.ask(request)).model_dump()
        results = [event async for event in service.stream_events(request)]
        assert results[-1]["type"] == "done"
        assert not any("重新" in event.get("content", "") for event in results if event["type"] == "status")
        assert "".join(event["content"] for event in results if event["type"] == "text") == models.answer
        return results[-1]

    result = asyncio.run(run())
    assert result["answer"] == models.answer
    followups = [action for action in result["actions"] if action.get("type") == "follow_up"]
    assert len(followups) == 3
    assert all(action["query"] == action["label"] for action in followups)
    assert market_calls == [[row.symbol for row in favorites[:3]]]
    assert retrieval.calls[0]["symbols"] == [row.symbol for row in favorites[:3]]
    assert len(json.loads(result["sources"][0]["content"])["favorites"]) == favorites_count
    assert result["sources"][0]["stock_ids"] == [row.symbol for row in favorites]
    expected_calls = ["intent", "stream" if stream else "text"]
    assert [kind for kind, _ in models.calls] == expected_calls
    if favorites_count > 3:
        content = result["dashboard"]["blocks"][0]["description"]
        assert "合計 40 檔" in content and "僅取前 3 檔" in content
        assert "1100、1101、1102" in content
        assert "其餘股票尚未比較" in content
    else:
        assert "僅取前" not in result["answer"]
        assert "僅取前" not in result["dashboard"]["blocks"][0]["description"]


@pytest.mark.parametrize("query,needs,expected", [
    ("我的投資預算有多少？", ["portfolio"], {"portfolio"}),
    ("我買得起 2330 嗎？", ["portfolio", "market"], {"portfolio"}),
    ("目前資金可以買多少？", ["portfolio"], {"portfolio"}),
    ("增加模擬資金", ["portfolio", "help"], {"portfolio"}),
    ("從我的收藏幫我分配投入金額", ["favorites", "portfolio"], {"favorites", "portfolio"}),
    ("這些收藏哪檔適合買？", ["favorites", "portfolio", "market"], {"favorites", "portfolio"}),
    ("請從我的收藏選出值得研究的股票，不要讀取我的持股或資金", ["favorites"], {"favorites"}),
    ("照先前說的先看這個帳戶", ["portfolio"], {"portfolio"}),
    ("我的收藏有哪些新聞？", ["favorites", "news"], {"favorites"}),
])
def test_private_reads_use_only_semantic_scopes(monkeypatch, chat_session_factory, query, needs, expected):
    from app.features.chat.knowledge import reference_source

    reads = []

    def reader(factory, owner, scopes, query=""):
        reads.append((owner, scopes))
        return [], reference_source("Owned personal data", "{}", category="personal")

    monkeypatch.setattr(chat_module, "read_personal_context", reader)
    models = FakeModels(intent={"stocks": [], "data_needs": needs})
    service = ChatService(http=None, settings=None, llm=models, retrieval=FakeRetrieval(),
                          session_factory=chat_session_factory)
    response, _, _ = asyncio.run(service._prepare(trusted(query)))
    assert reads == [(7, expected)]
    assert response._requires_portfolio == ("portfolio" in expected)
    assert len(models.calls) == 1


def test_unconfigured_portfolio_is_distinct_from_zero_funds(monkeypatch):
    from app.features.paper_portfolio import service
    monkeypatch.setattr(service, "snapshot", lambda db, user: {
        "initialized": False, "cash": 0, "available_cash": 0, "positions": [],
    })
    _, source = read_personal_context(lambda: nullcontext(object()), 7, {"portfolio"})
    payload = json.loads(source.content)["portfolio"]
    assert payload["initialized"] is False
    assert "尚未設定" in payload["setup_note"]
    assert "不能解讀為沒有存款" in payload["setup_note"]


def test_fund_context_keeps_full_totals_with_bounded_history(monkeypatch):
    from app.features.paper_portfolio import service
    movements = [{"id": str(index), "amount": 1000} for index in range(50)]
    monkeypatch.setattr(service, "snapshot", lambda db, user: {
        "initialized": True, "cash": 0, "available_cash": 0, "positions": [],
        "total_deposits": 50000, "total_withdrawals": 10000,
        "net_contributions": 70000, "total_pnl": 3000, "fund_movements": movements,
    })
    _, source = read_personal_context(lambda: nullcontext(object()), 7, {"portfolio"})
    payload = json.loads(source.content)["portfolio"]
    assert "setup_note" not in payload
    assert payload["total_deposits"] == 50000
    assert payload["total_withdrawals"] == 10000
    assert payload["net_contributions"] == 70000
    assert payload["total_pnl"] == 3000
    assert payload["fund_movements"] == movements[:20]
    assert payload["context_counts"]["fund_movements_total"] == 50
    assert payload["context_counts"]["fund_movements_shown"] == 20


@pytest.mark.parametrize("query,side,quantity,budget", [
    ("模擬買進 2330 2 張", "buy", None, None),
    ("模擬買進 2330，投入 10 萬元", "buy", None, 100000),
    ("模擬買進 2330，投入 10萬", "buy", None, 100000),
    ("模擬買進 2330，投入 10,000 元", "buy", None, 10000),
    ("模擬買進 2330，投入 1.5 萬 塊", "buy", None, 15000),
    ("模擬買進 2330，投入 10萬 ", "buy", None, 100000),
    ("模擬賣出 2330 100 股", "sell", 100, None),
    ("模擬賣出 2330 1,000 股", "sell", 1000, None),
    ("模擬賣出 2330 1.5 張", "sell", 1500, None),
    ("模擬買進 2330", "buy", None, None),
])
def test_drafts_keep_semantic_units_and_persist_identity(query, side, quantity, budget):
    order_intent = PaperOrderIntent(mode="draft", side=side, quantity=quantity, budget=budget)
    draft = paper_draft(order_intent, ["2330"], trusted(query))
    assert draft.quantity == quantity and draft.budget == budget
    assert draft.conversation_id == "owned-conversation"
    assert UUID(draft.draft_id)
    response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[], tokens={}, duration_ms=0, current_time="", actions=[draft])
    assert AskResponse.model_validate(response.model_dump()).actions[0].draft_id == draft.draft_id


@pytest.mark.parametrize("query", ["如果模擬買進 2330", "不要模擬買進 2330", "如何模擬賣出 2330", "台積電適合買嗎？"])
def test_questions_do_not_create_drafts(query):
    assert paper_draft(PaperOrderIntent(), ["2330"], trusted(query)) is None


def test_saved_message_restores_draft_identity():
    from datetime import datetime, timezone
    from app.features.conversations.schemas import SavedMessage
    draft = paper_draft(PaperOrderIntent(mode="draft", side="buy"), ["2330"], trusted("模擬買進 2330"))
    saved = SavedMessage(id="message", role="assistant", content="draft", timestamp=datetime.now(timezone.utc), actions=[draft])
    assert SavedMessage.model_validate(saved.model_dump()).actions[0].draft_id == draft.draft_id


def test_personal_context_bounds_history_but_keeps_requested_old_order(monkeypatch):
    from app.features.paper_portfolio import service
    from uuid import uuid4
    records = [{"id": str(uuid4()), "symbol": "2330"} for _ in range(50)]
    reviews = [{"id": str(uuid4()), "order_id": row["id"], "symbol": "2330", "status": "reviewed"} for row in records]
    old = records[-1]["id"]
    monkeypatch.setattr(service, "snapshot", lambda db, user: {"cash": 123, "positions": [], "orders": records, "reviews": reviews})
    _, source = read_personal_context(lambda: nullcontext(object()), 7, {"portfolio"}, query=f"Review {old}")
    payload = json.loads(source.content)["portfolio"]
    assert payload["cash"] == 123
    assert len(payload["orders"]) == 21 and len(payload["reviews"]) == 21
    assert payload["orders"][0]["id"] == old
    assert payload["reviews"][0]["order_id"] == old
    assert payload["context_counts"]["orders_total"] == 50


def test_malformed_or_extreme_draft_inputs_are_safe():
    with pytest.raises(ValidationError):
        PaperOrderIntent(mode="draft", side="buy", budget=999999999999999999999)
    order_intent = PaperOrderIntent(mode="draft", side="buy")
    assert paper_draft(order_intent, ["INVALID"], trusted("準備一筆練習委託")) is None


@pytest.mark.parametrize("query", [
    "模擬買進 2330，投入 -100 元",
    "模擬買進 2330，投入 10,00 元",
    "模擬賣出 2330 10,00 股",
    "模擬賣出 2330 1.1 股",
])
def test_drafts_do_not_reparse_amounts_from_query(query):
    draft = paper_draft(PaperOrderIntent(mode="draft", side="buy"), ["2330"], trusted(query))
    assert draft.budget is None and draft.quantity is None


@pytest.fixture
def semantic_paper_chat(monkeypatch, chat_session_factory):
    from app.features.chat.knowledge import reference_source

    models = FakeModels(answer="可先討論安排，再確認模擬委託。[S1]")
    service = ChatService(http=None, settings=None, llm=models, retrieval=FakeRetrieval(),
                          session_factory=chat_session_factory)
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {"2603": {"name": "長榮"}})
    monkeypatch.setattr(chat_module, "read_personal_context", lambda *args, **kwargs: (
        [], reference_source("Owned portfolio", json.dumps({"portfolio": {
            "initialized": True, "available_cash": 50000, "positions": [],
        }}), category="personal")))
    return service, models


async def semantic_paper_response(service, request, stream):
    if not stream:
        return (await service.ask(request)).model_dump(mode="json")
    events = [event async for event in service.stream_events(request)]
    assert events[-1]["type"] == "done"
    for event in events:
        if event["type"] == "dashboard":
            assert event["actions"] == events[-1]["actions"]
    return events[-1]


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("query,semantic,side,budget,quantity", [
    ("我想投入一萬試試", {"mode": "draft", "side": "buy", "budget": 10000}, "buy", 10000, None),
    ("照剛才談的練習買一筆", {"mode": "draft", "side": "buy"}, "buy", None, None),
    ("把手上的一千股拿來練習調整", {"mode": "draft", "side": "sell", "quantity": 1000}, "sell", None, 1000),
    ("模擬買進 2330，投入十萬元", {"mode": "draft", "side": "buy", "budget": 100000}, "buy", 100000, None),
    ("台積電適合買嗎？", {"mode": "offer", "side": "buy", "budget": 50000}, "buy", None, None),
    ("台積電現在適合減碼嗎？", {"mode": "offer", "side": "sell", "quantity": 1000}, "sell", None, None),
    ("想討論台積電的投資安排", {"mode": "offer"}, "buy", None, None),
])
def test_semantic_paper_intent_uses_one_classifier_without_executing_orders(
        semantic_paper_chat, db_session, stream, query, semantic, side, budget, quantity):
    from app.db.models.paper_portfolio import PaperOrder

    service, models = semantic_paper_chat
    models.intent = {"stocks": ["2330"], "data_needs": ["help"], "paper_order": semantic}
    request = trusted(query)
    request.history = [ChatTurn(role="assistant", content="先前討論台積電的練習投資安排。")]
    result = asyncio.run(semantic_paper_response(service, request, stream))
    drafts = [action for action in result["actions"] if action["type"] == "paper_order_draft"]
    assert len(drafts) == 1
    assert (drafts[0]["symbol"], drafts[0]["side"], drafts[0]["budget"], drafts[0]["quantity"]) == (
        "2330", side, budget, quantity)
    assert drafts[0]["conversation_id"] == request._conversation_id
    assert "先前分析摘錄" in drafts[0]["reason"]
    assert UUID(drafts[0]["draft_id"])
    source = next(source for source in result["sources"] if source["title"] == "模擬單草稿")
    assert "是否需要建立模擬單" in source["content"] and "尚未建立委託" in source["content"]
    assert [kind for kind, _ in models.calls] == ["intent", "stream" if stream else "text"]
    assert db_session.query(PaperOrder).count() == 0


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("query,semantic", [
    ("不要模擬買進 2330，先討論風險", {"mode": "none"}),
    ("今天台積電收盤價是多少？", {"mode": "none"}),
    ("模擬單是什麼？", {"mode": "none"}),
    ("如果模擬買進 2330 一萬元呢？", {"mode": "none"}),
    ("幫我在真實券商買進 2330", {"mode": "none"}),
    ("好，確認", {}),
    ("模擬買進 2330，投入十萬元", {}),
    ("照剛才談的練習買一筆", {"mode": "draft", "budget": 10000}),
])
def test_none_or_incomplete_semantic_intent_never_falls_back_to_keywords(
        semantic_paper_chat, stream, query, semantic):
    service, models = semantic_paper_chat
    models.intent = {"stocks": ["2330"], "data_needs": ["help"], "paper_order": semantic}
    result = asyncio.run(semantic_paper_response(service, trusted(query), stream))
    assert not any(action["type"] == "paper_order_draft" for action in result["actions"])


@pytest.mark.parametrize("stream", [False, True])
@pytest.mark.parametrize("symbols,logged_in", [(["2603"], True), (["9999"], True), ([], True), (["2330"], False)])
def test_semantic_drafts_require_known_supported_symbols_and_authenticated_owner(
        semantic_paper_chat, stream, symbols, logged_in):
    service, models = semantic_paper_chat
    models.intent = {"stocks": symbols, "data_needs": ["help"],
                     "paper_order": {"mode": "draft", "side": "buy", "budget": 10000}}
    request = trusted("照剛才談的練習買一筆") if logged_in else AskRequest(query="照剛才談的練習買一筆")
    result = asyncio.run(semantic_paper_response(service, request, stream))
    assert not any(action["type"] == "paper_order_draft" for action in result["actions"])


@pytest.mark.parametrize("mode", ["offer", "draft"])
def test_multiple_stock_proposals_are_capped_and_never_copy_a_shared_budget(mode):
    request = trusted("討論這幾檔的投資安排")
    order_intent = PaperOrderIntent(mode=mode, side="buy", budget=10000)
    symbols = ["2330", "2317", "2330", "2454", "2881"]
    assert paper_draft(order_intent, symbols, request) is None
    offers = paper_draft_offers(order_intent, symbols, request)
    assert [draft.symbol for draft in offers] == ["2330", "2317", "2454"]
    assert all(draft.budget is None and draft.quantity is None for draft in offers)
    assert len({draft.draft_id for draft in offers}) == 3


@pytest.mark.parametrize("side,budget,quantity,expected", [
    ("buy", None, 2000, (None, None)),
    ("sell", 10000, 1000, (None, 1000)),
])
def test_semantic_draft_sizes_preserve_buy_and_sell_contracts(side, budget, quantity, expected):
    draft = paper_draft(PaperOrderIntent(mode="draft", side=side, budget=budget, quantity=quantity),
                        ["2330"], trusted("照剛才談的練習準備一筆"))
    assert (draft.budget, draft.quantity) == expected


@pytest.mark.parametrize("semantic,metadata", [
    ({"mode": "draft", "side": "buy", "budget": 10000}, {"truncated": True}),
    ({"mode": "draft", "side": "buy", "budget": 10000}, {"finish_reason": "length"}),
    ({"mode": "unknown", "side": "buy"}, {}),
    ({"mode": "draft", "side": "buy", "budget": float("inf")}, {}),
    ({"mode": "draft", "side": "buy", "budget": -100}, {}),
    ({"mode": "draft", "side": "buy", "budget": 1000000001}, {}),
    ({"mode": "draft", "side": "sell", "quantity": 1.1}, {}),
    ({"mode": "draft", "side": "sell", "quantity": "100"}, {}),
    (None, {}),
])
def test_invalid_or_truncated_classifier_output_cannot_produce_drafts(
        semantic_paper_chat, monkeypatch, semantic, metadata):
    service, models = semantic_paper_chat
    models.intent = {"stocks": ["2330"], "data_needs": ["help"], "paper_order": semantic}
    generate = models.generate

    async def classified(**kwargs):
        result = await generate(**kwargs)
        result.metadata.update(metadata)
        return result

    monkeypatch.setattr(models, "generate", classified)
    result = asyncio.run(semantic_paper_response(service, trusted("模擬買進 2330，投入一萬元"), False))
    assert not any(action["type"] == "paper_order_draft" for action in result["actions"])


def test_saved_conversation_restores_semantic_offer_identity(semantic_paper_chat, db_session, chat_session_factory):
    from app.db.models.user import User
    from app.features.conversations.service import ConversationService

    owner = User(email="semantic-paper@example.com", password_hash="unused")
    db_session.add(owner)
    db_session.commit()
    service, models = semantic_paper_chat
    models.intent = {"stocks": ["2330"], "data_needs": ["help"], "paper_order": {"mode": "offer", "side": "buy"}}
    conversations = ConversationService(chat_session_factory, service)
    conversation = conversations.create(owner.id)
    turn_id, request = conversations.begin(owner.id, conversation.id, AskRequest(query="想討論台積電的投資安排"))
    response = asyncio.run(conversations.ask(conversation.id, turn_id, request))
    draft = next(action for action in response.actions if action.type == "paper_order_draft")
    restored = conversations.get(owner.id, conversation.id)
    saved_draft = next(action for action in restored.messages[-1].actions if action.type == "paper_order_draft")
    assert saved_draft.draft_id == draft.draft_id
    assert saved_draft.conversation_id == conversation.id
    assert saved_draft.budget is None and saved_draft.quantity is None


def test_missing_semantic_classification_defaults_to_no_order_intent():
    assert Intent.model_validate({"stocks": ["2330"]}).paper_order.mode == "none"


def test_account_mode_is_server_only_context():
    response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[], tokens={},
                           duration_ms=0, current_time="", _requires_portfolio=True)
    assert response._requires_portfolio is False
    response._requires_portfolio = True
    assert "_requires_portfolio" not in response.model_dump()
