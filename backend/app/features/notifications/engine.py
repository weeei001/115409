"""Generate durable inbox entries from existing close prices and analyzed news."""
from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from datetime import datetime, time, timedelta, timezone
from decimal import Decimal
from urllib.parse import quote

from sqlalchemy.exc import IntegrityError

from app.db.models.notification import Notification
from app.features.news.sentiment import parse_news_pub_time
from . import engine_repository as repository

TAIPEI = timezone(timedelta(hours=8))


def _utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _key(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _event_key(summary):
    # Exact normalized event summaries collapse syndicated reports. Differently
    # worded accounts may still produce separate notifications; no semantic call.
    return re.sub(r"[\W_]+", "", unicodedata.normalize("NFKC", summary).casefold())


def _events(db, favorites, config_hash, now):
    if not config_hash:
        return []
    cutoff = now - timedelta(hours=24)
    by_symbol = {favorite.symbol: favorite for favorite, _ in favorites}
    results = []
    # The existing analysis worker stores analyzed_at as naive Taipei time.
    for article, analysis, impact in repository.major_events(
            db, list(by_symbol), config_hash, cutoff.astimezone(TAIPEI).replace(tzinfo=None)):
        published, _ = parse_news_pub_time(article.pub_time)
        if published is None or not cutoff <= published <= now:
            continue
        if published < _utc(by_symbol[impact.target_id].created_at):
            continue
        try:
            events = json.loads(analysis.events_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(events, list):
            continue
        event = next((item for item in events if isinstance(item, dict) and item.get("key") == impact.event_key), None)
        if not event or event.get("statement_type") not in {"fact", "plan"}:
            continue
        summary = event.get("summary")
        if isinstance(summary, str) and _event_key(summary):
            results.append((article, impact.target_id, summary, published))
    return results


def generate_notifications(db, now=None, *, impact_config_hash=None):
    """Create each candidate once. The serial worker owns delivery and quiet hours.

    Naive input timestamps, preference timestamps and favorite timestamps are UTC.
    Market dates and the 14:30 publication gate use Asia/Taipei wall time.
    """
    now = _utc(now or datetime.now(timezone.utc))
    local = now.astimezone(TAIPEI)
    day = local.date()
    created = 0

    def save(pref, kind, title, body, url, dedupe, expires, symbol=None):
        nonlocal created
        key = _key(dedupe)
        if repository.already_created(db, pref.user_id, key):
            return
        try:
            with db.begin_nested():
                repository.insert(db, Notification(user_id=pref.user_id, kind=kind, title=title[:200],
                    body=body[:2000], url=url, symbol=symbol, dedupe_key=key,
                    created_at=now.replace(tzinfo=None), expires_at=expires.replace(tzinfo=None)))
        except IntegrityError:
            # A competing generator may have inserted this durable key.
            if not repository.already_created(db, pref.user_id, key):
                raise
        else:
            created += 1

    for pref in repository.enabled_preferences(db):
        favorites = repository.favorites(db, pref.user_id)
        if not favorites:
            continue
        symbols = [favorite.symbol for favorite, _ in favorites]
        events = _events(db, favorites, impact_config_hash, now) if pref.major_news or pref.daily_summary else []
        if pref.major_news:
            enabled_at = _utc(getattr(pref, "news_enabled_at", None) or pref.created_at)
            for article, symbol, summary, published in events:
                if published < enabled_at:
                    continue
                save(pref, "major_news", f"{symbol} 重大新聞／公告", summary,
                     f"/news/{quote(article.article_id, safe='')}",
                     f"news:{symbol}:{published.astimezone(TAIPEI).date()}:{_event_key(summary)}",
                     published.astimezone(timezone.utc) + timedelta(hours=24), symbol)
        if day.weekday() >= 5 or local.time() < time(14, 30) or not (pref.daily_summary or pref.price_alert):
            continue
        today, previous = repository.closing_prices(db, symbols, day)
        lines = []
        for favorite, name in favorites:
            symbol = favorite.symbol
            row, prior = today.get(symbol), previous.get(symbol)
            if row is None:
                continue
            change = (Decimal(row.close) / Decimal(prior.close) - 1) * 100 if prior else None
            label = f"{name}（{symbol}）" if name else symbol
            lines.append(f"{label} {row.close:,.2f} 元" + (f"（{change:+.2f}%）" if change is not None else "（無前收盤價）"))
            if pref.price_alert and change is not None and abs(change) >= Decimal(str(pref.price_threshold)):
                direction = "up" if change > 0 else "down"
                midnight = datetime.combine(day + timedelta(days=1), time.min, tzinfo=TAIPEI).astimezone(timezone.utc)
                save(pref, "price_alert", f"{label} 單日{'上漲' if change > 0 else '下跌'}達提醒門檻",
                     f"{day:%m/%d} 收盤 {row.close:,.2f} 元，較前一交易日 {change:+.2f}%。此為收盤行情提醒。",
                     f"/stock/{quote(symbol, safe='')}", f"price:{day}:{symbol}:{direction}", midnight, symbol)
        # Wait for complete closes until 18:00; suspended or delayed symbols must
        # not prevent the remaining favorites from receiving their daily summary.
        complete = len(today) == len(favorites)
        if pref.daily_summary and today and (complete or local.time() >= time(18)):
            brief = []
            seen = set()
            for _, symbol, summary, published in events:
                normalized = (symbol, _event_key(summary))
                if published.astimezone(TAIPEI).date() == day and normalized not in seen:
                    seen.add(normalized)
                    brief.append(f"{symbol}：{summary}")
            details = "；".join(lines)
            unavailable = [f"{name}（{favorite.symbol}）" if name else favorite.symbol
                           for favorite, name in favorites if favorite.symbol not in today]
            missing = "\n今日收盤資料尚未提供：" + "、".join(unavailable) if unavailable else ""
            news = "；".join(brief[:3]) if brief else "今日暫無已確認的重要新聞。"
            save(pref, "daily_summary", f"{day:%m/%d} 收藏股收盤摘要", details[:1100] + missing[:350] + "\n" + news[:500],
                 "/notifications", f"summary:{day}", now + timedelta(hours=24))
    db.commit()
    return created
