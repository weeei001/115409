import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, select, func, inspect, text

from app.db.models.news_article import NewsArticle
from app.features.news.versions import canonical_url, source_identity, source_states, update_article
from app.jobs.crawlers import store_news


def article(id_="a", content="Revenue was 123 million. Confirmed by the official company announcement.", **extra):
    return dict(article_id=id_, source="cnyes", source_group="cnyes", stock_id="2330",
                title="Company announcement", pub_time="2026-08-01T10:00:00+08:00",
                url="https://news.cnyes.com/news/id/6605885", content=content, content_kind="full_text", **extra)


def test_canonical_identity_keeps_content_queries():
    assert canonical_url("HTTP://NEWS.CNYES.COM/news/id/6605885/?utm_source=x#frag") == "https://news.cnyes.com/news/id/6605885"
    assert canonical_url("https://x.test/news?id=1&page=2&utm_medium=x#frag") == "https://x.test/news?id=1&page=2"
    assert canonical_url("https://x.test/news?id=1&page=3") != canonical_url("https://x.test/news?id=1&page=2")


def test_equal_and_shorter_corrections_keep_only_latest_body_and_id(db_session):
    original = article()
    store_news(db_session, [original])
    for content in (original["content"].replace("123", "321"), "Corrected revenue is 32 million; prior figure withdrawn."):
        revised = {**original, "article_id": "changed-title-id", "title": "Corrected announcement", "content": content}
        assert store_news(db_session, [revised])["updated"] == 1
    assert "news_article_versions" not in inspect(db_session.bind).get_table_names()
    assert db_session.scalar(select(func.count()).select_from(NewsArticle)) == 1
    assert db_session.get(NewsArticle, "a").content == revised["content"]
    assert store_news(db_session, [revised])["skipped"] == 1


@pytest.mark.parametrize("content,kind", [("Access denied: captcha", "full_text"), ("new summary", "summary"), ("", "full_text"), ("Oops", "full_text")])
def test_failed_extraction_cannot_mix_new_title_with_old_body(db_session, content, kind):
    original = article(content="Original full article. " * 10)
    store_news(db_session, [original])
    bad = {**original, "title": "New title", "content": content, "content_kind": kind}
    assert store_news(db_session, [bad])["skipped"] == 1
    stored = db_session.get(NewsArticle, "a")
    assert stored.title == original["title"] and stored.content == original["content"]


def test_latest_correction_retains_publication_cutoff(db_session):
    stored = NewsArticle(**article())
    db_session.add(stored)
    db_session.commit()
    cutoff = datetime(2026, 8, 2, tzinfo=timezone.utc)
    assert source_states(db_session, [stored], cutoff)["a"]["eligible"]
    update_article(db_session, stored, {"content": "Corrected full article: prior figure was wrong.", "content_kind": "full_text"})
    db_session.flush()
    state = source_states(db_session, [stored], cutoff)["a"]
    assert state["eligible"] and "observed_at" not in state


def test_tracking_url_and_title_changes_update_original_article(db_session):
    original = article()
    store_news(db_session, [original])
    revised = {**original, "article_id": "new-title-id", "title": "Corrected title", "url": original["url"] + "?utm_source=new", "content": "Corrected facts from the latest crawl."}
    assert store_news(db_session, [revised]) == {"inserted": 0, "updated": 1, "skipped": 0}
    assert db_session.scalar(select(func.count()).select_from(NewsArticle)) == 1
    assert db_session.get(NewsArticle, "a").content == revised["content"]


def test_detail_returns_latest_body_without_revision_metadata(db_session, client):
    original = article()
    store_news(db_session, [original])
    revised = {**original, "content": "Correction: original number was wrong.", "title": "Corrected announcement"}
    store_news(db_session, [revised])
    current = client.get("/news/a").json()
    assert current["content"] == revised["content"]
    assert "revision_id" not in current["source_state"]
    assert "observed_at" not in current["source_state"]


@pytest.mark.parametrize("published,eligible", [
    ("2026-08-02T08:00:00+08:00", True),
    ("2026-08-02T08:00:01+08:00", False),
    ("2026-08-02T00:00:00Z", True),
    ("2026/08/02 08:00", True),
    ("invalid", False),
    (None, False),
])
def test_publication_cutoff_rejects_future_or_unknown_dates(db_session, published, eligible):
    stored = NewsArticle(**{**article(), "pub_time": published})
    db_session.add(stored)
    db_session.flush()
    cutoff = datetime(2026, 8, 2, tzinfo=timezone.utc)
    assert source_states(db_session, [stored], cutoff)["a"]["eligible"] is eligible
