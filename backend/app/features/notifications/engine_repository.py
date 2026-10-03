"""Database reads and inserts used by notification generation."""
from sqlalchemy import or_, select

from app.db.models.daily_price import DailyPrice
from app.db.models.favorite_stock import FavoriteStock
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis, NewsEventImpact
from app.db.models.notification import Notification, NotificationPreference
from app.db.models.stock_info import StockInfo
from app.db.models.user import User
from app.features.news.versions import effective_article_condition


def enabled_preferences(db):
    return db.scalars(select(NotificationPreference).join(User, User.id == NotificationPreference.user_id)
                      .where(User.is_active.is_(True), or_(NotificationPreference.daily_summary.is_(True),
                             NotificationPreference.price_alert.is_(True), NotificationPreference.major_news.is_(True)))).all()


def favorites(db, user_id):
    return db.execute(select(FavoriteStock, StockInfo.name).outerjoin(StockInfo, StockInfo.symbol == FavoriteStock.symbol)
                      .where(FavoriteStock.user_id == user_id).order_by(FavoriteStock.symbol)).all()


def closing_prices(db, symbols, day):
    today = db.scalars(select(DailyPrice).where(DailyPrice.symbol.in_(symbols), DailyPrice.date == day,
                                              DailyPrice.close > 0)).all()
    previous = {}
    for symbol in symbols:
        row = db.scalar(select(DailyPrice).where(DailyPrice.symbol == symbol, DailyPrice.date < day,
                                                DailyPrice.close > 0).order_by(DailyPrice.date.desc()).limit(1))
        if row is not None:
            previous[symbol] = row
    return {row.symbol: row for row in today}, previous


def major_events(db, symbols, config_hash, since):
    # Analysis time bounds the candidates. Legacy publication strings are parsed
    # consistently in the service before use.
    return db.execute(select(NewsArticle, NewsEventAnalysis, NewsEventImpact)
        .join(NewsEventAnalysis, NewsEventAnalysis.article_id == NewsArticle.article_id)
        .join(NewsEventImpact, NewsEventImpact.article_id == NewsArticle.article_id)
        .where(NewsEventImpact.target_type == "company", NewsEventImpact.target_id.in_(symbols),
               NewsEventImpact.importance == "high", NewsEventImpact.basis == "reported",
               NewsEventAnalysis.status == "success",
               NewsEventAnalysis.input_hash == NewsArticle.analysis_input_hash,
               NewsEventAnalysis.config_hash == config_hash,
               NewsEventAnalysis.analyzed_at >= since,
               effective_article_condition()).order_by(NewsArticle.pub_time.desc(), NewsArticle.article_id)).all()


def already_created(db, user_id, dedupe_key):
    return db.scalar(select(Notification.id).where(Notification.user_id == user_id,
                                                  Notification.dedupe_key == dedupe_key)) is not None


def insert(db, notification):
    db.add(notification)
    db.flush()
