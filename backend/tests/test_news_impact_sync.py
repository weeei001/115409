import asyncio
from datetime import datetime
import json

from sqlalchemy.orm import sessionmaker

from app.db.models.news_article import NewsArticle
from app.db.models.news_chunk import chunk_metadata
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.news.impact import article_hash, config_hash
from app.features.retrieval.service import RetrievalService
from app.jobs.impact import sync
from app.features.retrieval.chunking import article_chunks
from app.jobs.ingestion.repository import insert_article_chunks


class FakeWriter:
    def __init__(self, chunk):
        self.payload = {chunk["chunk_id"]: {"id": "point-1", "payload": {
            **chunk, "page_content": chunk["content_chunk"]}}}
        self.updates = []

    async def require_collection(self):
        pass

    async def chunk_payloads(self, ids):
        return {key: self.payload[key] for key in ids if key in self.payload}

    async def set_chunk_payload(self, point_id, payload):
        self.updates.append((point_id, payload))
        next(point for point in self.payload.values() if point["id"] == point_id)["payload"].update(payload)


def test_payload_only_sync_and_sql_version_guard(db_session, settings, monkeypatch):
    catalog = {"2330": {"name": "台積電", "industry": "TWSE:24", "industry_name": "半導體業"}}
    monkeypatch.setattr(sync, "load_catalog", lambda: catalog)
    monkeypatch.setattr("app.features.retrieval.service.load_catalog", lambda: catalog)
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1", "EMBED_MODEL": "test-embedding-model"})
    chunk_metadata.create_all(db_session.get_bind())
    article = NewsArticle(article_id="event-news", title="央行宣布利率政策", content="央行宣布利率政策影響台股資金。",
                          content_kind="full", pub_time=datetime.now().strftime("%Y-%m-%d 12:00:00"))
    db_session.add(article)
    db_session.flush()
    chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
                           max_chars=settings.NEWS_CHUNK_MAX_CHARS,
                           overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
                           embedding_model=settings.EMBED_MODEL)[0]
    insert_article_chunks(db_session, [chunk])
    analysis = NewsEventAnalysis(article_id=article.article_id, input_hash=article_hash(article),
        config_hash=config_hash(settings, catalog), status="success", events_json=json.dumps([{
            "key": "e1", "summary": "央行宣布利率政策", "topics": ["interest_rates"]}], ensure_ascii=False))
    db_session.add(analysis)
    db_session.add(NewsEventImpact(article_id=article.article_id, event_key="e1", target_type="market",
        target_id="TW", direction="uncertain", importance="high", basis="inferred",
        reason="政策可能改變市場資金條件", evidence=json.dumps([{"field": "content", "quote": "影響台股資金"}], ensure_ascii=False),
        topics=",interest_rates,"))
    db_session.commit()
    factory = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)
    writer = FakeWriter(chunk)
    report = asyncio.run(sync.sync_impact_payloads(factory, writer, settings, execute=True))
    assert report["updated"] == 1 and len(writer.updates) == 1
    payload = writer.payload[chunk["chunk_id"]]["payload"]
    assert payload["impact_scopes"] == ["market"]
    assert payload["impact_topics"] == ["interest_rates"]
    assert payload["impact_context"][0]["quotes"] == ["影響台股資金"]

    retrieval = RetrievalService(http=None, settings=settings, vector=object(), session_factory=factory)
    hit = {"id": "point-1", "payload": payload, "score": 0.9}
    assert retrieval._fresh_hits([hit], None)[0]["payload"]["impact_context"]
    stale_analysis = {**payload, "analysis_input_hash": "old"}
    assert "impact_context" not in retrieval._fresh_hits([{**hit, "payload": stale_analysis}], None)[0]["payload"]
    from app.features.news.versions import set_selection, source_identity
    key, canonical = source_identity(article)
    set_selection(db_session, key, canonical, None, "conflict", "Conflicting publisher revisions")
    db_session.commit()
    assert retrieval._fresh_hits([hit], None) == []

    cleared = asyncio.run(sync.sync_impact_payloads(factory, writer, settings, execute=True))
    assert cleared["updated"] == 1
    assert payload["impact_context"] == [] and payload["impact_scopes"] == []
    assert payload["analysis_status"] == "pending" and payload["analysis_input_hash"] == ""
    assert asyncio.run(sync.sync_impact_payloads(factory, writer, settings, execute=True))["updated"] == 0
    set_selection(db_session, key, canonical, article.article_id, "active", "Publisher revision checked")
    db_session.commit()
    assert asyncio.run(sync.sync_impact_payloads(factory, writer, settings, execute=True))["updated"] == 1
    assert retrieval._fresh_hits([hit], None)[0]["payload"]["impact_context"]
    article.content = "央行修改新聞內容。"
    db_session.commit()
    assert retrieval._fresh_hits([hit], None) == []


def test_targeted_sync_filters_before_pagination_and_keeps_unselected_payload(db_session, settings, monkeypatch):
    catalog = {"2330": {"name": "TSMC", "industry": "TWSE:24", "industry_name": "Semiconductors"}}
    monkeypatch.setattr(sync, "load_catalog", lambda: catalog)
    settings = settings.model_copy(update={"NEWS_INDEX_VERSION": "news-v1"})
    chunk_metadata.create_all(db_session.get_bind())
    chunks = []
    for article_id in ("a-unselected", "m-selected", "z-selected"):
        article = NewsArticle(article_id=article_id, title="Market news", content="Market funding changed.",
                              content_kind="full", pub_time="2000-01-01 12:00:00")
        db_session.add(article)
        db_session.flush()
        article_chunk = article_chunks(vars(article), index_version=settings.NEWS_INDEX_VERSION,
            max_chars=settings.NEWS_CHUNK_MAX_CHARS, overlap_chars=settings.NEWS_CHUNK_OVERLAP_CHARS,
            embedding_model=settings.EMBED_MODEL)[0]
        insert_article_chunks(db_session, [article_chunk])
        chunks.append(article_chunk)
        if article_id != "a-unselected":
            db_session.add(NewsEventAnalysis(article_id=article_id, input_hash=article_hash(article),
                config_hash=config_hash(settings, catalog), status="success", events_json="[]"))
    db_session.commit()
    writer = FakeWriter(chunks[0])
    writer.payload = {chunk["chunk_id"]: {"id": chunk["article_id"], "payload": {
        **chunk, "analysis_status": "old", "impact_context": [{"reason": "Keep unselected metadata"}]}}
        for chunk in chunks}
    factory = sessionmaker(bind=db_session.get_bind(), expire_on_commit=False)
    report = asyncio.run(sync.sync_impact_payloads(factory, writer, settings, execute=True,
        article_ids=["z-selected", "m-selected"], page_size=1, limit=2))
    assert report["read"] == 2 and report["updated"] == 2
    assert [point_id for point_id, _ in writer.updates] == ["m-selected", "z-selected"]
    assert all(writer.payload[chunk["chunk_id"]]["payload"]["analysis_status"] == "success"
               for chunk in chunks[1:])
    assert writer.payload[chunks[0]["chunk_id"]]["payload"]["impact_context"] == [
        {"reason": "Keep unselected metadata"}]
    assert asyncio.run(sync.sync_impact_payloads(factory, writer, settings,
        article_ids=[], execute=True))["read"] == 0
