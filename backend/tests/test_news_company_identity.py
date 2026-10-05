"""Keep the Korean Samsung reference separate from Taiwan's Samsung Tech."""
from types import SimpleNamespace

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
    with pytest.raises(ValueError, match="company target is not explicitly mentioned"):
        validate_output(impact_output(FOREIGN_REFERENCE), article=article, catalog=CATALOG)


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
