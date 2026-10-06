from datetime import datetime
import json

import pytest

from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.features.market import company_catalog
from app.features.news.impact import article_hash, config_hash


@pytest.fixture(autouse=True)
def listed_companies(monkeypatch):
    names = {"2330": "台積電", "2317": "鴻海"}
    monkeypatch.setattr(company_catalog, "load_catalog",
        lambda: {symbol: {"symbol": symbol, "name": name, "market": "TWSE", "aliases": []}
                 for symbol, name in names.items()})


def article(article_id, published, **fields):
    return NewsArticle(article_id=article_id, pub_time=published, **fields)


def event_analysis(article_row, settings, *, status="success", events=None):
    return NewsEventAnalysis(
        article_id=article_row.article_id,
        input_hash=article_hash(article_row),
        config_hash=config_hash(settings, company_catalog.load_catalog()),
        status=status,
        events_json=json.dumps(events if events is not None else [{
            "key": "e1",
            "summary": "營收成長",
            "statement_type": "fact",
            "topics": ["ai"],
            "evidence": [{"field": "content", "quote": "Revenue increased."}],
        }], ensure_ascii=False),
    )


def event_impact(article_id, *, target="2330", event_key="e1"):
    return NewsEventImpact(
        article_id=article_id, event_key=event_key, target_type="company", target_id=target,
        direction="positive", importance="high", basis="reported", reason="營運改善",
        evidence=json.dumps([{"field": "content", "quote": "Revenue increased."}]),
        topics=",ai,",
    )


def test_news_mixed_timestamp_formats_inclusive_boundaries_and_pagination(client, db_session):
    db_session.add_all([
        article("older", "2026-05-19 23:59:59", stock_id="2330"),
        article("first", "2026-05-20T00:00:00+08:00", stock_id="2330", title="Semiconductor first"),
        article("last", "2026-05-20T23:59:59+08:00", tags="2317,2330", content="Semiconductor last"),
        article("future", "2026-05-21 00:00:00", stock_id="2330"),
    ])
    db_session.commit()
    params = {"start_time": "2026-05-20T00:00:00", "end_time": "2026-05-20T23:59:59",
              "stock": "2330", "keyword": "Semiconductor", "page_size": 1}
    response = client.get("/news", params=params, follow_redirects=False)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] == 2 and data["page"] == 1 and data["page_size"] == 1
    assert data["items"][0]["article_id"] == "last"
    assert client.get("/news", params={**params, "page": 2}).json()["items"][0]["article_id"] == "first"
    assert client.get("/news", params={**params, "sort_order": "asc"}).json()["items"][0]["article_id"] == "first"


def test_news_uses_current_event_analysis_for_stock_filter_and_response(client, db_session, settings):
    current = article("current", "2026-05-20 09:00:00", stock_id="2330", title="Growth", content="Revenue increased.")
    previous = article("previous", "2026-05-19 09:00:00", stock_id="2330")
    event_only = article("event-only", "2026-05-18 09:00:00", title="Growth", content="Revenue increased.")
    db_session.add_all([current, previous, event_only])
    db_session.flush()
    db_session.add_all([
        event_analysis(current, settings),
        event_analysis(event_only, settings),
        event_impact(current.article_id),
        event_impact(event_only.article_id),
    ])
    db_session.commit()

    result = client.get("/news", params={"stock": "2330"}).json()
    assert result["total"] == 3
    assert result["items"][0]["event_analysis"]["status"] == "success"
    assert result["items"][0]["event_analysis"]["impacts"][0]["target_id"] == "2330"
    assert "sentiments" not in result["items"][0]
    assert "article_sentiment" not in result["items"][0]

    detail = client.get("/news/current").json()
    assert detail["event_analysis"]["events"][0]["key"] == "e1"
    assert client.get("/news", params={"stock": "9999"}).json()["total"] == 0


@pytest.mark.parametrize("field,value", [
    ("title", "Corrected headline"), ("content", "Revenue decreased."),
    ("pub_time", "2026-05-20 10:00:00"),
])
def test_article_edits_hide_stale_event_analysis(client, db_session, settings, field, value):
    current = article("updated", "2026-05-20 09:00:00", title="Growth", content="Revenue increased.")
    db_session.add(current)
    db_session.flush()
    db_session.add_all([event_analysis(current, settings), event_impact(current.article_id)])
    db_session.commit()
    assert client.get("/news/updated").json()["event_analysis"]["status"] == "success"

    setattr(current, field, value)
    db_session.commit()
    analysis = client.get("/news/updated").json()["event_analysis"]
    assert analysis["status"] == "pending" and analysis["events"] == [] and analysis["impacts"] == []


def test_news_detail_keeps_nullable_fields_and_malformed_event_evidence_fallback(client, db_session, settings):
    current = article("blank", None)
    db_session.add(current)
    db_session.flush()
    db_session.add(event_analysis(current, settings, events=[]))
    db_session.add(NewsEventImpact(
        article_id=current.article_id, event_key="e1", target_type="market", target_id="TW",
        direction="uncertain", importance="high", basis="inferred", reason="資料不足",
        evidence="{truncated", topics=",ai,",
    ))
    db_session.commit()

    response = client.get("/news/blank")
    assert response.status_code == 200
    result = response.json()
    assert result["title"] is None and result["content"] is None and result["pub_time"] is None
    assert result["event_analysis"]["events"] == []
    assert result["event_analysis"]["impacts"][0]["evidence"] == []
    missing = client.get("/news/missing")
    assert missing.status_code == 404
    assert "?" not in missing.json()["detail"]


def test_news_created_at_source_and_article_filters(client, db_session):
    db_session.add_all([
        article("older-created", "2026-05-21 09:00:00", source="cnyes", created_at=datetime(2026, 5, 19)),
        article("newer-created", "2026-05-20 09:00:00", source="ltn", created_at=datetime(2026, 5, 20)),
    ])
    db_session.commit()
    ordered = client.get("/news", params={"sort_by": "created_at"}).json()["items"]
    assert [row["article_id"] for row in ordered] == ["newer-created", "older-created"]
    filtered = client.get("/news", params={"source": "ltn", "article_id": "newer-created"}).json()
    assert filtered["total"] == 1 and filtered["items"][0]["article_id"] == "newer-created"
    assert client.get("/news", params={"source": "cnyes", "article_id": "newer-created"}).json()["items"] == []
