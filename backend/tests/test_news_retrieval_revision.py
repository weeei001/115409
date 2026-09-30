import asyncio
from collections import Counter
from datetime import date
from types import SimpleNamespace

from app.features.analysis.evidence import build_news_items
from app.features.analysis.repository import attach_article_ids
from app.features.analysis.service import build_llm_runtime_config
from app.features.chat.schemas import AskRequest
from app.features.chat.service import ChatService
from app.features.retrieval.schemas import RetrievalRequest
from test_chat import FakeModels, FakeRetrieval
from test_retrieval import FakeVector, hit, service


def test_numeric_titles_remain_distinct_and_query_name_cannot_replace_factual_passage():
    july = hit("july", "Revenue July 20%", content="July result")
    august = hit("august", "Revenue August 30%", content="August result")
    first = hit("first", "Revenue 7 month 20%", content="Historical revenue")
    next_month = hit("next", "Revenue 8 month 30%", content="New revenue")
    guidance = hit("guidance", first["payload"]["title"], content="Next quarter margin target 50%")
    first["payload"]["article_id"] = guidance["payload"]["article_id"] = "article-one"
    vector = FakeVector(lambda embedding, args: [july, august, first, next_month] if embedding == [1.0]
                        else [guidance] if embedding == [2.0] else [])
    result = asyncio.run(service(vector).analyze(RetrievalRequest(symbols=["2330"], as_of="2024-01-31 23:59:59")))
    assert len(result.news_sources) == 4
    selected = next(item for item in result.news_sources if item.article_id == "article-one")
    assert selected.summary == first["payload"]["page_content"] and selected.chunk_id == "first"
    assert selected.kind == "general"


def test_analyze_balances_symbols_and_collect_passes_its_budget():
    def handler(embedding, args):
        if embedding != [1.0]:
            return []
        stock = args["symbols"][0]
        return [hit(f"{stock}-{i}", f"Report {stock} {i}", stock=stock) for i in range(50)]
    result = asyncio.run(service(FakeVector(handler)).analyze(
        RetrievalRequest(symbols=["2330", "2317"], max_events=3, as_of="2024-01-31 23:59:59")))
    assert Counter(item.id.split("-")[0] for item in result.news_sources) == {"2330": 3, "2317": 3}
    result = asyncio.run(service(FakeVector(handler)).collect(symbol="2330", max_events=50,
        as_of=date(2024, 1, 31)))
    assert len(result.news_sources) == 50


def test_question_caps_passages_and_does_not_let_background_displace_recent():
    repeated = [hit(f"same-{i}", content=f"Passage {i}", score=1 - i / 100) for i in range(10)]
    for item in repeated:
        item["payload"]["article_id"] = "same-article"
    other = [hit(f"other-{i}", score=0.5) for i in range(8)]
    vector = FakeVector(lambda embedding, args: repeated + other)
    result = asyncio.run(service(vector).search_question("revenue", ["2330"], "2024-01-02", "2024-02-01"))
    assert len(result.hits) == 10
    assert sum(item["payload"].get("article_id") == "same-article" for item in result.hits) == 2
    assert len(vector.calls) == 1

    recent = hit("recent", score=0.01)
    old = hit("old", timestamp="2023-12-31", score=1)
    vector = FakeVector(lambda embedding, args: [recent] if args["start"] else [old])
    result = asyncio.run(service(vector).search_question("revenue", ["2330"], "2024-01-01", "2024-02-01"))
    assert [item["id"] for item in result.hits] == ["recent"]
    assert [item["_in_time_range"] for item in result.hits] == [True]
    assert len(vector.calls) == 1


def test_article_id_never_guessed_from_long_chunk_id_and_passage_keeps_whitespace():
    source = {"id": "a" * 64, "chunk_id": "a" * 64, "title": "Report", "url": "https://news.test/report",
              "summary": "First line.\n\n  Second line.", "timestamp": "2024-01-31T12:00:00"}
    db = SimpleNamespace(execute=lambda query: SimpleNamespace(all=lambda: []))
    resolved = attach_article_ids(db, [source])[0]
    assert resolved["article_id"] is None
    evidence = build_news_items([resolved], summary_chars=None)[0]
    assert "article_id" not in evidence and evidence["chunk_id"] == "a" * 64
    assert evidence["value"] == source["summary"]


def test_chat_preserves_citation_provenance_and_raw_passage():
    item = hit("passage")
    item["payload"].update(article_id="article", chunk_index=2, char_start=8, char_end=30,
        content_hash="hash", revision="r1", index_version="news-v1", embedding_model="test-model",
        stock_ids=["2330", "2317"], page_content="Raw.\n\n  Exact passage.")
    llm = FakeModels()
    chat = ChatService(http=None, settings=None, retrieval=FakeRetrieval(hits=[item]), llm=llm)
    result = asyncio.run(chat.ask(AskRequest(query="Company revenue")))
    source = result.sources[0]
    assert source.citation_id == "S1" and source.article_id == "article" and source.chunk_id == "passage"
    assert source.content == item["payload"]["page_content"] and source.stock_ids == ["2330", "2317"]
    assert "[S1]" in llm.calls[-1][1]["prompt"]


def test_analysis_cache_changes_with_index_version(settings):
    first = build_llm_runtime_config(settings.model_copy(update={"NEWS_INDEX_VERSION": "one"}), "llm")
    second = build_llm_runtime_config(settings.model_copy(update={"NEWS_INDEX_VERSION": "two"}), "llm")
    assert first != second
