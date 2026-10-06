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
    ("模擬賣出 2330 100 股", 100, None),
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


def test_personal_market_and_return_claims_use_backend_evidence():
    from app.features.chat.claims import numeric_claims_supported
    from app.features.chat.knowledge import reference_source
    source = reference_source("Portfolio", json.dumps({"portfolio": {
        "positions": [{"symbol": "2330", "market_price": 120, "market_date": "2026-10-01"}],
        "reviews": [{"symbol": "2330", "price_return_pct": 20, "closing_price": 120, "due_date": "2026-10-01"}],
    }}), category="personal")
    assert numeric_claims_supported("股票 2330 股價 120 元，報酬率 20%。", [source])
    assert not numeric_claims_supported("股票 2330 股價 130 元。", [source])
    assert not numeric_claims_supported("股票 2330 報酬率 30%。", [source])


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


@pytest.mark.parametrize("scopes,paper", [({"portfolio"}, True), ({"favorites"}, False)])
def test_simulated_allocation_guidance_only_for_paper_portfolio_turns(monkeypatch, chat_session_factory, scopes, paper):
    from app.features.chat.knowledge import reference_source
    from app.features.chat.prompts import PAPER_PORTFOLIO_GUIDANCE
    payload = {"portfolio": {"initialized": True, "available_cash": 20000}} if paper else {"favorites": []}
    monkeypatch.setattr(chat_module, "read_personal_context", lambda factory, owner, scopes, query="": (
        [], reference_source("Owned data", json.dumps(payload), category="personal")))
    monkeypatch.setattr(chat_module, "personal_scopes", lambda query, needs: set(scopes))
    models = FakeModels(intent={"stocks": [], "data_needs": sorted(scopes)})
    service = ChatService(http=None, settings=None, llm=models, retrieval=FakeRetrieval(),
                          session_factory=chat_session_factory)
    try:
        asyncio.run(service.ask(trusted("我的模擬帳戶資金該怎麼分配？")))
    except Exception:
        pass  # Only the prompt sent to the answer model matters here.
    prompts = [call["system_prompt"] for kind, call in models.calls if kind == "text"]
    assert prompts
    assert all((PAPER_PORTFOLIO_GUIDANCE in prompt) is paper for prompt in prompts)
