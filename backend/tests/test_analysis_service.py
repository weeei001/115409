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
    assert first.status == "verified" and not first.cached
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


def test_text_brief_accepts_symbols_from_stock_info(db_session, settings):
    db_session.add(StockInfo(symbol="1101", name="台泥"))
    db_session.add_all([DailyPrice(symbol="1101", date=date(2026, 7, day), close=Decimal(100 + day),
                                    volume_shares=1_000_000) for day in range(10, 15)])
    db_session.commit()
    result = run_service(db_session, settings, symbol="1101")
    assert result.symbol == "1101" and result.status == "verified"


@pytest.mark.parametrize("requested_date", [AS_OF, date(2026, 9, 12)])
def test_cache_only_reads_latest_saved_response_after_settings_change(db_session, settings, monkeypatch, requested_date):
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
    assert result.cached and result.snapshot_id == latest.snapshot_id != first.snapshot_id
    assert result.as_of_date == AS_OF.isoformat() and result.brief == latest.brief
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
    assert cached_only.snapshot_id == first.snapshot_id and cached_only.cached
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
    assert rag.status_code == 200 and rag.json() == {"news_sources": [], "fallback_mode": True}


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


def test_invalid_forward_view_is_disclosed_after_retry_without_losing_history(db_session, settings):
    seed_prices(db_session)
    payload = brief_payload()
    payload["forward_views"]["short_1_5"]["invalidation"] = "跌破 2400 元"
    llm = FakeLlm(payload)
    result = run_service(db_session, settings, llm)
    assert result.status == "limited" and llm.calls == 2
    assert result.brief.key_days
    assert result.brief.forward_views.short_1_5.stance == "uncertain"
    assert result.brief.forward_views.short_1_5.validation_status == "rejected"
    assert result.brief.forward_views.swing_6_20.validation_status is None
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
