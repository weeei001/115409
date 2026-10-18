from datetime import date
from types import SimpleNamespace

import pytest

from app.features.analysis.evidence import EvidenceBundle, build_news_items
from app.features.analysis.service import AnalysisService
from app.features.analysis.router import get_service


def test_attribution_disclaimer_is_not_target_price_or_guarantee():
    from app.features.analysis.compliance import scan_compliance_hits
    note = "新聞中提及的目標價為分析師觀點，非事實保證。"
    assert not scan_compliance_hits(note)
    assert any(hit.severity == "hard" for hit in scan_compliance_hits(note + "目標價 300 元。"))


def fixture(published, quote="公司公布最新營收，並表示需求仍待觀察。", use="reported_fact", event_date=None):
    bundle = EvidenceBundle(symbol="2330", as_of_date=date(2026, 9, 2),
        daily_timeline=[{"id": "d_01", "date": "2026-07-31", "close": 100}],
        news=[{"id": "nw_01", "field": "news", "value": quote, "published_at": published}])
    item = {"id": "kd_01", "date": "2026-07-31", "ref": "d_01", "what": "營收造成當日上漲",
            "evidence_ids": ["d_01", "nw_01"], "news_support": [
                {"evidence_id": "nw_01", "quote": quote, "use": use, "event_date": event_date}]}
    return bundle, item


def test_latest_content_note_is_one_limitation_not_a_missing_field(db_session, settings):
    from app.features.analysis.evidence import build_evidence_bundle
    from app.features.news.versions import LATEST_CONTENT_LIMITATION
    from app.features.retrieval.schemas import RagResult
    from app.db.models.stock_info import StockInfo
    from test_analysis_service import FakeLlm, FakeRag, run_service, seed_prices

    db_session.add(StockInfo(symbol="2330", name="TSMC"))
    db_session.commit()
    seed_prices(db_session)
    news = {"title": "台積電營收", "summary": "台積電公布營收。", "publisher": "鉅亨網",
            "timestamp": "2026-07-10T09:19:00+08:00", "source_state": {"revision_id": 1}}
    result = run_service(db_session, settings, FakeLlm(), FakeRag(RagResult(news_sources=[news])))
    assert result.limitations.count(LATEST_CONTENT_LIMITATION) == 1
    assert not any(text.startswith("缺少：") and "新聞" in text for text in result.limitations)
    # Every stored article shares this property, so it is disclosed but never counted as missing data.
    empty_rows = {"price_rows": [], "chip_rows": [], "technical_rows": [], "income_rows": [],
                  "revenue_rows": [], "valuation_rows": []}
    from datetime import date
    bundle = build_evidence_bundle(symbol="2330", as_of_date=date(2026, 7, 31), rows=empty_rows, news_sources=[news])
    assert LATEST_CONTENT_LIMITATION not in bundle.missing_fields


def test_ambiguous_opinion_words_preserve_the_brief_without_content_checks(db_session, settings, monkeypatch):
    from app.db.models.stock_info import StockInfo
    from app.features.analysis import validation
    from test_analysis_service import FakeLlm, brief_payload, run_service, seed_prices

    def unexpected_content_check(*args, **kwargs):
        pytest.fail("Generating a brief must not scan or gate its content")

    monkeypatch.setattr(validation, "_scan_text_brief_compliance", unexpected_content_check)
    monkeypatch.setattr(validation, "_apply_text_brief_compliance_gate", unexpected_content_check)
    monkeypatch.setattr(validation, "scan_compliance_hits", unexpected_content_check)
    db_session.add(StockInfo(symbol="2330", name="TSMC"))
    db_session.commit()
    seed_prices(db_session)
    payload = brief_payload()
    payload["current_status"][0]["text"] = "基本面提供支撐，長期趨勢仍看好。"
    llm = FakeLlm(payload)
    response = run_service(db_session, settings, llm)
    assert response.status == "limited" and llm.calls == 1
    assert response.brief.current_status[0].text == payload["current_status"][0]["text"]
    assert response.verification["soft_compliance_hits"] == 0
    assert response.verification["compliance_violations"] == 0
    assert response.verification["removed_item_ids"] == 0


def test_unknown_time_and_fact_groups_survive_evidence_packet():
    source = {"title": "Report", "summary": "Report passage", "timestamp": "2026-09-01",
              "shared_fact_ids": ["fact-1"], "shared_facts": [{"fact_id": "fact-1"}],
              "retrieval_branch": "guidance", "observed_at": "2026-09-02T10:00:00+08:00"}
    item = build_news_items([source], summary_chars=None)[0]
    assert item["published_time_precision"] == "date" and "published_at" not in item
    assert "first_public_at" not in item and item["observed_at"] == source["observed_at"]
    assert item["shared_facts"] == source["shared_facts"]


def test_analysis_default_retrieval_requires_and_receives_independent_factory(settings):
    with pytest.raises(ValueError, match="session factory"):
        AnalysisService(db=None, settings=settings, http=None)
    factory = lambda: None
    request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(
        settings=settings, http=None, session_factory=factory)))
    service = get_service(request, db=None)
    assert service.rag.session_factory is factory


def test_analysis_default_retrieval_checks_sql_content_and_propagates_failure(db_session, settings, monkeypatch):
    import asyncio
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.exc import OperationalError
    from app.core.errors import ServiceUnavailable
    from app.db.models.news_article import NewsArticle
    from app.db.models.stock_info import StockInfo
    from app.db.models.news_chunk import chunk_metadata
    from app.features.retrieval.chunking import article_chunks
    from app.jobs.ingestion.repository import insert_article_chunks
    from app.features.analysis.schemas import StockBehaviorRagRequest
    from test_retrieval import FakeVector

    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: {"2330": {"name": "台積電"}})
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1"})
    chunk_metadata.create_all(db_session.get_bind())
    db_session.add(StockInfo(symbol="2330", name="TSMC"))
    article = NewsArticle(article_id="freshness", title="台積電營收", content="台積電營收成長。",
                          content_kind="full_text", pub_time="2026-09-01T12:00:00+08:00")
    db_session.add(article)
    db_session.flush()
    chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
                           max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
                           embedding_model=settings.EMBED_MODEL)[0]
    insert_article_chunks(db_session, [chunk])
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind())
    service = AnalysisService(db=db_session, settings=settings, http=None, session_factory=factory)
    hit = {"id": chunk["chunk_id"], "score": .9, "payload": {**chunk, "page_content": chunk["content_chunk"]}}
    service.rag.vector = FakeVector(lambda *_: [hit])
    request = StockBehaviorRagRequest(symbols=["2330"], as_of_date=date(2026, 9, 2))
    assert asyncio.run(service.collect_rag_news(request)).news_sources
    article.content = "台積電更正營收內容。"
    db_session.commit()
    assert not asyncio.run(service.collect_rag_news(request)).news_sources
    def unavailable():
        raise OperationalError("SELECT", {}, RuntimeError("offline"))
    service.rag.session_factory = unavailable
    with pytest.raises(ServiceUnavailable):
        asyncio.run(service.collect_rag_news(request))
