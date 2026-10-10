"""Keep the Korean Samsung reference separate from Taiwan's Samsung Tech."""
from types import SimpleNamespace
from datetime import datetime
import json

import pytest

from app.features.news import impact as impact_module
from app.features.news.impact import validate_output
from app.features.news.sentiment import company_mentions, extract_candidate_stocks
from app.features.retrieval.impact_metadata import current_analysis


CATALOG = {
    "2330": {"name": "台積電", "industry": "TWSE:24"},
    "5007": {"name": "三星", "aliases": ["三星科技股份有限公司"], "industry": "TWSE:10"},
}
TITLE = "馬斯克晶片計畫找上台積電！英特爾股價承壓"
FOREIGN_REFERENCE = "三星電子(005930-KR)"


@pytest.mark.parametrize("reference", [FOREIGN_REFERENCE, "韓國三星電子", "韓國三星", "三星集團"])
def test_foreign_samsung_mentions_do_not_resolve_to_taiwan_5007(reference):
    assert extract_candidate_stocks(None, None, TITLE, reference, CATALOG) == ["2330"]
    assert all(mention["symbol"] != "5007" for mention in company_mentions(TITLE, reference, CATALOG))


@pytest.mark.parametrize("reference", [
    "三星(5007)", "三星(5007-TW)", "5007.TW", "三星科技", "三星科技股份有限公司",
])
def test_taiwan_samsung_keeps_unambiguous_names_and_explicit_tickers(reference):
    assert extract_candidate_stocks(None, None, None, reference, CATALOG) == ["5007"]


def test_independent_taiwan_mention_is_not_hidden_by_a_foreign_reference():
    text = f"{FOREIGN_REFERENCE}的晶片計畫。三星(5007)公布螺絲產品營收。"
    assert extract_candidate_stocks(None, None, TITLE, text, CATALOG) == ["2330", "5007"]


@pytest.mark.parametrize("reference", [
    "台積電(2330-US)", "台積電（2330.KR）", "台積電 US:2330",
    "三星科技(005930-KR)",
])
def test_foreign_qualified_ticker_overrides_an_adjacent_local_name(reference):
    assert extract_candidate_stocks(None, None, None, reference, CATALOG) == []


@pytest.mark.parametrize("reference", [
    "台積電(2330-TW)", "台積電（TWSE:2330）", "TW:2330", "三星(5007-TWO)",
])
def test_local_qualified_tickers_remain_candidates(reference):
    assert extract_candidate_stocks(None, None, None, reference, CATALOG) == [
        "5007" if "5007" in reference else "2330"]


def test_qualified_foreign_reference_does_not_hide_a_separate_local_name():
    content = "台積電(2330-US)公布計畫；台積電(2330-TW)公布台灣營收。"
    mentions = company_mentions(None, content, CATALOG)
    assert mentions and all(mention["start"] >= content.index("台積電(2330-TW)") for mention in mentions)


def test_unqualified_number_outside_catalog_does_not_override_a_company_name():
    assert extract_candidate_stocks(None, None, "台積電(2026)營收展望", None, CATALOG) == ["2330"]


def impact_output(quote):
    evidence = [{"field": "content", "quote": quote}]
    return {
        "events": [{"key": "e1", "summary": "晶片計畫", "statement_type": "plan", "evidence": evidence}],
        "impacts": [{"event_key": "e1", "target_type": "company", "target_id": "5007",
                     "direction": "positive", "importance": "medium", "basis": "inferred",
                     "reason": "晶片量產可能增加需求", "evidence": evidence}],
    }


def test_impact_guard_rejects_foreign_samsung_as_taiwan_company():
    article = SimpleNamespace(title=TITLE, content=FOREIGN_REFERENCE)
    checked = validate_output(impact_output(FOREIGN_REFERENCE), article=article, catalog=CATALOG)
    assert len(checked.events) == 1 and checked.impacts == []
    assert "company target is not explicitly mentioned" in checked.validation_feedback


def test_impact_guard_accepts_explicit_taiwan_samsung():
    quote = "三星(5007)公布螺絲產品營收"
    article = SimpleNamespace(title="三星科技營運消息", content=quote)
    assert validate_output(impact_output(quote), article=article, catalog=CATALOG).impacts[0].target_id == "5007"


def test_pre_fix_impact_fingerprint_cannot_keep_wrong_cached_company_target(settings, monkeypatch):
    article = SimpleNamespace(title=TITLE, content=FOREIGN_REFERENCE, pub_time="2026-10-05 14:00:00")
    current_hash = impact_module.config_hash(settings, CATALOG)
    with monkeypatch.context() as previous:
        previous.setattr(impact_module, "COMPANY_RECOGNITION_VERSION", "mentions-v2")
        old_hash = impact_module.config_hash(settings, CATALOG)
    analysis = SimpleNamespace(status="success", input_hash=impact_module.article_hash(article), config_hash=old_hash)
    assert not current_analysis(article, analysis, current_hash)


@pytest.mark.parametrize("reference", [
    FOREIGN_REFERENCE, "韓國三星電子", "韓國三星", "三星集團",
])
def test_legacy_samsung_tags_cannot_override_unresolved_foreign_names(reference):
    assert extract_candidate_stocks("5007", "5007.TW,2330", TITLE, reference, CATALOG) == ["2330"]


@pytest.mark.parametrize("reference", [
    "三星(5007)", "三星(5007-TW)", "5007.TWO", "三星科技",
    f"{FOREIGN_REFERENCE}；三星(5007)公布螺絲產品營收。",
])
def test_read_guard_keeps_explicit_local_company_metadata(reference):
    from app.features.news.sentiment import safe_stock_metadata
    assert safe_stock_metadata("5007", "5007.TW,2330", TITLE, reference, CATALOG) == {
        "stock_id": "5007", "tags": "5007.TW,2330"}


def test_api_hides_legacy_foreign_company_tags_and_stale_impacts_without_writing(
        client, db_session, settings, monkeypatch):
    from app.db.models.news_article import NewsArticle
    from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
    from app.db.models.news_version import NewsArticleVersion
    from app.features.news.versions import record_version
    monkeypatch.setattr("app.features.market.company_catalog.load_catalog", lambda: CATALOG)
    article = NewsArticle(article_id="legacy-samsung", title=TITLE, content=FOREIGN_REFERENCE,
        content_kind="full", pub_time="2026-10-05 14:00:00", stock_id="5007", tags="005930-KR,5007.TW,2330")
    db_session.add(article)
    db_session.flush()
    with monkeypatch.context() as previous:
        previous.setattr(impact_module, "COMPANY_RECOGNITION_VERSION", "mentions-v3")
        previous_hash = impact_module.config_hash(settings, CATALOG)
    db_session.add(NewsEventAnalysis(article_id=article.article_id,
        input_hash=impact_module.article_hash(article), config_hash=previous_hash,
        status="success", events_json=json.dumps(impact_output(FOREIGN_REFERENCE)["events"])))
    db_session.add(NewsEventImpact(article_id=article.article_id, event_key="e1", target_type="company",
        target_id="5007", direction="positive", importance="medium", basis="inferred",
        reason="Old wrong target", evidence=json.dumps([{"field": "content", "quote": FOREIGN_REFERENCE}]), topics=",ai,"))
    revision_id = record_version(db_session, article, observed_at=datetime(2026, 10, 5, 15))
    db_session.commit()

    response = client.get(f"/news/{article.article_id}")
    assert response.status_code == 200
    result = response.json()
    assert result["stock_id"] is None and result["tags"] == "005930-KR,2330"
    assert result["event_analysis"]["status"] == "pending" and result["event_analysis"]["impacts"] == []
    listed = client.get("/news").json()["items"][0]
    assert listed["stock_id"] is None and listed["tags"] == "005930-KR,2330"
    assert client.get("/news", params={"stock": "5007", "relation": "direct"}).json()["total"] == 0
    historical = client.get(f"/news/{article.article_id}", params={"revision_id": revision_id}).json()
    assert historical["stock_id"] is None and historical["tags"] == "005930-KR,2330"
    assert historical["content"] == FOREIGN_REFERENCE and historical["source_state"]["status"] == "historical"
    saved = json.loads(db_session.get(NewsArticleVersion, revision_id).snapshot_json)
    assert saved["stock_id"] == "5007" and saved["tags"] == "005930-KR,5007.TW,2330"
    assert article.stock_id == "5007" and article.tags == "005930-KR,5007.TW,2330"
    assert not db_session.new and not db_session.dirty and not db_session.deleted
