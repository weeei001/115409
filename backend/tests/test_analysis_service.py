import asyncio
import json
import threading
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import httpx
import pytest
from sqlalchemy import select

from app.clients.llm import LlmResult
from app.clients.rag import RagResult
from app.core.errors import AppError
from app.db.models.daily_price import DailyPrice
from app.db.models.llm_response import LlmResponse
from app.db.models.news_article import NewsArticle
from app.db.models.stock_info import StockInfo
from app.features.analysis import repository, validation as gate
from app.features.analysis.evidence import build_evidence_bundle
from app.features.analysis.router import get_service
from app.features.analysis.schemas import StockBehaviorTextBriefRequest, StockBehaviorTextBriefResponse
from app.features.analysis.service import (AnalysisService, build_llm_runtime_config,
                                          compute_config_hash, detect_simplified_chinese)


AS_OF = date(2026, 7, 13)


def brief_payload():
    claim = {"id": "cs_01", "claim_type": "observation", "text": "Price increased with mixed evidence.",
             "direction": "mixed", "evidence_ids": ["d_04"], "importance": "high"}
    view = {"stance": "uncertain", "reason": "Evidence coverage is limited.",
            "invalidation": "A change in reported operating conditions.", "evidence_ids": ["d_04"]}
    return {"headline": "Mixed operating evidence", "key_days": [
        {"id": f"kd_{index:02d}", "date": f"2026-07-{9 + index:02d}", "ref": f"d_{index:02d}",
         "what": "Price changed.", "evidence_ids": [f"d_{index:02d}"]} for index in (2, 3, 4)],
        "current_status": [claim], "positive_factors": [{**claim, "id": "pos_01"}],
        "negative_factors": [{**claim, "id": "neg_01"}], "source_divergences": [],
        "risks": [{"id": "rk_01", "risk_type": "operating", "description": "Reported demand may change.",
                   "trigger": "Company disclosures change.", "evidence_ids": ["d_04"]}],
        "watch_points": [{"id": f"wp_{index:02d}", "what_to_watch": "Future public reports",
            "why_it_matters": "Reports clarify operating conditions.", "when": "Time unconfirmed", "evidence_ids": ["d_04"]} for index in (1, 2)],
        "forward_views": {horizon: deepcopy(view) for horizon in ("short_1_5", "swing_6_20", "medium_21_40")},
        "overall_stance": "uncertain", "confidence": "low", "confidence_reason": "Limited evidence coverage.",
        "limitations": []}


class FakeLlm:
    model_name = "test-model"

    def __init__(self, payload=None):
        self.payload = payload if payload is not None else brief_payload()
        self.calls = 0
        self.packet = None

    def require_enabled(self):
        return None

    async def generate(self, *, system_prompt, payload, schema, examples=()):
        self.calls += 1
        self.packet = payload
        for example_input, _ in examples:
            task = json.loads(example_input)["task"]
            assert task["as_of_date"] <= payload["task"]["as_of_date"]
        return LlmResult(deepcopy(self.payload), json.dumps(self.payload, ensure_ascii=False), {"truncated": False})


class FakeRag:
    def __init__(self, result=None):
        self.result = result or RagResult()
        self.calls = 0

    async def collect(self, **kwargs):
        self.calls += 1
        return self.result


def seed_prices(db):
    db.add_all([DailyPrice(symbol="2330", date=date(2026, 7, day), close=Decimal(100 + day),
                          volume_shares=1_000_000) for day in range(10, 15)])
    db.commit()


def run_service(db, settings, llm=None, rag=None, symbol="2330", **request):
    async def run():
        async with httpx.AsyncClient() as http:
            service = AnalysisService(db=db, settings=settings, http=http, llm=llm or FakeLlm(), rag=rag or FakeRag())
            return await service.generate_text_brief(StockBehaviorTextBriefRequest(symbol=symbol, as_of_date=AS_OF, **request))
    return asyncio.run(run())


def test_analysis_pipeline_thread_boundary_backfill_snapshot_and_cache(db_session, settings, monkeypatch):
    seed_prices(db_session)
    llm, rag = FakeLlm(), FakeRag()
    main_thread = threading.get_ident()
    thread_ids = []
    original = repository.collect_rows

    def collect(*args, **kwargs):
        thread_ids.append(threading.get_ident())
        return original(*args, **kwargs)
    monkeypatch.setattr(repository, "collect_rows", collect)
    first = run_service(db_session, settings, llm, rag)
    assert first.status == "limited" and not first.cached
    assert first.snapshot_id is not None and first.analysis_revision and first.config_hash
    assert first.brief.key_days[-1].move_pct == pytest.approx(0.89)
    assert thread_ids and all(identifier != main_thread for identifier in thread_ids)
    assert all(row["date"] <= AS_OF.isoformat() for row in llm.packet["daily_timeline"])
    assert llm.calls == rag.calls == 1
    cached = run_service(db_session, settings, llm, rag)
    assert cached.cached and cached.snapshot_id == first.snapshot_id
    assert cached.brief == first.brief and llm.calls == rag.calls == 1
    refreshed = run_service(db_session, settings, llm, rag, cache_only=True, force_refresh=True)
    assert not refreshed.cached and refreshed.snapshot_id > first.snapshot_id
    assert llm.calls == rag.calls == 2


def test_cache_only_miss_skips_every_external_call_and_persistence(db_session, settings):
    llm, rag = FakeLlm(), FakeRag()
    result = run_service(db_session, settings, llm, rag, cache_only=True)
    assert result.status == "unavailable" and result.brief is None
    assert llm.calls == rag.calls == 0
    assert db_session.scalars(select(LlmResponse)).all() == []


def test_simulation_snapshot_is_skipped_and_generation_excludes_simulated_sources(db_session, settings):
    seed_prices(db_session)
    first = run_service(db_session, settings)
    row = db_session.get(LlmResponse, first.snapshot_id)
    fields = {column.name: getattr(row, column.name) for column in LlmResponse.__table__.columns
              if column.name not in {"id", "created_at"}}
    payload = json.loads(row.response_json)
    payload["evidence_catalog"].append({"id": "nw_01", "field": "news", "value": "test",
        "publisher": "simulation_test", "url": "https://example.invalid/simulation/sample"})
    bad = LlmResponse(**{**fields, "response_json": json.dumps(payload)})
    db_session.add(bad)
    db_session.commit()
    assert repository.saved_brief(bad) is None
    assert run_service(db_session, settings, cache_only=True).snapshot_id == first.snapshot_id
    config = json.loads(row.config_json)
    config["purpose"] = "simulation"
    row.config_json = json.dumps(config)
    db_session.commit()
    assert run_service(db_session, settings, cache_only=True).status == "unavailable"
    llm = FakeLlm()
    result = run_service(db_session, settings, llm, FakeRag(RagResult(news_sources=[
        {"title": "【模擬測試・非真實新聞】衝突", "summary": "Fiction", "publisher": "simulation_test"},
        {"title": "公司導入模擬設計軟體", "summary": "Real announcement", "publisher": "publisher"},
    ])), force_refresh=True)
    assert [source["title"] for source in llm.packet["news"]] == ["公司導入模擬設計軟體"]
    assert any("模擬" in message for message in result.limitations)


@pytest.mark.parametrize("text", ["EPS 999", "股價為 999 元", "股價上漲 +2.03%"])
def test_unsupported_numeric_claim_is_not_published(db_session, settings, text):
    seed_prices(db_session)
    payload = brief_payload()
    payload["current_status"][0]["text"] = text
    llm = FakeLlm(payload)
    response = run_service(db_session, settings, llm)
    assert llm.calls == 1
    assert response.status == "limited" and response.brief.current_status == []
    assert text not in response.model_dump_json()


def test_empty_citation_direction_rejected_and_confidence_capped(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["confidence"] = "high"
    for view in payload["forward_views"].values():
        view.update(stance="bullish", evidence_ids=[])
    result = run_service(db_session, settings, FakeLlm(payload))
    assert result.status == "limited" and result.brief.confidence == "low"
    assert all(view.stance == "uncertain" and view.validation_status == "rejected"
               for view in (result.brief.forward_views.short_1_5, result.brief.forward_views.swing_6_20,
                            result.brief.forward_views.medium_21_40))
    assert "缺少" in " ".join(result.limitations)
    # The complete catalog is independent of which rows the model cited.
    assert {item.id for item in result.evidence_catalog} >= {"d_01", "d_02", "d_03", "d_04"}


def test_snapshot_audit_reports_only_ids_and_reasons():
    from app.features.analysis.audit import audit_snapshots
    result = audit_snapshots([{"id": 1, "symbol": "2330", "config_json": {"purpose": "production"},
        "response_json": {"evidence_catalog": [{"publisher": "simulation_test", "value": "private text"}]}},
        {"id": 2, "config_json": {"purpose": "production"}, "response_json": {}},
        {"id": 3, "response_json": "bad json"}])
    assert [item["id"] for item in result] == [1, 3]
    assert result[0]["reasons"] == ["simulation_source"]
    assert "private text" not in json.dumps(result)


def test_same_body_canonical_selection_and_rollback_invalidate_cached_brief(db_session, settings, monkeypatch):
    from app.db.models.news_version import NewsSourceDecision
    from app.features.news import versions
    from app.jobs import news_versions

    seed_prices(db_session)
    # Hold timestamps fixed so rollback must invalidate through the decision ID,
    # even though it restores exactly the original effective source and reason.
    fixed_now = datetime(2026, 7, 13, 12)
    monkeypatch.setattr(versions, "utc_now", lambda: fixed_now)
    monkeypatch.setattr(news_versions, "utc_now", lambda: fixed_now)
    first = NewsArticle(article_id="canonical-first", stock_id="2330", source="cnyes", title="台積電營收",
        content="台積電公布本月營收。", pub_time="2026-07-13T09:00:00+08:00",
        url="https://news.cnyes.com/news/id/6605885?utm_source=first")
    outside = NewsArticle(article_id="canonical-outside-window", stock_id="2317", source="cnyes", title=first.title,
        content=first.content, pub_time="2024-01-01T09:00:00+08:00",
        url="https://news.cnyes.com/news/id/6605885?utm_source=second")
    db_session.add_all([first, outside])
    db_session.flush()
    key, canonical = versions.source_identity(first)
    assert key == versions.source_identity(outside)[0]
    for article in (first, outside):
        versions.record_version(db_session, article, observed_at=None)
    versions.set_selection(db_session, key, canonical, first.article_id, "active", "original choice")
    db_session.commit()
    baseline = repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF)
    news_versions.choose(db_session, key, first.article_id, "original choice")
    db_session.commit()
    assert repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF) == baseline
    response = run_service(db_session, settings)
    def cached():
        return repository.load_cached(db_session, symbol="2330", as_of=AS_OF, config_hash=response.config_hash)
    assert cached() is not None
    news_versions.choose(db_session, key, outside.article_id, "reviewed second source")
    db_session.commit()
    selected = repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF)
    assert selected != baseline and cached() is None
    decision_id = db_session.scalar(select(NewsSourceDecision.id).order_by(NewsSourceDecision.id.desc()).limit(1))
    news_versions.rollback_decision(db_session, decision_id, "restore original source")
    db_session.commit()
    restored = repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF)
    assert restored not in {baseline, selected}
    assert cached() is None
    assert first.content == outside.content == "台積電公布本月營收。"


def test_cached_indirect_news_tracks_only_its_actual_sources_and_canonical_group(db_session, settings):
    from app.features.news import versions
    from app.jobs import news_versions
    from app.db.models.news_version import NewsSourceDecision

    seed_prices(db_session)
    article = NewsArticle(article_id="industry-source", stock_id="9999", source="cnyes", title="供應鏈需求",
        content="零組件產業需求放緩。", pub_time="2026-07-12T10:00:00+08:00",
        url="https://news.cnyes.com/news/id/9990001")
    alternative = NewsArticle(article_id="industry-alternative", stock_id="9999", source="cnyes", title=article.title,
        content=article.content, pub_time=article.pub_time, url=article.url + "?utm_source=copy")
    unrelated = NewsArticle(article_id="unrelated", stock_id="9998", source="cnyes", title="其他產業消息",
        content="無關公司的近況。", pub_time=article.pub_time, url="https://news.cnyes.com/news/id/9990002")
    db_session.add_all([article, alternative, unrelated])
    db_session.flush()
    key, canonical = versions.source_identity(article)
    for item in (article, alternative):
        versions.record_version(db_session, item, observed_at=None)
    versions.set_selection(db_session, key, canonical, article.article_id, "active", "reviewed")
    db_session.commit()
    base = repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF)
    source = {"article_id": article.article_id, "title": article.title, "summary": article.content,
              "timestamp": article.pub_time, "url": article.url}
    result = run_service(db_session, settings, rag=FakeRag(RagResult(news_sources=[source])))
    def cached():
        return repository.load_cached(db_session, symbol="2330", as_of=AS_OF, config_hash=result.config_hash)
    assert cached() is not None
    unrelated.content = "無關公司更新內容。"
    db_session.commit()
    assert cached() is not None
    original = article.content
    article.content = "零組件產業更正需求預測。"
    db_session.commit()
    assert repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF) == base
    assert cached() is None
    article.content = original
    db_session.commit()
    assert cached() is not None
    news_versions.choose(db_session, key, alternative.article_id, "confirmed alternative")
    db_session.commit()
    assert repository.input_fingerprint(db_session, symbol="2330", as_of=AS_OF) == base
    assert cached() is None
    decision_id = db_session.scalar(select(NewsSourceDecision.id).order_by(NewsSourceDecision.id.desc()).limit(1))
    news_versions.rollback_decision(db_session, decision_id, "restore")
    db_session.commit()
    assert cached() is None


def test_shared_fact_source_refs_are_included_in_snapshot_dependencies():
    catalog = [{"article_id": "representative", "shared_facts": [{"source_refs": [
        {"article_id": "second-source"}, {"article_id": "representative"}]}]}]
    assert repository.news_article_ids(catalog) == {"representative", "second-source"}


def test_grounding_rejects_wrong_period_sign_and_after_close_causality():
    from app.features.analysis.evidence import EvidenceBundle
    bundle = EvidenceBundle(symbol="2330", as_of_date=AS_OF,
        daily_timeline=[{"id": "d_01", "date": AS_OF.isoformat(), "chg_pct": -2.03, "foreign_net_lots": 100}],
        chip_summary=[{"id": "ch_01", "field": "foreign_net_10d_lots", "value": 5000}],
        news=[{"id": "nw_01", "field": "news", "published_at": "2026-07-13T16:33:00+08:00"}])
    for text, refs in [("上漲 +2.03%", ["d_01"]), ("外資單日買超 5000 張", ["ch_01"])]:
        assert gate._grounding_issues({"text": text, "evidence_ids": refs}, bundle)
    assert not gate._grounding_issues({"text": "下跌 2.03%", "evidence_ids": ["d_01"]}, bundle)
    assert not gate._grounding_issues({"text": "外資近十日買超 5000 張", "evidence_ids": ["ch_01"]}, bundle)
    assert gate._grounding_issues({"date": AS_OF.isoformat(), "what": "營收帶動股價上漲",
                                   "evidence_ids": ["nw_01", "d_01"]}, bundle)
    assert gate._grounding_issues({"stance": "uncertain", "reason": "EPS 999", "evidence_ids": []}, bundle)
    assert gate._grounding_issues({"text": "成交量增加 -2.03%", "evidence_ids": ["d_01"]}, bundle)
    bundle.news[0]["value"] = "營收增加 10%"
    issues = gate._grounding_issues({"text": "營收增加 10%", "evidence_ids": ["nw_01"]}, bundle)
    assert issues and all(issue.startswith("未核實") for issue in issues)
    bundle.fundamental = [{"id": "fd_01", "field": "revenue_monthly", "yoy_pct": -10}]
    assert not gate._grounding_issues({"text": "營收年減10%", "evidence_ids": ["fd_01"]}, bundle)
    bundle.fundamental[0]["yoy_pct"] = 10
    assert gate._grounding_issues({"text": "營收年減10%", "evidence_ids": ["fd_01"]}, bundle)


def test_body_only_company_news_correction_invalidates_cache(db_session, settings):
    seed_prices(db_session)
    article = NewsArticle(article_id="body-only", stock_id="other", title="Operating news",
                          content="台積電宣布營運消息", pub_time="2026-07-13T09:00:00")
    db_session.add(article)
    db_session.commit()
    run_service(db_session, settings)
    article.content = "台積電撤回營運展望"
    db_session.commit()
    assert run_service(db_session, settings, cache_only=True).status == "unavailable"


def test_latest_weekend_analysis_is_independent_of_price_day_and_historical_cutoff(db_session, settings):
    seed_prices(db_session)
    llm, rag = FakeLlm(), FakeRag()
    service = AnalysisService(db=db_session, settings=settings, http=None, llm=llm, rag=rag)
    thursday = asyncio.run(service.generate_text_brief(StockBehaviorTextBriefRequest(
        symbol="2330", as_of_date=date(2026, 9, 24))))
    rag.result = RagResult(news_sources=[{"title": "Weekend announcement", "summary": "New information",
        "timestamp": "2026-09-27T10:00:00+08:00", "article_id": "weekend"}])
    sunday = asyncio.run(service.generate_text_brief(StockBehaviorTextBriefRequest(
        symbol="2330", as_of_date=date(2026, 9, 27))))
    current = asyncio.run(service.generate_text_brief(StockBehaviorTextBriefRequest(
        symbol="2330", as_of_date=date(2026, 9, 27), cache_only=True)))
    historical = asyncio.run(service.generate_text_brief(StockBehaviorTextBriefRequest(
        symbol="2330", as_of_date=date(2026, 9, 24), cache_only=True)))
    assert current.snapshot_id == sunday.snapshot_id
    assert historical.snapshot_id == thursday.snapshot_id
    assert current.price_as_of_date == "2026-07-14" and current.news_cutoff_date == "2026-09-27"
    assert not any(item.field == "news" for item in historical.evidence_catalog)
    assert llm.calls == rag.calls == 2


def test_text_brief_accepts_symbols_from_stock_info(db_session, settings):
    db_session.add(StockInfo(symbol="1101", name="台泥"))
    db_session.add_all([DailyPrice(symbol="1101", date=date(2026, 7, day), close=Decimal(100 + day),
                                    volume_shares=1_000_000) for day in range(10, 15)])
    db_session.commit()
    result = run_service(db_session, settings, symbol="1101")
    assert result.symbol == "1101" and result.status == "limited"


@pytest.mark.parametrize("requested_date", [AS_OF, date(2026, 9, 12)])
def test_cache_only_rejects_saved_response_after_settings_change(db_session, settings, monkeypatch, requested_date):
    seed_prices(db_session)
    llm, rag = FakeLlm(), FakeRag()
    first = run_service(db_session, settings, llm, rag)
    latest = run_service(db_session, settings, llm, rag, force_refresh=True)
    updated_settings = settings.model_copy(update={"LLM_TEMPERATURE": 0.9})

    def unexpected_fingerprint(*args, **kwargs):
        pytest.fail("Reading a saved snapshot must not revalidate current inputs")

    monkeypatch.setattr(repository, "input_fingerprint", unexpected_fingerprint)
    service = AnalysisService(db=db_session, settings=updated_settings, http=None, llm=llm, rag=rag)
    result = asyncio.run(service.generate_text_brief(StockBehaviorTextBriefRequest(
        symbol="2330", as_of_date=requested_date, cache_only=True)))
    assert result.status == "unavailable" and result.snapshot_id is None
    assert result.as_of_date == requested_date.isoformat() and result.brief is None
    assert llm.calls == rag.calls == 2
    assert len(db_session.scalars(select(LlmResponse)).all()) == 2


@pytest.mark.parametrize("change", ["new_news", "edit_news", "delete_news", "price_correction"])
def test_same_day_source_changes_invalidate_analysis_cache(db_session, settings, change):
    seed_prices(db_session)
    article = NewsArticle(article_id="current-news", stock_id="2330", title="Operating update",
        content="Original announcement", pub_time="2026-07-13 10:00:00")
    db_session.add(article)
    db_session.commit()
    llm, rag = FakeLlm(), FakeRag()
    first = run_service(db_session, settings, llm, rag)
    assert run_service(db_session, settings, llm, rag).snapshot_id == first.snapshot_id
    if change == "new_news":
        db_session.add(NewsArticle(article_id="new-news", stock_id="tw_stock", title="Market update",
            content="New market information", pub_time="2026-07-13 15:00:00"))
    elif change == "edit_news":
        article.content = "Corrected announcement"
    elif change == "delete_news":
        db_session.delete(article)
    else:
        db_session.get(DailyPrice, {"symbol": "2330", "date": AS_OF}).close = Decimal("119")
    db_session.commit()
    cached_only = run_service(db_session, settings, llm, rag, cache_only=True)
    assert cached_only.snapshot_id is None and cached_only.status == "unavailable"
    assert llm.calls == rag.calls == 1
    refreshed = run_service(db_session, settings, llm, rag)
    assert not refreshed.cached and refreshed.snapshot_id != first.snapshot_id
    assert refreshed.config_hash == first.config_hash
    assert llm.calls == rag.calls == 2
    assert db_session.get(LlmResponse, first.snapshot_id) is not None


def test_future_and_unrelated_news_do_not_expire_historical_cache(db_session, settings):
    seed_prices(db_session)
    llm, rag = FakeLlm(), FakeRag()
    first = run_service(db_session, settings, llm, rag)
    db_session.add_all([
        NewsArticle(article_id="future-news", stock_id="2330", pub_time="2026-07-13T16:30:00Z", content="Future in Taiwan"),
        NewsArticle(article_id="other-news", stock_id="2317", pub_time="2026-07-13", content="Other company"),
    ])
    db_session.commit()
    cached = run_service(db_session, settings, llm, rag, cache_only=True)
    assert cached.cached and cached.snapshot_id == first.snapshot_id
    assert llm.calls == rag.calls == 1


def test_warm_source_refresh_detects_new_index_evidence_without_regenerating_unchanged_inputs(db_session, settings):
    seed_prices(db_session)
    llm, rag = FakeLlm(), FakeRag()

    async def warm():
        service = AnalysisService(db=db_session, settings=settings, http=None, llm=llm, rag=rag)
        return await service.generate_text_brief(
            StockBehaviorTextBriefRequest(symbol="2330", as_of_date=AS_OF), refresh_sources=True)

    first = asyncio.run(warm())
    cached = asyncio.run(warm())
    assert cached.cached and cached.snapshot_id == first.snapshot_id
    assert llm.calls == 1 and rag.calls == 2
    rag.result = RagResult(news_sources=[{"id": "new-passage", "title": "Newly indexed announcement",
        "summary": "New evidence is now available", "timestamp": "2026-07-13T10:00:00",
        "url": "https://news.test/new", "kind": "general", "article_id": "indexed-news"}])
    refreshed = asyncio.run(warm())
    assert not refreshed.cached and refreshed.snapshot_id != first.snapshot_id
    assert llm.calls == 2 and rag.calls == 3
    assert asyncio.run(warm()).snapshot_id == refreshed.snapshot_id
    assert llm.calls == 2


def test_latest_valid_snapshot_skips_malformed_future_and_blocked_rows(db_session, settings):
    seed_prices(db_session)
    first = run_service(db_session, settings)
    row = db_session.get(LlmResponse, first.snapshot_id)
    fields = {column.name: getattr(row, column.name) for column in LlmResponse.__table__.columns
              if column.name not in {"id", "created_at"}}
    db_session.add_all([
        LlmResponse(**{**fields, "response_json": "malformed"}),
        LlmResponse(**{**fields, "as_of_date": date(2026, 7, 15)}),
        LlmResponse(**{**fields, "is_fallback": True, "raw_llm_text": "blocked output"}),
    ])
    db_session.commit()
    cached = repository.load_cached(db_session, symbol="2330", config_hash=first.config_hash,
                                    as_of=date(2026, 7, 14), latest=True)
    assert cached.snapshot_id == first.snapshot_id
    assert cached.as_of_date == "2026-07-13"
    assert "blocked output" not in cached.model_dump_json()


def test_config_hash_is_order_independent_but_tracks_generation_settings(settings):
    original = build_llm_runtime_config(settings, "model-a")
    assert compute_config_hash(original) == compute_config_hash(dict(reversed(list(original.items()))))
    for key, value in {"LLM_MODEL": "model-b", "LLM_TEMPERATURE": 0.5,
                       "LLM_MAX_TOKENS": 4096, "LLM_RESPONSE_FORMAT": "off",
                       "LLM_TIMEOUT_SECONDS": 60, "LLM_STREAMING": not settings.LLM_STREAMING,
                       "LLM_MAX_RETRIES": 0, "LLM_BASE_URL": "https://other.test/v1",
                       "QDRANT_URL": "http://other-vector.test", "QDRANT_COLLECTION": "other-news",
                       "EMBED_MODEL": "other-embedding", "EMBED_TRUNCATE": "END"}.items():
        updated = settings.model_copy(update={key: value})
        modified = build_llm_runtime_config(updated, value if key == "LLM_MODEL" else "model-a")
        assert compute_config_hash(original) != compute_config_hash(modified)
    assert "LLM_API_KEY" not in json.dumps(original)
    assert original == build_llm_runtime_config(settings.model_copy(update={
        "RAG_API_URL": "http://unused-legacy.test/api/analyze", "QDRANT_API_KEY": "private-key",
        "LLM_API_KEY": "private-llm-key", "EMBED_API_KEY": "private-embedding-key"}), "model-a")


def test_source_disclaimer_in_limitations_keeps_analysis_available(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    note = "部分新聞提及之目標價為分析師預測，非確定事實。"
    payload["limitations"] = [note]
    response = run_service(db_session, settings, FakeLlm(payload))
    assert response.status in {"verified", "limited"}
    assert note in response.brief.limitations
    row = db_session.get(LlmResponse, response.snapshot_id)
    assert not row.is_fallback and repository.saved_brief(row) is not None


def test_compliance_blocks_core_and_never_publishes_blocked_output(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["headline"] = "建議買進，目標價 1500 元"
    response = run_service(db_session, settings, FakeLlm(payload))
    assert response.status == "unavailable" and response.brief is None and response.evidence_catalog == []
    row = db_session.get(LlmResponse, response.snapshot_id)
    assert row.is_fallback and payload["headline"] in row.raw_llm_text
    assert payload["headline"] not in row.response_json
    assert payload["headline"] not in row.normalized_json
    assert payload["headline"] not in response.model_dump_json()
    assert repository.saved_brief(row) is None
    assert repository.load_cached(db_session, symbol="2330", config_hash=response.config_hash, as_of=AS_OF) is None


def test_unknown_evidence_and_future_key_day_are_removed_and_status_limited(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["current_status"][0]["evidence_ids"].append("invented_news")
    payload["key_days"].append({"id": "kd_04", "date": "2099-01-01", "ref": "future", "what": "Future event", "evidence_ids": []})
    result = run_service(db_session, settings, FakeLlm(payload))
    assert result.status == "limited"
    assert "invented_news" not in result.model_dump_json() and "2099-01-01" not in result.model_dump_json()
    assert gate._text_brief_referenced_ids(result.brief.model_dump()) <= {item.id for item in result.evidence_catalog}


def test_rag_degradation_is_visible_in_public_response(db_session, settings):
    seed_prices(db_session)
    result = run_service(db_session, settings, rag=FakeRag(RagResult(fallback_mode=True, status="unavailable", reason="timeout")))
    assert result.status == "limited"
    assert any("timeout" in limitation for limitation in result.limitations)


def test_malformed_llm_output_saves_only_unavailable_snapshot(db_session, settings):
    seed_prices(db_session)
    result = run_service(db_session, settings, FakeLlm({"bad": "shape"}))
    assert result.status == "unavailable" and result.brief is None
    row = db_session.get(LlmResponse, result.snapshot_id)
    assert row.is_fallback and repository.saved_brief(row) is None


def test_evidence_filters_future_prices_and_uses_published_fundamentals():
    price = lambda day: SimpleNamespace(date=day, close=Decimal("100"), volume_shares=1_000_000)
    rows = {"price_rows": [price(AS_OF), price(date(2099, 1, 1))], "chip_rows": [], "technical_rows": [],
        "income_rows": [SimpleNamespace(date=date(2026, 6, 30), item_type="EPS", value=Decimal("20"))],
        "revenue_rows": [], "valuation_rows": []}
    bundle = build_evidence_bundle(symbol="2330", as_of_date=AS_OF, rows=rows, news_sources=[])
    assert [row["date"] for row in bundle.daily_timeline] == [AS_OF.isoformat()]
    assert bundle.fundamental == []


def test_simplified_character_detection_regression():
    assert detect_simplified_chinese("臺灣股票市場投資分析，留意買賣風險。") == []
    assert set(detect_simplified_chinese("买卖风险")) == {"买", "卖", "风", "险"}


def test_http_analysis_cache_only_disabled_and_policy_contract(client):
    missing = client.post("/analyze/stock-behavior/text-brief", json={"symbol": "2330", "cache_only": True})
    assert missing.status_code == 200 and missing.json()["status"] == "unavailable"
    disabled = client.post("/analyze/stock-behavior/text-brief", json={"symbol": "2330", "force_refresh": True})
    assert disabled.status_code == 503 and disabled.json()["detail"]["code"] == "llm_unavailable"
    invalid = client.post("/analyze/stock-behavior/rag", json={"symbols": ["invalid"]})
    assert invalid.status_code == 422 and invalid.json()["detail"]["code"] == "policy_violation"
    rag = client.post("/analyze/stock-behavior/rag", json={"symbols": ["", "2330", "invalid"]})
    assert rag.status_code == 503
    assert "無法確認是否有相關新聞" in rag.json()["detail"]


def test_snapshot_failure_rolls_back_transaction(db_session, settings, monkeypatch):
    seed_prices(db_session)
    calls = []
    rollback = db_session.rollback

    def fail():
        raise RuntimeError("simulated disk error")
    def record_rollback():
        calls.append("rollback")
        return rollback()
    monkeypatch.setattr(db_session, "commit", fail)
    monkeypatch.setattr(db_session, "rollback", record_rollback)
    with pytest.raises(RuntimeError, match="simulated disk error"):
        run_service(db_session, settings)
    assert calls == ["rollback"] and not db_session.new


def test_blocked_answer_is_regenerated_once_with_same_evidence(db_session, settings):
    seed_prices(db_session)

    class RecoveringLlm(FakeLlm):
        async def generate(self, **kwargs):
            output = await super().generate(**kwargs)
            if self.calls == 1:
                self.first_packet = deepcopy(kwargs["payload"])
                output.payload["forward_views"]["short_1_5"]["invalidation"] = "跌破 2400 元"
            else:
                assert kwargs["payload"] == self.first_packet
                assert "上次輸出未通過檢查" in kwargs["system_prompt"]
            return output

    llm = RecoveringLlm()
    result = run_service(db_session, settings, llm)
    assert result.brief is not None and llm.calls == 2
    row = db_session.get(LlmResponse, result.snapshot_id)
    assert not row.is_fallback
    assert json.loads(row.normalized_json)["model_metadata"]["validation_attempts"] == 2


def test_repeated_invalid_output_stops_after_two_attempts(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["headline"] = "建議買進，目標價 1500 元"
    llm = FakeLlm(payload)
    result = run_service(db_session, settings, llm)
    assert result.status == "unavailable" and llm.calls == 2


def test_empty_filtered_section_preserves_facts_without_direction(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload.update(overall_stance="mildly_bullish", confidence="medium")
    payload["positive_factors"][0]["text"] = "EPS 99 元"
    result = run_service(db_session, settings, FakeLlm(payload))
    assert result.status == "limited" and result.brief.current_status
    assert result.brief.positive_factors == []
    assert result.brief.overall_stance == "uncertain" and result.brief.confidence == "low"
    assert any("支持因素" in text and "留空" in text for text in result.limitations)


def test_no_surviving_factual_sections_is_unavailable(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    for section in gate.TEXT_BRIEF_ITEM_SECTIONS:
        payload[section] = []
    payload["current_status"] = [{"id": "cs_01", "claim_type": "observation", "text": "EPS 99 元",
                                  "direction": "positive", "importance": "high", "evidence_ids": ["d_04"]}]
    llm = FakeLlm(payload)
    result = run_service(db_session, settings, llm)
    assert result.status == "unavailable" and result.brief is None and llm.calls == 2


def test_invalid_forward_view_is_disclosed_after_retry_without_losing_history(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload.update(overall_stance="mildly_bullish", confidence="medium")
    payload["forward_views"]["short_1_5"]["invalidation"] = "跌破 2400 元"
    llm = FakeLlm(payload)
    result = run_service(db_session, settings, llm)
    assert result.status == "limited" and llm.calls == 2
    assert result.brief.key_days
    assert result.brief.forward_views.short_1_5.stance == "uncertain"
    assert result.brief.forward_views.short_1_5.validation_status == "rejected"
    assert result.brief.forward_views.swing_6_20.validation_status is None
    assert result.brief.overall_stance == "uncertain" and result.brief.confidence == "low"
    assert "部分期間展望" in result.brief.confidence_reason
    assert "2400" not in result.brief.model_dump_json()
    assert any("部分期間展望" in item for item in result.limitations)
    row = db_session.get(LlmResponse, result.snapshot_id)
    metadata = json.loads(row.normalized_json)["model_metadata"]
    assert metadata["verification"]["compliance_rules"]
    assert not row.is_fallback


@pytest.mark.parametrize("condition,refs,allowed", [
    ("跌破 2026-07-13 收盤 113 元", ["d_04"], True),
    ("跌破歷史收盤支撐 113 元", ["d_04"], True),
    ("突破歷史高點壓力 2,510.50 元", ["lt_01"], True),
    ("跌破低點 80.25 塊", ["lt_02"], True),
    ("突破 2,510.50 元或跌破 80.25 元", ["lt_01", "lt_02"], True),
    ("離開 80.25 至 2,510.50 元區間", ["lt_01", "lt_02"], True),
    ("跌破 113 元", [], False),
    ("跌破 113 元", ["d_03"], False),
    ("跌破 113 元", ["fd_01", "nw_01", "ch_01"], False),
    ("跌破 114 元", ["d_05"], False),
    ("跌破 101 元", ["lt_03"], False),
    ("跌破 2500 元", ["lt_04"], False),
    ("突破 2,510.50 元或跌破 80.26 元", ["lt_01", "lt_02"], False),
    ("離開 80.26 至 2,510.50 元區間", ["lt_01", "lt_02"], False),
    ("跌破 2,113 元", ["d_04"], False),
    ("跌破 2.113 元", ["d_04"], False),
    ("跌破 2,51,0.50 元", ["lt_01"], False),
    ("目標價 113 元", ["d_04"], False),
    ("挑戰 2,510.50 元", ["lt_01"], False),
    ("建議買進，支撐 113 元", ["d_04"], False),
    ("買點 113 元", ["d_04"], False),
    ("支撐113元，買點113元", ["d_04"], False),
    ("保證守住 113 元", ["d_04"], False),
    ("配置全部資金，守住 113 元", ["d_04"], False),
])
@pytest.mark.parametrize("field", ["trigger", "invalidation"])
def test_price_conditions_require_all_prices_in_same_items_historical_market_citations(condition, refs, allowed, field):
    from app.features.analysis.evidence import EvidenceBundle

    bundle = EvidenceBundle(symbol="2330", as_of_date=AS_OF,
        daily_timeline=[{"id": "d_04", "date": "2026-07-13", "close": 113},
                        {"id": "d_03", "date": "2026-07-12", "close": 112},
                        {"id": "d_05", "date": "2026-07-14", "close": 114}],
        long_term_anchor=[{"id": "lt_01", "date": "2026-06-01", "field": "high_1y", "value": 2510.5},
                          {"id": "lt_02", "date": "2026-05-01", "field": "low_1y", "value": 80.25},
                          {"id": "lt_03", "date": "2026-07-13", "field": "vs_ma60_pct", "value": 101},
                          {"id": "lt_04", "date": "2026-07-14", "field": "high_1y", "value": 2500}],
        fundamental=[{"id": "fd_01", "date": "2026-03-31", "field": "eps", "value": 113}],
        news=[{"id": "nw_01", "date": "2026-07-13", "value": "股價113元"}],
        chip_summary=[{"id": "ch_01", "date": "2026-07-13", "value": 113}])
    item = {field: condition, "evidence_ids": refs}
    hits = gate._scan_text_brief_compliance(item, prices=gate._historical_prices(bundle))
    assert (not any(hit.severity == "hard" for hit in hits)) == allowed
    # A sibling item's citations must not authorize this item's price.
    if not allowed:
        assert any(hit.severity == "hard" for hit in gate._scan_text_brief_compliance(
            [item, {"evidence_ids": ["d_04", "lt_01", "lt_02"]}], prices=gate._historical_prices(bundle)))


def test_grounded_price_passes_service_without_retry_and_status_is_server_owned(db_session, settings):
    from app.features.analysis.schemas import TextBriefForwardView

    seed_prices(db_session)
    payload = brief_payload()
    view = payload["forward_views"]["short_1_5"]
    view.update(stance="mildly_bullish", invalidation="跌破 7/13 收盤支撐 113 元", validation_status="rejected")
    payload["risks"][0]["trigger"] = "跌破 7/13 收盤 113 元"
    llm = FakeLlm(payload)
    result = run_service(db_session, settings, llm)
    assert result.brief is not None and llm.calls == 1
    assert result.brief.forward_views.short_1_5.invalidation == view["invalidation"]
    assert result.brief.forward_views.short_1_5.validation_status is None
    assert "validation_status" not in TextBriefForwardView.model_json_schema()["properties"]


def test_saved_snapshot_backfills_rejection_from_metadata_only(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["forward_views"]["short_1_5"]["invalidation"] = "跌破 2400 元"
    result = run_service(db_session, settings, FakeLlm(payload))
    row = db_session.get(LlmResponse, result.snapshot_id)
    saved = json.loads(row.response_json)
    for view in saved["brief"]["forward_views"].values():
        view.pop("validation_status", None)
    row.response_json = json.dumps(saved)
    restored = repository.saved_brief(row)
    assert restored.brief.forward_views.short_1_5.validation_status == "rejected"
    assert restored.brief.forward_views.swing_6_20.validation_status is None
    row.normalized_json = "{}"
    assert repository.saved_brief(row).brief.forward_views.short_1_5.validation_status is None
