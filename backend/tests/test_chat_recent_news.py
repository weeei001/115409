import asyncio

import pytest

from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from test_chat import FakeModels, FakeRetrieval, NOW


@pytest.mark.parametrize("query,expected_start,expected_end", [
    ("我想知道台積電的相關資訊，以及一個月內股價可能會上漲還是?",
     "2026-08-12 15:30:00", "2026-09-11 15:30:00"),
    ("台積電2025年第一季的新聞", "2025-01-01 00:00:00", "2025-03-31 23:59:59"),
])
def test_news_defaults_to_recent_window_and_preserves_explicit_history(monkeypatch, query, expected_start, expected_end, chat_session_factory):
    monkeypatch.setattr(chat_module, "taipei_now", lambda: NOW)
    retrieval = FakeRetrieval()
    chat = ChatService(http=None, settings=None, retrieval=retrieval, llm=FakeModels(), session_factory=chat_session_factory)
    response, _, _ = asyncio.run(chat._prepare(AskRequest(query=query)))
    assert retrieval.calls[0]["time_from"] == expected_start
    assert retrieval.calls[0]["time_to"] == expected_end
    assert response.time_range == {"from": expected_start, "to": expected_end}
