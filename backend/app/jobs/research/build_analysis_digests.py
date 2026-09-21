"""Calendar anchors and lazy retrieval settings for research workers."""
from datetime import date, timedelta

from app.core.config import get_settings


def _fridays(start: date, end: date):
    d = start
    while d.weekday() != 4:  # 移到第一個週五
        d += timedelta(days=1)
    while d <= end:
        yield d
        d += timedelta(days=7)


def _month_ends(start: date, end: date):
    # 逐月推進，取每月最後一天
    y, m = start.year, start.month
    while True:
        # 下個月第一天再減一天 = 當月最後一天
        ny, nm = (y + 1, 1) if m == 12 else (y, m + 1)
        last = date(ny, nm, 1) - timedelta(days=1)
        if last > end:
            break
        if last >= start:
            yield last
        y, m = ny, nm


def anchor_dates(start: date, end: date, period: str):
    if start > end:
        raise ValueError("start must be on or before end")
    if period == "day":
        return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    if period not in {"week", "month"}:
        raise ValueError("period must be day, week or month")
    return list(_fridays(start, end) if period == "week" else _month_ends(start, end))


def build_qdrant_embeddings():
    # The shared VectorClient performs embedding and retrieval in one HTTP lifetime.
    return get_settings(), None
