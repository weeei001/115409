"""Chat support follows the database, independently of the recognition catalog."""
import asyncio
import json
from datetime import timedelta

import pytest
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker

from app.db.models.stock_info import StockInfo
from app.db.models.daily_price import DailyPrice
from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest, SourceChunk
from app.features.chat.service import ChatService
from app.jobs.market.stock_info import SUPPORTED_SYMBOLS
from test_chat import FakeModels, FakeRetrieval, NOW


def make_service(db, monkeypatch, symbols, needs):
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {})
    monkeypatch.setattr(chat_module, "taipei_now", lambda: NOW)
    model = FakeModels(intent={"stocks": symbols, "data_needs": needs})
    return ChatService(http=None, settings=None, llm=model, retrieval=FakeRetrieval(),
                       session_factory=sessionmaker(db.get_bind(), expire_on_commit=False))


@pytest.mark.parametrize("symbol", SUPPORTED_SYMBOLS)
def test_all_service_stocks_reach_market_lookup_actions_and_help(db_session, monkeypatch, symbol):
    names = {symbol: f"Company {symbol}" for symbol in SUPPORTED_SYMBOLS}
    db_session.add_all([StockInfo(symbol=symbol, name=name) for symbol, name in names.items()])
    db_session.commit()
    service = make_service(db_session, monkeypatch, [symbol], ["market", "help"])
    seen = []

    def market(symbols, *_):
        seen.extend(symbols)
        return [SourceChunk(title=names[symbol], source="system_market", source_name="Market",
                            pub_time="2026-09-11", url="", stock_id=symbol, content="{}",
                            score=1, category="market_technical") for symbol in symbols]

    monkeypatch.setattr(service, "_market_sources", market)
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="Compare these companies")))
    assert seen == [symbol]
    assert {action.path for action in response.actions if action.path.startswith("/stock/")} == {
        f"/stock/{symbol}"}
    help_source = next(source for source in response.sources if source.category == "help")
    assert json.loads(help_source.content)["supported_stocks"] == names
    assert not any(source.category == "availability" for source in response.sources)


def test_large_comparison_reports_request_limit_without_restricting_stock_membership(db_session, monkeypatch):
    symbols = list(SUPPORTED_SYMBOLS[:7])
    db_session.add_all([StockInfo(symbol=symbol, name=f"Company {symbol}") for symbol in symbols])
    db_session.commit()
    service = make_service(db_session, monkeypatch, symbols, ["market"])
    monkeypatch.setattr(service, "_market_sources", lambda *_: pytest.fail("Oversized comparison"))
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="Compare these companies")))
    assert response.detected_stocks == symbols
    assert "單次最多比較 6 檔" in response.answer


@pytest.mark.parametrize("query", ["1101 1303", "台泥與南亞"])
def test_database_names_resolve_without_catalog_or_model_symbols(db_session, monkeypatch, query):
    db_session.add_all([StockInfo(symbol="1101", name="台泥"), StockInfo(symbol="1303", name="南亞")])
    db_session.commit()
    service = make_service(db_session, monkeypatch, [], ["news"])
    response, _, _ = asyncio.run(service._prepare(AskRequest(query=query)))
    assert response.detected_stocks == ["1101", "1303"]
    assert [action.path for action in response.actions[:2]] == ["/stock/1101", "/stock/1303"]


def test_cement_and_plastics_comparison_reads_database_evidence(db_session, monkeypatch):
    for symbol in ("1101", "1303"):
        db_session.add(StockInfo(symbol=symbol, name=f"Company {symbol}"))
        for offset, close in ((1, 100), (0, 105)):
            db_session.add(DailyPrice(symbol=symbol, date=NOW.date() - timedelta(days=offset),
                                      close=close, volume_shares=1000))
    db_session.commit()
    service = make_service(db_session, monkeypatch, ["1101", "1303"], ["market"])
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="Compare 1101 and 1303")))
    assert {source.stock_id for source in response.sources if source.category == "market_technical"} == {
        "1101", "1303"}
    assert any(source.category == "comparison" for source in response.sources)
    assert not any(source.category == "availability" for source in response.sources)


def test_database_membership_is_reloaded_between_requests(db_session, monkeypatch):
    service = make_service(db_session, monkeypatch, [], ["help"])
    assert service._stock_options() == {}
    db_session.add(StockInfo(symbol="1101", name="Taiwan Cement"))
    db_session.commit()
    assert service._stock_options() == {"1101": "Taiwan Cement"}


def test_empty_database_does_not_restore_legacy_stocks(db_session, monkeypatch):
    service = make_service(db_session, monkeypatch, ["2408"], ["market", "help"])
    monkeypatch.setattr(chat_module, "load_catalog", lambda: {"2408": {"name": "Nanya Technology"}})
    monkeypatch.setattr(service, "_market_sources", lambda *_: pytest.fail("Unsupported market lookup"))
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="2408")))
    assert not any(getattr(action, "path", "").startswith("/stock/") for action in response.actions)
    help_source = next(source for source in response.sources if source.category == "help")
    assert json.loads(help_source.content)["supported_stocks"] == {}
    limitation = next(source for source in response.sources if source.category == "availability")
    assert "2408" in limitation.content and "不支援行情" in limitation.content


@pytest.mark.parametrize("failure", ["missing_factory", "database_error"])
def test_unavailable_database_is_reported_without_six_stock_fallback(db_session, monkeypatch, failure):
    service = make_service(db_session, monkeypatch, ["2330"], ["market"])
    if failure == "missing_factory":
        service.session_factory = None
    else:
        def unavailable():
            raise OperationalError("SELECT", {}, RuntimeError("offline"))
        service.session_factory = unavailable
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="2330")))
    assert "無法讀取股票服務名單" in response.answer
    assert response.sources == [] and response.actions == []


def test_help_remains_available_but_discloses_unknown_stock_support(db_session, monkeypatch):
    service = make_service(db_session, monkeypatch, [], ["help"])
    service.session_factory = None
    response, _, _ = asyncio.run(service._prepare(AskRequest(query="What can this app do?")))
    help_source = next(source for source in response.sources if source.category == "help")
    payload = json.loads(help_source.content)
    assert payload["supported_stocks"] is None
    assert payload["supported_stocks_status"] == "unavailable"
    limitation = next(source for source in response.sources if source.category == "availability")
    assert "無法確認可查詢的股票範圍" in limitation.content
