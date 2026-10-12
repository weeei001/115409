"""Subscription and AI question usage queries; callers own the transaction."""
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError

from app.db.models.favorite_stock import FavoriteStock
from app.db.models.subscription import AiAskUsage, UserSubscription


def subscription(db, user_id):
    return db.get(UserSubscription, user_id)


def delete_subscription(db, user_id):
    db.execute(delete(UserSubscription).where(UserSubscription.user_id == user_id))


def favorite_count(db, user_id):
    return db.scalar(select(func.count()).select_from(FavoriteStock).where(FavoriteStock.user_id == user_id)) or 0


def usage_row(db, subject, day, *, lock=False):
    statement = select(AiAskUsage).where(AiAskUsage.subject == subject, AiAskUsage.day == day)
    if lock:
        statement = statement.with_for_update()
    return db.scalar(statement.execution_options(populate_existing=True))


def locked_usage_row(db, subject, day):
    """Today's usage row, created when missing and locked so one subject's reservations run one at a time."""
    row = usage_row(db, subject, day, lock=True)
    if row is None:
        try:
            with db.begin_nested():
                db.add(AiAskUsage(subject=subject, day=day, count=0))
                db.flush()
        except IntegrityError:
            pass  # A concurrent request created it first.
        row = usage_row(db, subject, day, lock=True)
    return row


def usage_since(db, subject, first_day, last_day):
    return db.scalar(select(func.coalesce(func.sum(AiAskUsage.count), 0)).where(
        AiAskUsage.subject == subject, AiAskUsage.day >= first_day, AiAskUsage.day <= last_day)) or 0


def release_usage(db, subject, day):
    db.execute(update(AiAskUsage).where(AiAskUsage.subject == subject, AiAskUsage.day == day, AiAskUsage.count > 0)
               .values(count=AiAskUsage.count - 1))
