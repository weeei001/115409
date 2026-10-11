"""Source identity and current eligibility; no transaction ownership."""
from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from types import SimpleNamespace
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.features.news.text import parse_news_pub_time

FIELDS = ("article_id", "source", "source_group", "stock_id", "title", "pub_time", "url", "tags", "content", "content_kind")
TRACKING = {"fbclid", "gclid", "dclid", "msclkid"}


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


def update_article(db, article, values):
    if not acceptable_update(article, values):
        return False
    candidate = snapshot(article)
    candidate.update({key: value for key, value in values.items() if key in FIELDS and key != "article_id"})
    if source_identity(candidate)[0] != source_identity(article)[0]:
        return False
    if candidate == snapshot(article):
        return False
    for field, value in candidate.items():
        if field != "article_id":
            setattr(article, field, value)
    return True


def source_states(db, articles, as_of=None):
    """Use latest source content, bounded by publication time when requested."""
    articles = [SimpleNamespace(**article) if isinstance(article, Mapping) else article for article in articles]
    identities = {article.article_id: source_identity(article) for article in articles}
    cutoff = parse_news_pub_time(as_of.isoformat())[0] if as_of else None
    result = {}
    for article in articles:
        key, canonical = identities[article.article_id]
        published = parse_news_pub_time(getattr(article, "pub_time", None))[0]
        outside_cutoff = bool(cutoff and (published is None or published > cutoff))
        eligible = not outside_cutoff
        result[article.article_id] = {"eligible": eligible, "status": "active", "canonical_key": key,
            "canonical_url": canonical,
            "limitation": ("Publication time is unknown or after the requested cutoff; excluded." if outside_cutoff else
                           "Selected by publication time using the latest source content; retrospective evidence, not a point-in-time reconstruction.")}
    return result
