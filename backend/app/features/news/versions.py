"""Source identity, immutable observations and current eligibility; no transaction ownership."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from datetime import datetime, timezone
from types import SimpleNamespace
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy import select, exists, or_

from app.db.models.news_version import NewsArticleVersion, NewsSourceSelection, NewsSourceDecision
from app.db.models.news_article import NewsArticle
from app.features.news.sentiment import parse_news_pub_time

FIELDS = ("article_id", "source", "source_group", "stock_id", "title", "pub_time", "url", "tags", "content", "content_kind")
TRACKING = {"fbclid", "gclid", "dclid", "msclkid"}


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def canonical_url(value):
    """Only remove known tracking fields/fragments; preserve content query order and values."""
    try:
        parts = urlsplit((value or "").strip())
        if parts.scheme.lower() not in {"http", "https"} or not parts.hostname or parts.username or parts.password:
            return ""
        host = parts.hostname.lower()
        port = parts.port
        if port and not (parts.scheme.lower() == "http" and port == 80 or parts.scheme.lower() == "https" and port == 443):
            host += f":{port}"
        query = [(key, value) for key, value in parse_qsl(parts.query, keep_blank_values=True)
                 if not key.lower().startswith("utm_") and key.lower() not in TRACKING]
        # Known public article IDs are stable across protocol and tracking variations.
        if host == "news.cnyes.com" and re.fullmatch(r"/news/id/\d+/?", parts.path) and not query:
            return "https://news.cnyes.com" + parts.path.rstrip("/")
        return urlunsplit((parts.scheme.lower(), host, parts.path or "/", urlencode(query), ""))
    except ValueError:
        return ""


def source_identity(article):
    get = article.get if isinstance(article, dict) else lambda key: getattr(article, key, None)
    canonical = canonical_url(get("url"))
    identity = [get("source") or "", canonical or ("article:" + str(get("article_id")))]
    return hashlib.sha256(json.dumps(identity, ensure_ascii=False).encode()).hexdigest(), canonical


def snapshot(article):
    get = article.get if isinstance(article, dict) else lambda key: getattr(article, key, None)
    return {key: get(key) for key in FIELDS}


def content_digest(values):
    # IDs, URLs and crawl tags are provenance, not a distinct body revision.
    return hashlib.sha256(json.dumps({key: values.get(key) for key in
        ("title", "content", "pub_time", "content_kind")}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


def record_version(db, article, *, observed_at):
    values = snapshot(article)
    digest = content_digest(values)
    revision = hashlib.sha256(f"{values['article_id']}:{digest}".encode()).hexdigest()
    if db.get(NewsArticleVersion, revision) is None:
        db.add(NewsArticleVersion(revision_id=revision, article_id=values["article_id"],
            source_key=source_identity(article)[0], content_hash=digest,
            snapshot_json=json.dumps(values, ensure_ascii=False), observed_at=observed_at, recorded_at=utc_now()))
        db.flush()
    return revision


def set_selection(db, key, canonical, selected, status, reason):
    current = db.get(NewsSourceSelection, key)
    before = ({"selected_article_id": current.selected_article_id, "status": current.status,
               "reason": current.reason} if current else None)
    after = {"selected_article_id": selected, "status": status, "reason": reason}
    if before == after:
        return None
    now = utc_now()
    db.add(NewsSourceDecision(source_key=key, before_json=json.dumps(before), after_json=json.dumps(after),
                              reason=reason, observed_at=now))
    if current is None:
        current = NewsSourceSelection(source_key=key, canonical_url=canonical)
        db.add(current)
    for field, value in after.items():
        setattr(current, field, value)
    current.observed_at = now
    db.flush()
    return current


def acceptable_update(article, values):
    """Accept full-body corrections irrespective of length; reject failed extraction atomically."""
    old, new = article.content or "", values.get("content") or ""
    kind = values.get("content_kind") or "unknown"
    if article.content_kind == "full_text" and kind != "full_text":
        return False
    if old and (not new.strip() or kind == "title_only"):
        return False
    if re.search(r"access denied|captcha|verify you are human|cloudflare ray id|403 forbidden|驗證您是人類|存取遭拒", new, re.I):
        return False
    if kind == "full_text":
        if not new.strip() or re.search(r"access denied|captcha|verify you are human|cloudflare ray id|403 forbidden|驗證您是人類|存取遭拒", new, re.I):
            return False
        # A collapsed full body can be an extraction failure. Genuine very short notices
        # require explicit editorial review rather than automatic replacement.
        if len(old.strip()) >= 120 and len(new.strip()) < 30:
            return False
    elif article.content_kind == "unknown" and kind == "summary":
        return False
    return True


def update_article(db, article, values, *, observed_at=None):
    if not acceptable_update(article, values):
        return False
    candidate = snapshot(article)
    candidate.update({key: value for key, value in values.items() if key in FIELDS and key != "article_id"})
    if source_identity(candidate)[0] != source_identity(article)[0]:
        return False
    if candidate == snapshot(article):
        return False
    record_version(db, article, observed_at=None)
    for field, value in candidate.items():
        if field != "article_id":
            setattr(article, field, value)
    record_version(db, article, observed_at=observed_at or utc_now())
    return True


def effective_article_condition():
    """Current-source SQL filter, shared by count/page queries; original IDs remain readable."""
    return ~exists(select(NewsArticleVersion.article_id).join(NewsSourceSelection,
        NewsSourceSelection.source_key == NewsArticleVersion.source_key).where(
            NewsArticleVersion.article_id == NewsArticle.article_id,
            or_(NewsSourceSelection.status == "conflict", NewsSourceSelection.selected_article_id.is_(None),
                NewsSourceSelection.selected_article_id != NewsArticle.article_id)))


def source_states(db, articles, as_of=None):
    """Use publication time and current source selection; observations are provenance only."""
    articles = [SimpleNamespace(**article) if isinstance(article, Mapping) else article for article in articles]
    identities = {article.article_id: source_identity(article) for article in articles}
    selections = {row.source_key: row for row in db.scalars(select(NewsSourceSelection).where(
        NewsSourceSelection.source_key.in_({key for key, _ in identities.values()})))} if articles else {}
    versions = {(row.article_id, row.content_hash): row for row in db.scalars(select(NewsArticleVersion).where(
        NewsArticleVersion.article_id.in_(identities)))} if articles else {}
    cutoff = parse_news_pub_time(as_of.isoformat())[0] if as_of else None
    selection_states = {key: {"selected_article_id": row.selected_article_id, "status": row.status}
                        for key, row in selections.items()}
    result = {}
    for article in articles:
        key, canonical = identities[article.article_id]
        selection = selection_states.get(key)
        version = versions.get((article.article_id, content_digest(snapshot(article))))
        status = ("conflict" if selection and selection["status"] == "conflict" else
                  "superseded" if selection and selection["selected_article_id"] != article.article_id else
                  "active" if selection else "untracked")
        observed = version.observed_at if version else None
        published = parse_news_pub_time(getattr(article, "pub_time", None))[0]
        outside_cutoff = bool(cutoff and (published is None or published > cutoff))
        eligible = status not in {"conflict", "superseded"} and not outside_cutoff
        result[article.article_id] = {"eligible": eligible, "status": status, "canonical_key": key,
            "canonical_url": canonical, "revision_id": version.revision_id if version else None,
            "observed_at": observed.isoformat() + "Z" if observed else None,
            "limitation": ("Publication time is unknown or after the requested cutoff; excluded." if outside_cutoff else
                           "Selected by publication time using the current source revision; retrospective evidence, not a point-in-time reconstruction.")}
    return result
