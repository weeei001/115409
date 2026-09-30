import json
from datetime import datetime, timezone

import pytest
from sqlalchemy import event, select, func

from app.db.models.news_article import NewsArticle
from app.db.models.news_version import NewsArticleVersion, NewsSourceSelection, NewsSourceDecision
from app.features.news.versions import canonical_url, source_identity, source_states, update_article
from app.jobs.crawlers import store_news
from app.jobs.news_versions import migrate, revision_plan, choose, rollback_decision


def article(id_="a", content="Revenue was 123 million. Confirmed by the official company announcement.", **extra):
    return dict(article_id=id_, source="cnyes", source_group="cnyes", stock_id="2330",
                title="Company announcement", pub_time="2026-08-01T10:00:00+08:00",
                url="https://news.cnyes.com/news/id/6605885", content=content, content_kind="full_text", **extra)


def test_canonical_identity_keeps_content_queries():
    assert canonical_url("HTTP://NEWS.CNYES.COM/news/id/6605885/?utm_source=x#frag") == "https://news.cnyes.com/news/id/6605885"
    assert canonical_url("https://x.test/news?id=1&page=2&utm_medium=x#frag") == "https://x.test/news?id=1&page=2"
    assert canonical_url("https://x.test/news?id=1&page=3") != canonical_url("https://x.test/news?id=1&page=2")


def test_equal_and_shorter_corrections_keep_immutable_old_body_and_id(db_session):
    original = article()
    store_news(db_session, [original])
    for content in (original["content"].replace("123", "321"), "Corrected revenue is 32 million; prior figure withdrawn."):
        revised = {**original, "article_id": "changed-title-id", "title": "Corrected announcement", "content": content}
        assert store_news(db_session, [revised])["updated"] == 1
    rows = list(db_session.scalars(select(NewsArticleVersion)))
    assert len(rows) == 3
    assert json.loads(rows[0].snapshot_json)["title"] == original["title"]
    assert json.loads(rows[0].snapshot_json)["content"] == original["content"]
    assert db_session.scalar(select(func.count()).select_from(NewsArticle)) == 1
    assert db_session.get(NewsArticle, "a").content == revised["content"]
    assert store_news(db_session, [revised])["skipped"] == 1
    assert db_session.scalar(select(func.count()).select_from(NewsArticleVersion)) == 3


@pytest.mark.parametrize("content,kind", [("Access denied: captcha", "full_text"), ("new summary", "summary"), ("", "full_text"), ("Oops", "full_text")])
def test_failed_extraction_cannot_mix_new_title_with_old_body(db_session, content, kind):
    original = article(content="Original full article. " * 10)
    store_news(db_session, [original])
    bad = {**original, "title": "New title", "content": content, "content_kind": kind}
    assert store_news(db_session, [bad])["skipped"] == 1
    stored = db_session.get(NewsArticle, "a")
    assert stored.title == original["title"] and stored.content == original["content"]
    assert db_session.scalar(select(func.count()).select_from(NewsArticleVersion)) == 1


def test_conflicting_legacy_versions_need_explicit_reversible_choice(db_session):
    # Neither created_at nor lexical ID can choose between disagreeing financial facts.
    first = NewsArticle(**article("a", created_at=datetime(2026, 9, 1)))
    second = NewsArticle(**article("b", content="Revenue was 321 million.", created_at=datetime(2026, 9, 2)))
    db_session.add_all([first, second])
    db_session.commit()
    before = revision_plan(db_session)
    assert before[0]["status"] == "conflict" and before[0]["proposed_selected_article_id"] is None
    assert db_session.scalar(select(func.count()).select_from(NewsSourceSelection)) == 0
    db_session.rollback()
    assert migrate(db_session.bind)["conflicts"] == 1
    key = source_identity(first)[0]
    assert not any(item["eligible"] for item in source_states(db_session, [first, second]).values())
    choose(db_session, key, "b", "Checked publisher correction notice and its facts")
    decision = db_session.scalar(select(NewsSourceDecision).order_by(NewsSourceDecision.id.desc()))
    states = source_states(db_session, [first, second])
    assert states["b"]["eligible"] and states["a"]["status"] == "superseded"
    historical = source_states(db_session, [first, second], datetime(2026, 8, 2, tzinfo=timezone.utc))
    assert historical["b"]["eligible"] and historical["a"]["status"] == "superseded"
    rollback_decision(db_session, decision.id, "Correction notice was not authoritative")
    db_session.flush()
    assert source_states(db_session, [second])["b"]["status"] == "conflict"
    assert db_session.get(NewsArticle, "a") is not None


def test_historical_cutoff_uses_publication_time_without_backdating_observation(db_session):
    stored = NewsArticle(**article())
    db_session.add(stored)
    db_session.commit()
    migrate(db_session.bind)
    cutoff = datetime(2026, 8, 2, tzinfo=timezone.utc)
    state = source_states(db_session, [stored], cutoff)["a"]
    assert state["eligible"] and state["observed_at"] is None and "retrospective" in state["limitation"]
    update_article(db_session, stored, {"content": "Corrected full article: prior figure was wrong.", "content_kind": "full_text"},
                   observed_at=datetime(2026, 9, 1))
    db_session.flush()
    historical = source_states(db_session, [stored], cutoff)["a"]
    assert historical["eligible"]
    assert historical["observed_at"] == "2026-09-01T00:00:00Z"
    assert source_states(db_session, [stored])["a"]["eligible"]


def test_dry_run_query_count_is_bounded_and_idempotent_migration(db_session):
    for index in range(30):
        item = article(str(index))
        item["url"] += str(index)
        db_session.add(NewsArticle(**item))
    db_session.commit()
    statements = []
    listener = lambda *args: statements.append(args[2])
    event.listen(db_session.bind, "before_cursor_execute", listener)
    try:
        assert len(revision_plan(db_session)) == 30
    finally:
        event.remove(db_session.bind, "before_cursor_execute", listener)
    assert len(statements) <= 8
    db_session.rollback()
    migrate(db_session.bind)
    migrate(db_session.bind)
    assert db_session.scalar(select(func.count()).select_from(NewsArticleVersion)) == 30
    assert db_session.scalar(select(func.count()).select_from(NewsSourceDecision)) == 30


def test_effective_news_pagination_and_old_detail_state(db_session, settings):
    from app.features.news.repository import news_list
    from app.features.news.service import news_detail
    first, second = NewsArticle(**article("a")), NewsArticle(**article("b", content="Disputed source value 999."))
    db_session.add_all([first, second])
    db_session.commit()
    migrate(db_session.bind)
    assert news_list(db_session, page=1, page_size=1)[0] == 0
    choose(db_session, source_identity(first)[0], "b", "Publisher confirms b; verified in correction notice")
    db_session.flush()
    total, items = news_list(db_session, page=1, page_size=1)
    assert total == 1 and [item.article_id for item in items] == ["b"]
    assert news_list(db_session, page=2, page_size=1) == (1, [])
    old = news_detail(db_session, "a", settings=settings)
    assert old.source_state["status"] == "superseded"
    assert old.event_analysis.status == "skipped" and old.event_analysis.impacts == []
    assert source_states(db_session, [vars(first)])["a"]["eligible"] is False


def test_revision_detail_restores_exact_body_without_current_impacts(db_session, client):
    original = article()
    store_news(db_session, [original])
    revision = db_session.scalar(select(NewsArticleVersion))
    revised = {**original, "content": "Correction: original number was wrong.", "title": "Corrected announcement"}
    store_news(db_session, [revised])
    current = client.get("/news/a").json()
    assert current["content"] == revised["content"]
    historical = client.get("/news/a", params={"revision_id": revision.revision_id})
    assert historical.status_code == 200
    historical = historical.json()
    assert historical["title"] == original["title"] and historical["content"] == original["content"]
    assert historical["source_state"]["status"] == "historical"
    assert historical["source_state"]["eligible"] is False
    assert historical["event_analysis"]["status"] == "skipped" and historical["event_analysis"]["impacts"] == []
    assert client.get("/news/different", params={"revision_id": revision.revision_id}).status_code == 404
    assert client.get("/news/a", params={"revision_id": "f" * 64}).status_code == 404
    assert client.get("/news/a", params={"revision_id": "invalid"}).status_code == 422
    revision.snapshot_json = revision.snapshot_json.replace("123", "999")
    db_session.commit()
    assert client.get("/news/a", params={"revision_id": revision.revision_id}).status_code == 503


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
