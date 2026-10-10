import asyncio

import pytest

from app.features.chat import service as chat_module
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from test_chat import FakeModels, FakeRetrieval, NOW


@pytest.mark.parametrize("query,dates,expected_start,expected_end,label", [
    ("我想知道台積電的相關資訊，以及一個月內股價可能會上漲還是?",
     {},
     "2026-08-12 15:30:00", "2026-09-11 15:30:00", "新聞檢索期間（使用者未指定，預設最近 30 天）"),
    ("台積電2025年第一季的新聞", {"time_from": "2025-01-01 00:00:00", "time_to": "2025-03-31 23:59:59"},
     "2025-01-01 00:00:00", "2025-03-31 23:59:59", "使用者指定期間"),
    ("不要限定在2024年，查最近台積電的新聞", {"time_from": None, "time_to": None},
     "2026-08-12 15:30:00", "2026-09-11 15:30:00", "新聞檢索期間（使用者未指定，預設最近 30 天）"),
])
def test_news_defaults_to_recent_window_and_preserves_semantic_history(monkeypatch, query, dates, expected_start, expected_end, label, chat_session_factory):
    monkeypatch.setattr(chat_module, "taipei_now", lambda: NOW)
    retrieval = FakeRetrieval()
    models = FakeModels(intent={"stocks": ["2330"], "data_needs": ["news"], **dates})
    chat = ChatService(http=None, settings=None, retrieval=retrieval, llm=models, session_factory=chat_session_factory)
    response, prompt, _ = asyncio.run(chat._prepare(AskRequest(query=query)))
    assert retrieval.calls[0]["time_from"] == expected_start
    assert retrieval.calls[0]["time_to"] == expected_end
    assert response.time_range == {"from": expected_start, "to": expected_end}
    assert f"{label}：" in prompt
