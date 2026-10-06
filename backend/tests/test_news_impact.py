"""Article event analysis must remain evidence-backed and revision-safe."""
import asyncio
from datetime import datetime
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine, text

from app.clients.llm import LlmResult
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.market import company_catalog
from app.features.news.impact import SYSTEM_PROMPT, config_hash, hedge_reason, validate_output
from app.jobs.impact.runner import ImpactBatchRunner
from app.jobs.impact.migrate import migrate_news_impact


CATALOG = {
    "2330": {"symbol": "2330", "name": "台積電", "market": "TWSE", "aliases": [],
             "industry": "TWSE:24", "industry_name": "半導體業"},
    "7788": {"symbol": "7788", "name": "上櫃測試公司", "market": "TPEx", "aliases": [],
             "industry": "TPEx:24", "industry_name": "半導體業"},
}


def test_new_listing_in_existing_industry_does_not_invalidate_every_article(settings):
    with_new_company = {**CATALOG, "2331": {**CATALOG["2330"], "symbol": "2331", "name": "新公司"}}
    assert config_hash(settings, CATALOG) == config_hash(settings, with_new_company)


def test_ellipsis_evidence_is_split_only_when_both_quotes_are_exact():
    article = SimpleNamespace(title="測試", content="原文第一段；另有原文第二段。")
    payload = {"events": [{"key": "e1", "summary": "摘要", "statement_type": "fact",
                           "topics": [], "evidence": [{"field": "content", "quote": "原文第一段...原文第二段"}]}],
               "impacts": []}
    result = validate_output(payload, article=article, catalog={})
    assert [item.quote for item in result.events[0].evidence] == ["原文第一段", "原文第二段"]
    payload["events"][0]["evidence"][0]["quote"] = "原文第一段...不存在"
    with pytest.raises(ValueError, match="exact source quote"):
        validate_output(payload, article=article, catalog={})


def test_extra_evidence_is_trimmed_only_if_every_quote_is_source_backed():
    long_quote = "報" * 130
    article = SimpleNamespace(title="測試", content=f"甲乙丙。{long_quote}")
    payload = {"events": [{"key": "e1", "summary": "摘要", "statement_type": "fact", "topics": [],
                           "evidence": [{"field": "content", "quote": quote}
                                        for quote in ("甲", "乙", "丙")]}], "impacts": []}
    result = validate_output(payload, article=article, catalog={})
    assert [item.quote for item in result.events[0].evidence] == ["甲", "乙"]
    payload["events"][0]["evidence"][2]["quote"] = "不存在"
    with pytest.raises(ValueError, match="at most 2"):
        validate_output(payload, article=article, catalog={})
    payload["events"][0]["evidence"] = [{"field": "content", "quote": long_quote}]
    assert validate_output(payload, article=article, catalog={}).events[0].evidence[0].quote == long_quote[:120]


def output():
    quote = {"field": "content", "quote": "央行宣布升息一碼"}
    return {"events": [{"key": "e1", "summary": "央行升息", "statement_type": "fact",
                        "speaker": "央行", "topics": ["interest_rates"], "evidence": [quote]}],
            "impacts": [
                {"event_key": "e1", "target_type": "market", "target_id": "TW",
                 "direction": "negative", "importance": "high", "basis": "inferred",
                 "reason": "資金成本可能上升", "evidence": [quote]},
                {"event_key": "e1", "target_type": "industry", "target_id": "TWSE:24",
                 "direction": "negative", "importance": "medium", "basis": "inferred",
                 "reason": "產業融資成本可能上升", "evidence": [quote]},
            ]}


class StubLlm:
    def __init__(self, payloads):
        self.payloads = iter(payloads)
        self.calls = 0

    async def generate(self, **kwargs):
        self.calls += 1
        return LlmResult(next(self.payloads), "{}", {"prompt_tokens": 100,
                                                      "completion_tokens": 80})


def run(db_session, settings, tmp_path, llm):
    runner = ImpactBatchRunner(db_session=db_session, settings=settings, catalog=CATALOG,
                               llm=llm, execute=True, work_dir=tmp_path)
    return asyncio.run(runner.run(since=datetime(2026, 1, 1)))


def test_pending_excludes_simulation_before_limit_without_touching_records(db_session, settings, tmp_path):
    markers = [
        {"source": "simulation_test"},
        {"url": "https://example.invalid/simulation/case"},
        {"article_id": "sim_war_case"},
        {"title": "【模擬測試・非真實新聞】事件"},
    ]
    articles = [NewsArticle(**{
        "article_id": f"sim-marker-{index}", "source": "cnyes", "title": "財經事件",
        "content": "央行宣布升息一碼", "pub_time": "2026-09-20 12:00:00",
        "created_at": datetime(2026, 9, 20), **marker,
    }) for index, marker in enumerate(markers)]
    real = NewsArticle(article_id="real", source="cnyes", title="金融業推出模擬投資教學",
                       content="真實活動新聞", pub_time="2026-09-19 12:00:00",
                       created_at=datetime(2026, 9, 19))
    db_session.add_all([*articles, real])
    db_session.commit()
    llm = StubLlm([])
    runner = ImpactBatchRunner(db_session=db_session, settings=settings, catalog=CATALOG,
                               llm=llm, limit=1, execute=True, work_dir=tmp_path)
    selected = runner.pending(datetime(2026, 1, 1))
    assert [article.article_id for article, _ in selected] == ["real"]
    assert runner.counts["pending"] == 1 and llm.calls == 0
    assert all(db_session.get(NewsArticle, article.article_id) is article for article in articles)
    assert not db_session.new and not db_session.dirty and not db_session.deleted


@pytest.mark.parametrize("status", ["conflict", "superseded"])
def test_pending_source_selection_exclusion_precedes_limit(db_session, settings, tmp_path, status):
    from app.features.news.versions import set_selection, source_identity
    excluded = NewsArticle(article_id="excluded", source="cnyes", title="Obsolete report", content="Old financial facts",
        url="https://news.test/source", pub_time="2026-09-20 12:00:00", created_at=datetime(2026, 9, 20))
    active = NewsArticle(article_id="active", source="cnyes", title="Current report", content="Current financial facts",
        url="https://news.test/source" if status == "superseded" else "https://news.test/other",
        pub_time="2026-09-19 12:00:00", created_at=datetime(2026, 9, 19))
    db_session.add_all([excluded, active])
    db_session.flush()
    key, canonical = source_identity(excluded)
    set_selection(db_session, key, canonical, "active" if status == "superseded" else None,
                  "active" if status == "superseded" else "conflict", "Fixed source review")
    db_session.commit()
    llm = StubLlm([])
    runner = ImpactBatchRunner(db_session=db_session, settings=settings, catalog=CATALOG,
                               llm=llm, limit=1, execute=True, work_dir=tmp_path)
    assert [article.article_id for article, _ in runner.pending(datetime(2026, 1, 1))] == ["active"]
    assert runner.counts["pending"] == 1 and llm.calls == 0
    assert db_session.get(NewsArticle, "excluded") is excluded


def test_macro_article_is_searchable_without_company_and_stale_analysis_is_hidden(
        client, db_session, settings, tmp_path, monkeypatch):
    settings.LLM_MODEL = "test-model"
    monkeypatch.setattr(company_catalog, "load_catalog", lambda: CATALOG)
    article = NewsArticle(article_id="macro", source="cnyes", title="升息新聞",
                          content="央行宣布升息一碼，市場資金成本增加。",
                          pub_time="2026-09-20 10:00:00", content_kind="full")
    db_session.add(article)
    db_session.commit()
    summary = run(db_session, settings, tmp_path, StubLlm([output()]))
    assert summary["success"] == 1 and summary["api_calls"] == 1
    detail = client.get("/news/macro").json()["event_analysis"]
    assert detail["status"] == "success" and len(detail["impacts"]) == 2
    assert {item["target_type"] for item in detail["impacts"]} == {"market", "industry"}
    assert client.get("/news", params={"stock": "2330", "relation": "direct"}).json()["total"] == 0
    for relation in ("market_context", "industry_context"):
        result = client.get("/news", params={"stock": "2330", "relation": relation,
                                             "topic": "interest_rates", "sort_by": "importance"}).json()
        assert result["total"] == 1 and result["items"][0]["article_id"] == "macro"
    assert client.get("/news", params={"stock": "7788", "relation": "industry_context"}).json()["total"] == 1
    assert client.get("/news", params={"scope": "industry", "importance": "high"}).json()["total"] == 0
    assert client.get("/news", params={"scope": "market", "importance": "high"}).json()["total"] == 1
    assert client.get("/news", params={"topic": "interest_rates", "page_size": 1}).json()["total"] == 1
    assert client.get("/news/industries").json() == {"items": [
        {"id": "TPEx:24", "name": "上櫃 · 半導體業"},
        {"id": "TWSE:24", "name": "上市 · 半導體業"}]}
    settings.LLM_MODEL = "changed-model"
    assert client.get("/news/macro").json()["event_analysis"]["status"] == "pending"
    assert client.get("/news", params={"scope": "market"}).json()["total"] == 0
    settings.LLM_MODEL = "test-model"
    article.content = "央行宣布維持利率。"
    db_session.commit()
    assert client.get("/news/macro").json()["event_analysis"]["status"] == "pending"
    assert client.get("/news", params={"scope": "market"}).json()["total"] == 0


def test_invalid_evidence_fails_without_leaving_impacts(db_session, settings, tmp_path):
    settings.LLM_MODEL = "test-model"
    db_session.add(NewsArticle(article_id="invalid", title="升息新聞", content="央行宣布升息一碼",
                               pub_time="2026-09-20 10:00:00"))
    db_session.commit()
    bad = output()
    bad["impacts"][0]["evidence"] = [{"field": "content", "quote": "降息一碼"}]
    summary = run(db_session, settings, tmp_path, StubLlm([bad, bad]))
    assert summary["failed"] == 1 and summary["api_calls"] == 2
    assert db_session.get(NewsEventAnalysis, "invalid").status == "failed"
    assert db_session.query(NewsEventImpact).count() == 0


def test_opposite_company_impacts_in_one_article_remain_separate(
        client, db_session, settings, tmp_path, monkeypatch):
    settings.LLM_MODEL = "test-model"
    monkeypatch.setattr(company_catalog, "load_catalog", lambda: CATALOG)
    db_session.add(NewsArticle(article_id="two_sided", title="台積電營運新聞",
                               content="台積電新接單增加，但電費上漲。",
                               pub_time="2026-09-20 10:00:00"))
    db_session.commit()
    payload = {"events": [
        {"key": "e1", "summary": "新接單增加", "statement_type": "fact", "topics": ["company_operations"],
         "evidence": [{"field": "content", "quote": "新接單增加"}]},
        {"key": "e2", "summary": "電費上漲", "statement_type": "fact", "topics": ["energy_materials"],
         "evidence": [{"field": "content", "quote": "電費上漲"}]},
    ], "impacts": [
        {"event_key": "e1", "target_type": "company", "target_id": "2330",
         "direction": "positive", "importance": "medium", "basis": "reported",
         "reason": "接單增加", "evidence": [{"field": "content", "quote": "新接單增加"}]},
        {"event_key": "e2", "target_type": "company", "target_id": "2330",
         "direction": "negative", "importance": "medium", "basis": "inferred",
         "reason": "成本可能上升", "evidence": [{"field": "content", "quote": "電費上漲"}]},
    ]}
    assert run(db_session, settings, tmp_path, StubLlm([payload]))["success"] == 1
    result = client.get("/news", params={"stock": "2330", "relation": "direct"}).json()
    assert result["total"] == 1
    assert {impact["direction"] for impact in result["items"][0]["event_analysis"]["impacts"]} == {
        "positive", "negative"}


def test_schema_migration_backfills_legacy_hash_once():
    engine = create_engine("sqlite://")
    try:
        with engine.begin() as connection:
            connection.execute(text("CREATE TABLE news_articles (article_id VARCHAR(64) PRIMARY KEY, "
                                    "title TEXT, content TEXT, pub_time VARCHAR(40))"))
            connection.execute(text("INSERT INTO news_articles (article_id, title, content, pub_time) "
                                    "VALUES ('old', 'Old', 'Source', '2026-09-20 10:00:00')"))
        assert migrate_news_impact(engine) == {"columns_added": 2, "hashes_updated": 1}
        assert migrate_news_impact(engine) == {"columns_added": 0, "hashes_updated": 0}
        with engine.connect() as connection:
            assert connection.scalar(text("SELECT analysis_input_hash FROM news_articles WHERE article_id='old'"))
    finally:
        engine.dispose()


def test_budget_stops_before_call(db_session, settings, tmp_path):
    db_session.add(NewsArticle(article_id="budget", title="預算測試", pub_time="2026-09-20 10:00:00"))
    db_session.commit()
    llm = StubLlm([])
    runner = ImpactBatchRunner(db_session=db_session, settings=settings, catalog=CATALOG,
                               llm=llm, execute=True, max_cost_usd=0, work_dir=tmp_path)
    summary = asyncio.run(runner.run(since=datetime(2026, 1, 1)))
    assert summary["stopped_reason"] == "budget_exhausted" and llm.calls == 0
    assert db_session.get(NewsEventAnalysis, "budget") is None


def test_recognition_alias_upgrade_invalidates_previous_analysis_config(settings, monkeypatch):
    current = config_hash(settings, CATALOG)
    monkeypatch.setattr("app.features.news.impact.COMPANY_RECOGNITION_VERSION", "mentions-v1")
    assert config_hash(settings, CATALOG) != current


def test_impact_reason_uses_possible_instead_of_guaranteed_outcome():
    assert "一律用「可能」" in SYSTEM_PROMPT
    assert hedge_reason("預計明年量產，將帶來明確的營收貢獻。") == "預計明年量產，可能帶來明確的營收貢獻。"
    assert hedge_reason("需求擴張勢必帶動量價齊揚") == "需求擴張可能帶動量價齊揚"
    assert hedge_reason("將會提升長期獲利能力") == "可能提升長期獲利能力"
    assert hedge_reason("將營收目標下修，成本可能上升") == "將營收目標下修，成本可能上升"
    article = SimpleNamespace(title="升息", content="央行宣布升息一碼")
    payload = output()
    payload["impacts"][0]["reason"] = "資金成本將增加"
    assert validate_output(payload, article=article, catalog=CATALOG).impacts[0].reason == "資金成本可能增加"
