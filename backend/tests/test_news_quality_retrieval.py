"""News quality checks use fixed sources, without model or vector provider calls."""
import asyncio
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy.orm import sessionmaker

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import chunk_metadata
from app.db.models.news_impact import NewsEventAnalysis
from app.features.news.impact import article_hash, config_hash, validate_output
from app.features.news.sentiment import company_mentions, extract_candidate_stocks
from app.features.retrieval.chunking import article_chunks
from app.features.retrieval.facts import group_shared_facts
from app.features.retrieval.impact_metadata import impact_payload
from app.features.retrieval.schemas import RetrievalRequest
from app.features.retrieval.service import RetrievalService
from app.jobs.ingestion.repository import insert_article_chunks
from test_retrieval import FakeVector, hit, service


CATALOG = {"2603": {"name": "長榮"}, "2618": {"name": "長榮航"}, "2330": {"name": "台積電"}, "2317": {"name": "鴻海"}}


def test_overlapping_name_is_resolved_per_position_with_independent_mentions_retained():
    text = "長榮航(2618)貨運需求成長，長榮海運(2603)有淡季壓力。"
    mentions = company_mentions(None, text, CATALOG)
    assert next(item for item in mentions if item["start"] == 0)["symbol"] == "2618"
    assert extract_candidate_stocks(None, None, "長榮航貨運", "航空公司展望", CATALOG) == ["2618"]
    assert extract_candidate_stocks(None, None, None, "長榮(2618)航空業務", CATALOG) == ["2618"]
    assert set(extract_candidate_stocks(None, None, None, text, CATALOG)) == {"2603", "2618"}
    assert all(text[item["start"]:item["end"]] in {"長榮航", "2618", "長榮", "2603"} for item in mentions)


def test_impact_validation_rejects_airline_quote_as_shipping_company():
    article = SimpleNamespace(title="長榮航貨運", content="長榮航(2618)航空貨運需求成長。")
    quote = {"field": "content", "quote": "長榮航(2618)航空貨運需求成長"}
    payload = {"events": [{"key": "e1", "summary": "航空貨運需求成長", "statement_type": "fact", "evidence": [quote]}],
        "impacts": [{"event_key": "e1", "target_type": "company", "target_id": "2603", "direction": "positive",
            "importance": "medium", "basis": "reported", "reason": "需求成長", "evidence": [quote]}]}
    with pytest.raises(ValueError, match="not explicitly mentioned"):
        validate_output(payload, article=article, catalog=CATALOG)
    payload["impacts"][0]["target_id"] = "2618"
    assert validate_output(payload, article=article, catalog=CATALOG).impacts[0].target_id == "2618"


def test_passage_requires_own_mention_or_current_quote_grounded_transmission(db_session, settings, monkeypatch):
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: CATALOG)
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1", "NEWS_CHUNK_MAX_CHARS": 25, "NEWS_CHUNK_OVERLAP_CHARS": 0})
    chunk_metadata.create_all(db_session.get_bind())
    article = NewsArticle(article_id="supply", title="台積電供應鏈", stock_id="2330", tags="2330,2317",
        content="鴻海調整伺服器產品線，供應商預計減少交貨。台積電另公布營收。", content_kind="full", pub_time="2026-09-01 12:00:00")
    db_session.add(article)
    db_session.flush()
    chunks = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
        max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=0, embedding_model=settings.EMBED_MODEL)
    insert_article_chunks(db_session, chunks)
    db_session.commit()
    first = chunks[0]
    assert "台積電" not in first["content_chunk"]
    candidate = {"payload": {**first, "page_content": first["content_chunk"]}}
    retrieval = RetrievalService(None, settings, object(), sessionmaker(bind=db_session.get_bind()))
    assert retrieval._fresh_hits([candidate], ["2330"]) == []
    quote = "供應商預計減少交貨"
    analysis = NewsEventAnalysis(article_id="supply", input_hash=article_hash(article), config_hash=config_hash(settings, CATALOG),
        status="success", events_json=json.dumps([{"key": "e1", "summary": "供應交貨減少", "statement_type": "forecast",
            "speaker": "供應商", "topics": ["company_operations"]}]))
    db_session.add(analysis)
    db_session.commit()
    impact = SimpleNamespace(event_key="e1", target_type="company", target_id="2330", direction="negative",
        importance="medium", basis="inferred", reason="供應量減少可能影響台積電", evidence=json.dumps([{"field": "content", "quote": quote}]))
    metadata = impact_payload(first, analysis, [impact])
    candidate["payload"].update(metadata)
    accepted = retrieval._fresh_hits([candidate], ["2330"])
    assert len(accepted) == 1
    context = accepted[0]["payload"]["impact_context"][0]
    assert context["statement_type"] == "forecast" and context["speaker"] == "供應商"
    candidate["payload"]["analysis_config_hash"] = "old"
    assert retrieval._fresh_hits([candidate], ["2330"]) == []
    from app.features.news.versions import record_version
    record_version(db_session, article, observed_at=datetime(2026, 9, 15))
    db_session.commit()
    assert len(retrieval._fresh_hits([candidate], ["2317"], datetime(2026, 9, 10, tzinfo=timezone.utc))) == 1
    assert retrieval._fresh_hits([candidate], ["2317"], datetime(2026, 8, 31, tzinfo=timezone.utc)) == []
    assert len(retrieval._fresh_hits([candidate], ["2317"], datetime(2026, 9, 20, tzinfo=timezone.utc))) == 1


def fact_source(identifier, quote, *, statement="fact", speaker=None):
    return {"id": identifier, "article_id": identifier, "chunk_id": identifier, "revision": "r1",
        "timestamp": "2026-09-10 12:00:00", "url": f"https://news.test/{identifier}", "summary": quote + " 新增產品風險仍需留意。",
        "analysis_status": "success", "impact_context": [{"target_type": "company", "target_id": "2330",
            "statement_type": statement, "speaker": speaker, "quotes": [quote]}]}


def test_monthly_revenue_combines_equivalent_amounts_and_retains_extra_text_and_citations():
    sources = [fact_source("a", "台積電2026年8月營收達1.5億元"), fact_source("b", "台積電2026年8月合併營收為15000萬元")]
    grouped = group_shared_facts(sources, CATALOG)
    assert grouped[0]["shared_fact_ids"] == grouped[1]["shared_fact_ids"]
    fact = grouped[0]["shared_facts"][0]
    assert fact["status"] == "shared" and fact["distinct_fact_count"] == 1
    assert fact["independent_corroboration"] == "not_established"
    assert [ref["article_id"] for ref in fact["source_refs"]] == ["a", "b"]
    assert grouped[1]["shared_facts"] == []
    assert [source["summary"] for source in grouped] == [source["summary"] for source in sources]


def test_revenue_conflict_is_retained_not_averaged_or_silently_chosen():
    grouped = group_shared_facts([fact_source("a", "台積電2026年8月營收達49.8億元"),
                                  fact_source("b", "台積電2026年8月營收達4.98億元")], CATALOG)
    fact = grouped[0]["shared_facts"][0]
    assert fact["status"] == "conflict" and len(fact["source_refs"]) == 2
    assert len({ref["value"] for ref in fact["source_refs"]}) == 2


@pytest.mark.parametrize("quote", [
    "台積電2026年8月份合併營收為約新臺幣15,000萬元",
    "台積電2026/08營收達到新台幣1.5億元",
    "台積電2026-8營收金額：約台幣150,000千元",
])
def test_revenue_currency_and_amount_phrases_keep_equivalent_values(quote):
    grouped = group_shared_facts([fact_source("a", "台積電2026年8月營收達1.5億元"),
                                  fact_source("b", quote)], CATALOG)
    assert grouped[0]["shared_facts"][0]["status"] == "shared"


@pytest.mark.parametrize("second", [
    "台積電2026年9月營收達1.5億元", "台積電2025年8月營收達1.5億元", "台積電營收成長",
    "鴻海2026年8月營收達1.5億元",
    "台積電與鴻海2026年8月營收達1.5億元",
    "台積電2026年8月營收達1.5億元人民幣",
    "台積電2026年8月營收達15,00萬元",
])
def test_different_period_or_company_or_unknown_event_is_not_merged(second):
    grouped = group_shared_facts([fact_source("a", "台積電2026年8月營收達1.5億元"), fact_source("b", second)], CATALOG)
    assert all(not source["shared_facts"] for source in grouped)


def test_exact_dated_forecast_by_same_speaker_is_one_statement():
    quote = "董事長於2026年9月10日表示明年產能預計增加。"
    grouped = group_shared_facts([fact_source("a", quote, statement="forecast", speaker="董事長"),
                                  fact_source("b", quote, statement="forecast", speaker="董事長")], CATALOG)
    assert grouped[0]["shared_facts"][0]["status"] == "shared"
    different = fact_source("c", quote, statement="forecast", speaker="分析師")
    assert not group_shared_facts([grouped[0], different], CATALOG)[0]["shared_facts"]


def test_guidance_requires_current_statement_and_keeps_original_observations():
    general = hit("fact", content="台積電本季毛利率下滑")
    forecast = hit("forecast", content="台積電預計下季毛利率回升", score=.01)
    general["payload"]["article_id"] = forecast["payload"]["article_id"] = "article"
    forecast["payload"].update(analysis_status="success", impact_context=[{
        "statement_type": "forecast", "target_type": "company", "target_id": "2330",
        "topics": ["company_operations"], "quotes": ["台積電預計下季毛利率回升"]}])
    retrieval = service(FakeVector(lambda emb, args: [general] if emb == [1.] else [forecast] if emb == [2.] else []))
    result = asyncio.run(retrieval.analyze(RetrievalRequest(symbols=["2330"], as_of="2024-01-31 23:59:59")))
    assert [(source.id, source.kind) for source in result.news_sources] == [("fact", "general"), ("forecast", "guidance")]
    assert result.news_sources[1].retrieval_branch == "guidance"


@pytest.mark.parametrize("content,title,target,stale,expected", [
    ("貨櫃海運進入傳統淡季，運價支撐減弱。", "海運淡季", "TWSE:15", False, True),
    ("長榮航航空貨運需求成長。", "航空貨運", "TWSE:15", False, False),
    ("貨運需求成長。", "長榮航展望", "TWSE:15", False, False),
    ("貨櫃海運進入傳統淡季。", "海運淡季", "TWSE:24", False, False),
    ("貨櫃海運進入傳統淡季。", "海運淡季", "TWSE:15", True, False),
])
def test_industry_background_requires_current_exact_quote_and_no_company_specific_passage(
        db_session, settings, monkeypatch, content, title, target, stale, expected):
    catalog = {"2603": {"name": "長榮", "industry": "TWSE:15"},
               "2618": {"name": "長榮航", "industry": "TWSE:15"}}
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: catalog)
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1"})
    chunk_metadata.create_all(db_session.get_bind())
    article = NewsArticle(article_id="industry", title=title, content=content, stock_id="2603",
                          tags="2603,2618", content_kind="full", pub_time="2026-09-01 12:00:00")
    db_session.add(article)
    db_session.flush()
    chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
        max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
        embedding_model=settings.EMBED_MODEL)[0]
    insert_article_chunks(db_session, [chunk])
    analysis = NewsEventAnalysis(article_id=article.article_id, input_hash=article_hash(article),
        config_hash=config_hash(settings, catalog), status="success",
        events_json=json.dumps([{"key": "e1", "summary": content, "statement_type": "forecast"}]))
    db_session.add(analysis)
    db_session.commit()
    impact = SimpleNamespace(event_key="e1", target_type="industry", target_id=target,
        direction="negative", importance="medium", basis="inferred", reason="Sector outlook",
        evidence=json.dumps([{"field": "content", "quote": content}]))
    payload = {**chunk, "page_content": content, **impact_payload(chunk, analysis, [impact])}
    if stale:
        payload["analysis_config_hash"] = "old"
    retrieval = RetrievalService(None, settings, object(), sessionmaker(bind=db_session.get_bind()))
    accepted = retrieval._fresh_hits([{"payload": payload}], ["2603"])
    assert bool(accepted) is expected
    if expected:
        from app.features.retrieval.common import source_provenance
        from app.features.retrieval.schemas import NewsSource
        provenance = source_provenance(accepted[0]["payload"])
        source = NewsSource(id="industry", title=title, summary=content, timestamp=article.pub_time,
                            url="", **provenance)
        assert source.source_relationships == [{"symbol": "2603", "scope": "industry",
            "relationship": "industry_context", "target_id": "TWSE:15"}]
        payload["impact_context"][0]["quotes"] = ["A fabricated sector claim"]
        assert retrieval._fresh_hits([{"payload": payload}], ["2603"]) == []


@pytest.mark.parametrize("timestamp", ["2026-09-01T10:00:00+08:00", "2026-09-01 10:00:00", "2026-09-01"])
def test_collect_preserves_original_timestamp_precision_and_timezone(settings, monkeypatch, timestamp):
    from datetime import date
    from app.features.retrieval.schemas import NewsSource, RetrievalResponse
    retrieval = RetrievalService(None, settings, object())

    async def analyze(request):
        return RetrievalResponse(news_sources=[NewsSource(id="time", title="News", summary="News",
            timestamp=timestamp, url="")])

    monkeypatch.setattr(retrieval, "analyze", analyze)
    result = asyncio.run(retrieval.collect(symbol="2603", as_of=date(2026, 9, 2)))
    assert result.news_sources[0]["timestamp"] == timestamp


def test_company_aliases_require_catalog_membership_and_match_word_boundaries():
    catalog = {"2330": {"name": "台積電"}, "2317": {"name": "鴻海"}, "2454": {"name": "聯發科"}}
    for name, symbol in (("TSMC", "2330"), ("台積", "2330"), ("Foxconn", "2317"),
                         ("富士康", "2317"), ("MediaTek", "2454")):
        assert extract_candidate_stocks(None, None, name, None, catalog) == [symbol]
        assert extract_candidate_stocks(None, None, name, None, {}) == []
    assert company_mentions("notTSMC MediaTekology", None, catalog) == []
