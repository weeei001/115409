"""Plan limits and Asia/Taipei calendar helpers.

The frontend pricing page shows the same numbers (frontend/Topic/features/pricing/plans.ts PLAN_LIMITS);
change both together.
"""
import calendar
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

PlanId = Literal["free", "plus", "pro"]
PaidPlanId = Literal["plus", "pro"]
Billing = Literal["monthly", "yearly"]
AskPeriod = Literal["day", "month"]

TAIPEI = ZoneInfo("Asia/Taipei")


@dataclass(frozen=True)
class PlanLimits:
    ask_per: AskPeriod
    ask_member: int
    # Guests (no account) only exist on the free plan.
    ask_guest: int | None
    # None means unlimited.
    favorites: int | None
    compare: int
    # Conversations untouched for longer than this are hidden; None keeps them all.
    history_days: int | None
    push: bool


PLAN_LIMITS: dict[str, PlanLimits] = {
    "free": PlanLimits(ask_per="day", ask_member=5, ask_guest=3, favorites=10, compare=5, history_days=30, push=False),
    "plus": PlanLimits(ask_per="month", ask_member=300, ask_guest=None, favorites=None, compare=30, history_days=None,
                       push=True),
    "pro": PlanLimits(ask_per="month", ask_member=1000, ask_guest=None, favorites=None, compare=30, history_days=None,
                      push=True),
}

PLAN_NAMES = {"free": "免費版", "plus": "進階版", "pro": "專業版"}


def taipei_today(now: datetime | None = None) -> date:
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    return now.astimezone(TAIPEI).date()


def month_start(day: date) -> date:
    return day.replace(day=1)


def add_months(day: date, months: int) -> date:
    """Same day N months later; months without that day use their last day (Jan 31 + 1 month = Feb 28)."""
    index = day.month - 1 + months
    year, month = day.year + index // 12, index % 12 + 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


def renewal_date(started_on: date, billing: str) -> date:
    return add_months(started_on, 12 if billing == "yearly" else 1)


def ask_resets_at(per: str, today: date) -> datetime:
    """UTC instant of the next Asia/Taipei midnight (daily) or first day of next month (monthly)."""
    next_day = today + timedelta(days=1) if per == "day" else add_months(month_start(today), 1)
    return datetime.combine(next_day, time(), TAIPEI).astimezone(timezone.utc)
