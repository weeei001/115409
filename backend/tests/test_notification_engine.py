import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select

from app.db.models.daily_price import DailyPrice
from app.db.models.favorite_stock import FavoriteStock
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.db.models.news_version import NewsArticleVersion, NewsSourceSelection
from app.db.models.notification import Notification, NotificationPreference
from app.db.models.user import User
from app.features.notifications.engine import generate_notifications

NOW = datetime(2026, 10, 2, 7, tzinfo=timezone.utc)
BASELINE = datetime(2026, 10, 1)


def seed(db, **preferences):
    user = User(email="notification-engine@example.com", is_active=True)
    db.add(user)
    db.flush()
    pref = NotificationPreference(user_id=user.id, created_at=BASELINE, **preferences)
    db.add_all([pref, FavoriteStock(user_id=user.id, symbol="2330", created_at=BASELINE)])
    db.commit()
    return pref


def prices(db, close=106):
    db.add_all([DailyPrice(symbol="2330", date=date(2026, 10, 1), close=100),
                DailyPrice(symbol="2330", date=date(2026, 10, 2), close=close)])
    db.commit()


def article(db, article_id="article", *, statement="fact", summary="Company announced a merger.",
            pub_time="2026-10-02T14:00:00+08:00", basis="reported", importance="high", stale=False):
    row = NewsArticle(article_id=article_id, title=summary, content=summary, pub_time=pub_time)
    db.add(row)
    db.flush()
    analysis = NewsEventAnalysis(article_id=article_id, input_hash="old" if stale else row.analysis_input_hash,
        config_hash="current-config", status="success", analyzed_at=NOW.replace(tzinfo=None),
        events_json=json.dumps([{"key": "e1", "summary": summary, "statement_type": statement}]))
    impact = NewsEventImpact(article_id=article_id, event_key="e1", target_type="company", target_id="2330",
        direction="uncertain", importance=importance, basis=basis, reason="Direct company announcement", evidence="[]")
    db.add_all([analysis, impact])
    db.commit()
    return row


def notifications(db):
    return db.scalars(select(Notification).order_by(Notification.id)).all()


def test_close_summary_and_price_threshold_are_durable(db_session):
    seed(db_session, daily_summary=True, price_alert=True)
    prices(db_session, close=105)
    assert generate_notifications(db_session, NOW) == 2
    rows = notifications(db_session)
    assert {row.kind for row in rows} == {"daily_summary", "price_alert"}
    alert = next(row for row in rows if row.kind == "price_alert")
    assert alert.symbol == "2330" and "+5.00%" in alert.body and "收盤" in alert.body
    assert generate_notifications(db_session, NOW + timedelta(minutes=5)) == 0


def test_default_opt_out_and_trading_date_gate(db_session):
    pref = seed(db_session)
    prices(db_session)
    assert generate_notifications(db_session, NOW) == 0
    pref.daily_summary = pref.price_alert = True
    db_session.commit()
    assert generate_notifications(db_session, NOW.replace(hour=6, minute=29)) == 0
    assert generate_notifications(db_session, NOW + timedelta(days=1)) == 0
    assert generate_notifications(db_session, NOW + timedelta(days=3)) == 0


def test_summary_waits_for_all_favorites_and_missing_prior_is_safe(db_session):
    pref = seed(db_session, daily_summary=True, price_alert=True)
    prices(db_session, close=96)
    db_session.add(FavoriteStock(user_id=pref.user_id, symbol="2317", created_at=BASELINE))
    db_session.commit()
    assert generate_notifications(db_session, NOW) == 0
    db_session.add(DailyPrice(symbol="2317", date=date(2026, 10, 2), close=200))
    db_session.commit()
    assert generate_notifications(db_session, NOW) == 1
    assert "2317" in notifications(db_session)[0].body


def test_partial_summary_after_1800_identifies_missing_prices(db_session):
    pref = seed(db_session, daily_summary=True)
    prices(db_session)
    db_session.add(FavoriteStock(user_id=pref.user_id, symbol="2317", created_at=BASELINE))
    db_session.commit()
    assert generate_notifications(db_session, NOW.replace(hour=9, minute=59)) == 0
    assert generate_notifications(db_session, NOW.replace(hour=10)) == 1
    row = notifications(db_session)[0]
    assert "2330 106.00" in row.body
    assert "今日收盤資料尚未提供：2317" in row.body
    db_session.add(DailyPrice(symbol="2317", date=date(2026, 10, 2), close=200))
    db_session.commit()
    assert generate_notifications(db_session, NOW.replace(hour=11)) == 0


def test_partial_summary_still_requires_today_prices_and_weekday(db_session):
    seed(db_session, daily_summary=True)
    db_session.add(DailyPrice(symbol="2330", date=date(2026, 10, 1), close=100))
    db_session.commit()
    assert generate_notifications(db_session, NOW.replace(hour=10)) == 0
    db_session.add(DailyPrice(symbol="2330", date=date(2026, 10, 3), close=106))
    db_session.commit()
    assert generate_notifications(db_session, (NOW + timedelta(days=1)).replace(hour=10)) == 0


def test_news_requires_current_direct_fresh_factual_evidence(db_session):
    seed(db_session, major_news=True)
    article(db_session, "forecast", statement="forecast")
    article(db_session, "opinion", statement="opinion")
    article(db_session, "inferred", basis="inferred")
    article(db_session, "medium", importance="medium")
    article(db_session, "stale", stale=True)
    article(db_session, "old", pub_time="2026-09-30T14:00:00+08:00")
    article(db_session, "future", pub_time="2026-10-02T16:00:00+08:00")
    article(db_session, "valid")
    assert generate_notifications(db_session, NOW) == 0
    assert generate_notifications(db_session, NOW, impact_config_hash="other-config") == 0
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 1
    assert notifications(db_session)[0].url == "/news/valid"


def test_news_dedupes_normalized_event_across_sources(db_session):
    seed(db_session, major_news=True)
    article(db_session, "a", summary="Company announced a merger.")
    article(db_session, "b", summary="Company announced a merger!")
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 1
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 0


def test_news_respects_enable_time_and_favorite_time(db_session):
    pref = seed(db_session, major_news=True)
    article(db_session)
    pref.news_enabled_at = NOW.replace(tzinfo=None) - timedelta(minutes=15)
    db_session.commit()
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 0
    pref.news_enabled_at = BASELINE
    favorite = db_session.scalar(select(FavoriteStock))
    favorite.created_at = NOW.replace(tzinfo=None) - timedelta(minutes=15)
    db_session.commit()
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 0


def test_news_excludes_conflicted_source(db_session):
    seed(db_session, major_news=True)
    article(db_session)
    db_session.add_all([
        NewsArticleVersion(revision_id="revision", article_id="article", source_key="source", content_hash="hash",
                           snapshot_json="{}", recorded_at=BASELINE),
        NewsSourceSelection(source_key="source", canonical_url="https://example.com/news", status="conflict",
                            selected_article_id=None, reason="Conflicting evidence", observed_at=BASELINE),
    ])
    db_session.commit()
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 0


def test_daily_summary_includes_news_and_inactive_user_receives_nothing(db_session):
    pref = seed(db_session, daily_summary=True)
    prices(db_session, close=101)
    article(db_session)
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 1
    assert "Company announced a merger" in notifications(db_session)[0].body
    db_session.get(User, pref.user_id).is_active = False
    pref.major_news = True
    db_session.commit()
    assert generate_notifications(db_session, NOW, impact_config_hash="current-config") == 0
