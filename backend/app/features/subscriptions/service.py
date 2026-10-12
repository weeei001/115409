"""Plans, demo activation without payment, and the limits each plan enforces."""
import hashlib
import hmac
import logging
import math
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import AppError, ServiceUnavailable
from app.db.models.subscription import UserSubscription
from app.db.models.user import User
from app.features.subscriptions import repository
from app.features.subscriptions.plans import (
    PLAN_LIMITS, PLAN_NAMES, PlanLimits, ask_resets_at, month_start, renewal_date, taipei_today,
)
from app.features.subscriptions.schemas import (
    ActivateSubscriptionRequest, AskQuotaStatus, PlanLimitsStatus, SubscriptionInfo, SubscriptionStatus,
)


class PlanLimitReached(AppError):
    def __init__(self, detail: str):
        super().__init__(detail, 403)


class AskQuotaExceeded(AppError):
    def __init__(self, detail: str, retry_after: int):
        super().__init__(detail, 429, {"Retry-After": str(retry_after)})


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _commit(db: Session) -> None:
    try:
        db.commit()
    except SQLAlchemyError:
        db.rollback()
        raise


def user_subject(user_id: int) -> str:
    return f"user:{user_id}"


def guest_subject(address: str, secret: str) -> str:
    digest = hmac.new(secret.encode(), address.encode(), hashlib.sha256).hexdigest()
    return f"guest:{digest[:40]}"


def plan_of(db: Session, user_id: int | None) -> str:
    row = repository.subscription(db, user_id) if user_id is not None else None
    return row.plan if row is not None and row.plan in PLAN_LIMITS else "free"


def limits_for(db: Session, user_id: int | None) -> PlanLimits:
    return PLAN_LIMITS[plan_of(db, user_id)]


def _ask_limit(plan: str, guest: bool) -> int:
    limits = PLAN_LIMITS[plan]
    return limits.ask_guest if guest and limits.ask_guest is not None else limits.ask_member


def _ask_used(db: Session, subject: str, per: str, today, *, row=None) -> int:
    if per == "day":
        row = row if row is not None else repository.usage_row(db, subject, today)
        return row.count if row is not None else 0
    return repository.usage_since(db, subject, month_start(today), today)


def _ask_status(db: Session, subject: str, plan: str, guest: bool, now: datetime) -> AskQuotaStatus:
    today = taipei_today(now)
    per, limit = PLAN_LIMITS[plan].ask_per, _ask_limit(plan, guest)
    used = _ask_used(db, subject, per, today)
    return AskQuotaStatus(per=per, limit=limit, used=used, remaining=max(0, limit - used),
                          resets_at=ask_resets_at(per, today), guest=guest)


def _subscription_info(row: UserSubscription | None) -> SubscriptionInfo | None:
    if row is None or row.plan not in ("plus", "pro"):
        return None
    return SubscriptionInfo(plan=row.plan, billing=row.billing, started_on=row.started_on,
                            renews_on=renewal_date(row.started_on, row.billing))


def status(db: Session, user: User | None, guest: str, now: datetime | None = None) -> SubscriptionStatus:
    """Current plan and usage; guests (no account) are counted by `guest`, the hashed client address."""
    now = now or _utcnow()
    user_id = user.id if user is not None else None
    row = repository.subscription(db, user_id) if user_id is not None else None
    subscription = _subscription_info(row)
    plan = subscription.plan if subscription else "free"
    limits = PLAN_LIMITS[plan]
    subject = user_subject(user_id) if user_id is not None else guest
    return SubscriptionStatus(
        plan=plan, signed_in=user_id is not None, subscription=subscription,
        ask=_ask_status(db, subject, plan, user_id is None, now),
        limits=PlanLimitsStatus(favorites=limits.favorites, compare=limits.compare,
                                history_days=limits.history_days, push=limits.push),
        favorites_used=repository.favorite_count(db, user_id) if user_id is not None else None,
    )


def activate(db: Session, user: User, body: ActivateSubscriptionRequest, now: datetime | None = None) -> SubscriptionStatus:
    """Demo activation: switches the plan without any payment. Changing plan or billing restarts the period."""
    now = now or _utcnow()
    user_id = user.id
    for attempt in range(2):
        row = repository.subscription(db, user_id)
        if row is None:
            db.add(UserSubscription(user_id=user_id, plan=body.plan, billing=body.billing, started_on=taipei_today(now)))
        elif (row.plan, row.billing) != (body.plan, body.billing):
            row.plan, row.billing, row.started_on = body.plan, body.billing, taipei_today(now)
        try:
            _commit(db)
            break
        except IntegrityError:
            if attempt:
                raise
    return status(db, user, "", now)


def cancel(db: Session, user: User, now: datetime | None = None) -> SubscriptionStatus:
    """Back to the free plan right away; favorites and conversations are kept."""
    repository.delete_subscription(db, user.id)
    _commit(db)
    return status(db, user, "", now)


def ensure_favorite_capacity(db: Session, user_id: int) -> None:
    plan = plan_of(db, user_id)
    limit = PLAN_LIMITS[plan].favorites
    if limit is not None and repository.favorite_count(db, user_id) >= limit:
        raise PlanLimitReached(f"{PLAN_NAMES[plan]}最多收藏 {limit} 檔，請先移除其他收藏，或升級{PLAN_NAMES['plus']}收藏不限檔數。")


def push_allowed(db: Session, user_id: int) -> bool:
    return limits_for(db, user_id).push


def ensure_push_allowed(db: Session, user_id: int) -> None:
    if not push_allowed(db, user_id):
        raise PlanLimitReached(f"Web、Android 推播是{PLAN_NAMES['plus']}起的功能；站內通知不受影響。")


def history_cutoff(db: Session, user_id: int, now: datetime | None = None) -> datetime | None:
    """Naive UTC time before which conversations are hidden for this user's plan; None keeps everything."""
    days = limits_for(db, user_id).history_days
    if days is None:
        return None
    return (now or _utcnow()).astimezone(timezone.utc).replace(tzinfo=None) - timedelta(days=days)


def _quota_message(plan: str, guest: bool, limit: int, per: str) -> str:
    when = "今天" if per == "day" else "本月"
    who = "訪客" if guest else PLAN_NAMES[plan]
    reset = "明天（台北時間）恢復" if per == "day" else "下個月 1 日恢復"
    if guest:
        upgrade = f"；登入後每日可問 {PLAN_LIMITS['free'].ask_member} 次"
    elif plan == "free":
        upgrade = f"；{PLAN_NAMES['plus']}每月可問 {PLAN_LIMITS['plus'].ask_member} 次"
    elif plan == "plus":
        upgrade = f"；{PLAN_NAMES['pro']}每月可問 {PLAN_LIMITS['pro'].ask_member} 次"
    else:
        upgrade = ""
    return f"{when}的 {limit} 次{who} AI 提問額度已用完，{reset}{upgrade}。個股頁的 AI 投資分析不受額度限制。"


class AskQuota:
    """Counts AI chat questions (AI 對話與小燈) against the plan's quota."""

    def __init__(self, session_factory, subject: str, user_id: int | None = None, now=None):
        """subject: user_subject(user_id) for members, guest_subject(...) for guests (user_id None)."""
        self.session_factory = session_factory
        self.subject = subject
        self.user_id = user_id
        self._now = now or _utcnow

    @contextmanager
    def reserve(self):
        """Take one question before answering; give it back if answering fails on the server side."""
        if self.session_factory is None:
            raise ServiceUnavailable("AI 提問額度暫時無法確認，請稍後再試")
        subject, user_id = self.subject, self.user_id
        now = self._now()
        today = taipei_today(now)
        guest = user_id is None
        with self.session_factory() as db, db.begin():
            plan = plan_of(db, user_id)
            per, limit = PLAN_LIMITS[plan].ask_per, _ask_limit(plan, guest)
            row = repository.locked_usage_row(db, subject, today)
            if _ask_used(db, subject, per, today, row=row) >= limit:
                retry_after = max(1, math.ceil((ask_resets_at(per, today) - now).total_seconds()))
                raise AskQuotaExceeded(_quota_message(plan, guest, limit, per), retry_after)
            row.count += 1
        try:
            yield
        except Exception:
            self._release(subject, today)
            raise

    def _release(self, subject: str, day) -> None:
        try:
            with self.session_factory() as db, db.begin():
                repository.release_usage(db, subject, day)
        except SQLAlchemyError:
            logging.getLogger(__name__).error("Could not return an AI question to the quota")
