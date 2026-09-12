from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

import pytest
from sqlalchemy import event

from app.db.models.news_article import NewsArticle
from app.db.models.news_sentiment import NewsSentiment
from app.features.news.service import ACTIVE_SENTIMENT_CONFIG_HASH
from app.features.news.sentiment import article_input_hash


def article(article_id, published, **fields):
    return NewsArticle(article_id=article_id, pub_time=published, **fields)


def sentiment(article_id, stock="2330", config_hash=ACTIVE_SENTIMENT_CONFIG_HASH, **fields):
    input_hash = fields.pop("input_hash", article_input_hash(article(article_id, None), stock))
    return NewsSentiment(article_id=article_id, target_stock_id=stock, input_hash=input_hash,
                         config_hash=config_hash, **fields)


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


def test_news_sentiment_config_identity_filtering_and_batch_queries(client, db_session):
    root = Path(__file__).resolve().parents[2]
    script = (
        "import sys; sys.path.insert(0, 'backend_v2/tests'); "
        "from legacy_probe import isolate_legacy; isolate_legacy(); "
        "from news_sentiment.cleaner import get_active_config_hash; print(get_active_config_hash())"
    )
    legacy = subprocess.run([sys.executable, "-c", script], cwd=root, capture_output=True,
                            text=True, encoding="utf-8", check=True)
    assert ACTIVE_SENTIMENT_CONFIG_HASH == legacy.stdout.strip()
    current = article("current", "2026-05-20 09:00:00", stock_id="2330", title="Growth", content="Revenue increased.")
    db_session.add_all([
        current,
        article("previous", "2026-05-19 09:00:00", stock_id="2330"),
        sentiment("current", label="positive", reason="Reported growth", status="success",
                  input_hash=article_input_hash(current, "2330"),
                  evidence=json.dumps([{"field": "content", "quote": "Revenue increased."}])),
        sentiment("current", stock="2317", label="neutral", status="success", reason=None,
                  input_hash=article_input_hash(current, "2317")),
        sentiment("previous", config_hash="stale", status="success", label="negative"),
        sentiment("previous", stock="2317", status="failed", label="negative"),
    ])
    db_session.commit()
    queries, commits = [], []
    event.listen(db_session.bind, "before_cursor_execute", lambda *args: queries.append(args[2]))
    event.listen(db_session, "before_commit", lambda *args: commits.append(True))
    result = client.get("/news", params={"stock": "2330"}).json()
    assert len(queries) == 3 and not commits
    assert result["total"] == 2
    assert [row["article_id"] for row in result["items"]] == ["current", "previous"]
    assert len(result["items"][0]["sentiments"]) == 1
    assert result["items"][0]["sentiments"][0]["evidence"] == [{"field": "content", "quote": "Revenue increased."}]
    assert result["items"][1]["sentiments"] == []
    all_sentiments = client.get("/news/current").json()["sentiments"]
    assert {row["target_stock_id"] for row in all_sentiments} == {"2330", "2317"}
    assert client.get("/news/current", params={"stock": "9999"}).json()["sentiments"] == []
    assert len(client.get("/news/current").json()["sentiments"]) == 2


@pytest.mark.parametrize("field,value", [
    ("title", "Corrected headline"), ("content", "Revenue decreased."), ("pub_time", "2026-05-20 10:00:00"),
])
def test_article_edits_hide_previous_sentiments_in_list_and_detail(client, db_session, field, value):
    current = article("updated", "2026-05-20 09:00:00", title="Growth", content="Revenue increased.")
    previous = sentiment("updated", status="success", label="positive", input_hash=article_input_hash(current, "2330"))
    db_session.add_all([current, previous])
    db_session.commit()
    current.pub_time = "2026-05-20T01:00:00Z"
    current.content = "<p>Revenue increased.</p>"
    db_session.commit()
    assert len(client.get("/news/updated").json()["sentiments"]) == 1
    setattr(current, field, value)
    db_session.commit()
    assert client.get("/news/updated").json()["sentiments"] == []
    assert client.get("/news").json()["items"][0]["sentiments"] == []
    assert previous.status == "success"


def test_news_detail_keeps_nullable_fields_and_malformed_evidence_fallback(client, db_session):
    db_session.add_all([
        article("blank", None),
        sentiment("blank", status="success", evidence="{truncated", reason=None, label=None),
    ])
    db_session.commit()
    response = client.get("/news/blank")
    assert response.status_code == 200
    result = response.json()
    assert result["title"] is None and result["content"] is None and result["pub_time"] is None
    assert result["sentiments"][0] == {
        "target_stock_id": "2330", "label": "", "reason": "", "evidence": [], "analyzed_at": None,
    }
    assert client.get("/news/missing").json() == {"detail": "找不到指定的新聞文章"}
    assert client.get("/news/missing").status_code == 404


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
