"""Offline regressions for source identity, bounded retrieval, and impact evidence."""
import asyncio
import json
from datetime import date
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import chunk_metadata
from app.db.models.news_impact import NewsEventAnalysis
from app.features.news.impact import article_hash, config_hash, validate_output
from app.features.news.schemas import News
from app.features.news.sentiment import (analysis_content_window, estimate_token_count,
    extract_candidate_stocks, source_quote_span)
from app.features.retrieval.chunking import article_chunks
from app.features.retrieval.impact_metadata import impact_payload
from app.features.retrieval.schemas import RetrievalRequest
from app.features.retrieval.service import RetrievalService
from app.jobs.ingestion.repository import insert_article_chunks
from app.jobs.scheduler import run_pipeline
from test_retrieval import FakeVector, hit, service


def test_body_candidates_and_explicit_codes_do_not_confirm_ambiguous_words():
    catalog = {"2317": {"name": "鴻海"}, "2382": {"name": "廣達"},
               "5347": {"name": "世界"}, "3167": {"name": "大量"}}
    assert extract_candidate_stocks(None, None, "世界經濟大量資金", "鴻海與廣達接單", catalog) == ["2317", "2382"]
    for code in ("(2317-TW)", "(2317)", "2317.TW", "（2317）"):
        assert extract_candidate_stocks(None, None, "公司", code, catalog) == ["2317"]


def test_query_excludes_explicit_simulations_for_all_consumers():
    from datetime import datetime
    from app.features.retrieval.common import TAIPEI
    retrieval = service(FakeVector())
    normal = hit("real", title="台積電導入模擬設計", stock="2330")
    simulated = hit("fake", title="【模擬測試・非真實新聞】台積電事件", stock="2330")
    async def query(*args, **kwargs):
        return [normal, simulated]
    retrieval.vector.query = query
    result = asyncio.run(retrieval._query([], symbols=None, start=None,
        end=datetime(2027, 1, 1, tzinfo=TAIPEI), limit=20))
    assert result == [normal]


def test_clean_quote_validation_and_payload_keep_raw_offsets():
    raw = "台積電  營收成長。"
    quote = {"field": "content", "quote": "台積電 營收成長"}
    article = SimpleNamespace(title="消息", content=raw)
    payload = {"events": [{"key": "e1", "summary": "營收成長", "statement_type": "fact", "evidence": [quote]}],
               "impacts": [{"event_key": "e1", "target_type": "company", "target_id": "2330",
                    "direction": "positive", "importance": "medium", "basis": "reported", "reason": "營收成長", "evidence": [quote]}]}
    output = validate_output(payload, article=article, catalog={"2330": {"name": "台積電"}})
    impact = SimpleNamespace(**output.impacts[0].model_dump(exclude={"evidence"}), evidence=json.dumps([quote]))
    analysis = SimpleNamespace(events_json=json.dumps([event.model_dump() for event in output.events]), input_hash="h", config_hash="c")
    result = impact_payload({"content_chunk": raw, "char_start": 10}, analysis, [impact])
    assert result["impact_company_ids"] == ["2330"]
    context = result["impact_context"][0]
    assert context["quotes"] == ["台積電  營收成長"]
    assert context["quote_spans"] == [{"field": "content", "start": 10, "end": 19}]
    assert source_quote_span(raw, "未發生") is None
    assert source_quote_span("甲<b>乙</b> &amp; 丙", "甲乙 & 丙") == (0, 17)


def test_head_tail_window_keeps_revision_and_marks_omitted_middle():
    content = "公司營收成長。" * 800 + "惟公司下修全年財測。"
    visible = analysis_content_window(content)
    assert "下修全年財測" in visible and "omitted middle" in visible
    assert visible != content and estimate_token_count(visible) <= 4500


def test_sync_lag_preserves_text_related_article_and_rejects_wrong_tags(db_session, settings, monkeypatch):
    catalog = {"2330": {"name": "台積電", "industry": "TWSE:24"}, "2317": {"name": "鴻海"}}
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: catalog)
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1"})
    chunk_metadata.create_all(db_session.get_bind())
    article = NewsArticle(article_id="lag", title="台積電營收", content="台積電營收成長。", content_kind="full", pub_time="2026-09-01 12:00:00")
    db_session.add(article)
    db_session.flush()
    chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION, max_chars=settings.NEWS_CHUNK_MAX_CHARS,
                           overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS, embedding_model=settings.EMBED_MODEL)[0]
    insert_article_chunks(db_session, [chunk])
    db_session.commit()
    retrieval = RetrievalService(None, settings, object(), sessionmaker(bind=db_session.get_bind()))
    candidate = {"payload": {**chunk, "page_content": chunk["content_chunk"], "stock_ids": ["2330", "2317"]}}
    assert len(retrieval._fresh_hits([candidate], ["2330"])) == 1
    db_session.add(NewsEventAnalysis(article_id="lag", input_hash=article_hash(article), config_hash=config_hash(settings, catalog), status="success", events_json="[]"))
    db_session.commit()
    result = retrieval._fresh_hits([candidate], ["2330"])
    assert len(result) == 1 and result[0]["payload"]["analysis_status"] == "metadata_pending"
    assert retrieval._fresh_hits([candidate], ["2317"]) == []
    article.content = "原文已更動"
    db_session.commit()
    assert retrieval._fresh_hits([candidate], ["2330"]) == []


def test_low_score_guidance_does_not_replace_general():
    general = hit("good", content="完整財報", score=.9)
    guidance = hit("poor", content="不相關內容", score=.01)
    general["payload"]["article_id"] = guidance["payload"]["article_id"] = "one"
    vector = FakeVector(lambda emb, args: [general] if emb == [1.] else [guidance] if emb == [2.] else [])
    result = asyncio.run(service(vector).analyze(RetrievalRequest(symbols=["2330"], as_of="2024-01-31 23:59:59")))
    assert result.news_sources[0].id == "good"


def test_question_refills_after_duplicate_articles_with_bounded_candidates():
    duplicates = [hit(f"d{i}") for i in range(40)]
    for candidate in duplicates:
        candidate["payload"]["article_id"] = "same"
    candidates = duplicates + [hit(f"other{i}") for i in range(8)]
    vector = FakeVector(lambda emb, args: candidates[:args["limit"]])
    result = asyncio.run(service(vector).search_question("revenue", ["2330"], "2024-01-01", "2024-01-31 23:59:59"))
    assert len(result.hits) == 10
    assert [args["limit"] for _, args in vector.calls] == [40, 120]


def test_sync_failure_stops_cache_warmup(tmp_path):
    calls = []
    def run(command):
        calls.append(command[0])
        return 7 if command[0] == "news-impact-sync" else 0
    assert run_pipeline("rag", start=date(2026, 1, 1), symbols="2330", output=tmp_path, run=run) == 7
    assert "cache-warmup" not in calls


@pytest.mark.parametrize("filters, expected", [
    ({}, ["direct"]), ({"direction": "negative"}, []), ({"direction": "positive"}, ["direct"]),
    ({"importance": "high"}, ["direct"]), ({"importance": "low"}, []),
    ({"scope": "market"}, []), ({"scope": "company"}, ["direct"]),
    ({"industry": "TWSE:24"}, []), ({"topic": "ai"}, ["direct"]), ({"topic": "inflation"}, []),
    ({"page": 2}, []),
])
def test_related_filters_apply_to_same_target_and_pool_count(monkeypatch, filters, expected):
    catalog = {"2330": {"name": "台積電", "industry": "TWSE:24"}}
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: catalog)
    items = [News(article_id="irrelevant", title="航運消息", content="航運公司", pub_time="2024-01-31 12:00:00"),
        News(article_id="direct", title="台積電消息", content="台積電財報", pub_time="2024-01-30 12:00:00",
             event_analysis={"status": "success", "events": [{"key": "e1", "summary": "AI需求", "statement_type": "fact", "topics": ["ai"]}],
                 "impacts": [{"event_key": "e1", "target_type": "company", "target_id": "2330", "direction": "positive", "importance": "high", "basis": "reported", "reason": "需求成長"}]})]
    monkeypatch.setattr("app.features.retrieval.repository.articles_for_hits", lambda db, hits, **kwargs: items)
    monkeypatch.setattr("app.features.news.service.attach_event_analysis", lambda *args, **kwargs: items)
    retrieval = service(FakeVector(lambda emb, args: [hit("irrelevant", score=.99), hit("direct", score=.5)]))
    result = asyncio.run(retrieval.related_news(None, symbol="2330", as_of="2024-01-31 23:59:59", limit=1, **filters))
    assert [item.article_id for item in result["items"]] == expected
    assert result["total_is_exact"] is False and result["result_scope"] == "retrieved_candidates"
    if filters == {"page": 2}:
        assert result["total"] == 1


def test_related_time_bounds_and_invalid_window(db_session):
    vector = FakeVector()
    retrieval = service(vector)
    result = asyncio.run(retrieval.related_news(db_session, symbol="2330", start_time="2024-01-03",
        end_time="2024-01-10", as_of="2024-01-31", sort_by="created_at"))
    assert result["total"] == 0
    query = vector.calls[0][1]
    assert query["start"].day == 3 and query["end"].day == 10 and query["limit"] == 200
    from app.core.errors import AppError
    with pytest.raises(AppError, match="start_time"):
        asyncio.run(retrieval.related_news(db_session, symbol="2330", start_time="2024-02-01", as_of="2024-01-01"))


def test_industry_filter_excludes_other_sector_even_with_higher_rank(monkeypatch):
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: {"2330": {"name": "台積電", "industry": "TWSE:24"}})
    items = []
    for article_id, industry in [("shipping", "TWSE:20"), ("chips", "TPEx:24")]:
        items.append(News(article_id=article_id, title="產業消息", content="需求改善", target_industries=["TWSE:24", "TPEx:24"],
            event_analysis={"status": "success", "impacts": [{"event_key": "e1", "target_type": "industry", "target_id": industry,
                "direction": "positive", "importance": "high", "basis": "inferred", "reason": "需求改善"}]}))
    monkeypatch.setattr("app.features.retrieval.repository.articles_for_hits", lambda *args, **kwargs: items)
    monkeypatch.setattr("app.features.news.service.attach_event_analysis", lambda *args, **kwargs: items)
    retrieval = service(FakeVector())
    result = asyncio.run(retrieval.related_news(None, symbol="2330", relation="industry_context"))
    assert [item.article_id for item in result["items"]] == ["chips"]
