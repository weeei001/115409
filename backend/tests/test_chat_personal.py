import asyncio
import json
from contextlib import nullcontext
from types import SimpleNamespace
from uuid import UUID

import pytest

from app.features.chat import service as chat_module
from app.features.chat.personal_context import paper_draft, personal_scopes, read_personal_context
from app.features.chat.schemas import AskRequest, AskResponse
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
    ("我的投資預算有多少？", [], {"portfolio"}),
    ("我買得起 2330 嗎？", ["market"], {"portfolio"}),
    ("目前資金可以買多少？", [], {"portfolio"}),
    ("增加模擬資金", ["help"], {"portfolio"}),
    ("從我的收藏幫我分配投入金額", ["favorites"], {"favorites", "portfolio"}),
    ("這些收藏哪檔適合買？", ["favorites", "market"], {"favorites", "portfolio"}),
    ("我的收藏有哪些新聞？", ["favorites", "news"], {"favorites"}),
    ("什麼是資金配置？", ["knowledge"], set()),
])
def test_personal_scopes_include_budget_only_when_relevant(query, needs, expected):
    assert personal_scopes(query, needs) == expected


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


@pytest.mark.parametrize("query,quantity,budget", [
    ("模擬買進 2330 2 張", None, None),
    ("模擬買進 2330，投入 10 萬元", None, 100000),
    ("模擬買進 2330，投入 10萬", None, 100000),
    ("模擬買進 2330，投入 10,000 元", None, 10000),
    ("模擬買進 2330，投入 1.5 萬 塊", None, 15000),
    ("模擬買進 2330，投入 10萬 ", None, 100000),
    ("模擬賣出 2330 100 股", 100, None),
    ("模擬賣出 2330 1,000 股", 1000, None),
    ("模擬賣出 2330 1.5 張", 1500, None),
    ("模擬買進 2330", None, None),
])
def test_drafts_keep_explicit_units_and_persist_identity(query, quantity, budget):
    draft = paper_draft(query, ["2330"], trusted(query))
    assert draft.quantity == quantity and draft.budget == budget
    assert draft.conversation_id == "owned-conversation"
    assert UUID(draft.draft_id)
    response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[], tokens={}, duration_ms=0, current_time="", actions=[draft])
    assert AskResponse.model_validate(response.model_dump()).actions[0].draft_id == draft.draft_id


@pytest.mark.parametrize("query", ["如果模擬買進 2330", "不要模擬買進 2330", "如何模擬賣出 2330", "台積電適合買嗎？"])
def test_questions_do_not_create_drafts(query):
    assert paper_draft(query, ["2330"], trusted(query)) is None


def test_saved_message_restores_draft_identity():
    from datetime import datetime, timezone
    from app.features.conversations.schemas import SavedMessage
    draft = paper_draft("模擬買進 2330", ["2330"], trusted("模擬買進 2330"))
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
    request = trusted("模擬買進 2330，投入 999999999999999999999 萬元")
    assert paper_draft(request.query, ["2330"], request).budget is None
    assert paper_draft(request.query, ["INVALID"], request) is None


@pytest.mark.parametrize("query", [
    "模擬買進 2330，投入 -100 元",
    "模擬買進 2330，投入 10,00 元",
    "模擬賣出 2330 10,00 股",
    "模擬賣出 2330 1.1 股",
])
def test_drafts_do_not_extract_partial_or_fractional_quantities(query):
    draft = paper_draft(query, ["2330"], trusted(query))
    assert draft.budget is None and draft.quantity is None


def test_account_mode_is_server_only_context():
    response = AskResponse(answer="", detected_stocks=[], time_range=None, sources=[], tokens={},
                           duration_ms=0, current_time="", _requires_portfolio=True)
    assert response._requires_portfolio is False
    response._requires_portfolio = True
    assert "_requires_portfolio" not in response.model_dump()
