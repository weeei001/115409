"""Independent Cnyes and LTN news workers with page-sized database transactions."""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import logging
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.text import strip_tags
from app.db.engine import make_engine
from app.db.models.news_article import NewsArticle
from app.db.models.news_version import NewsSourceSelection
from app.features.news.versions import (source_identity, record_version, set_selection,
                                        update_article, acceptable_update, utc_now)


log = logging.getLogger(__name__)
TAIPEI = timezone(timedelta(hours=8))
CNYES_API_URL = "https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news"
CNYES_CATEGORIES = ("tw_stock_news", "wd_macro")
CNYES_ARTICLE_URL = "https://news.cnyes.com/news/id/{news_id}"
LTN_LIST_URL = "https://ec.ltn.com.tw/list_ajax/securities/{page}"
LTN_CATEGORIES = ("securities", "strategy", "international")
HEADERS = {"User-Agent": "Mozilla/5.0"}
CNYES_HEADERS = {**HEADERS, "Accept": "application/json, text/plain, */*",
                 "Origin": "https://news.cnyes.com", "Referer": "https://news.cnyes.com/"}
LTN_LIST_HEADERS = {**HEADERS, "x-requested-with": "XMLHttpRequest", "referer": "https://ec.ltn.com.tw/list/securities"}
AD_PHRASES = ["點我訂閱自由財經Youtube頻道", "不用抽 不用搶 現在用APP看新聞 保證天天中獎", "點我下載APP",
              "一手掌握經濟脈動", "按我看活動辦法"]
BOTTOM_KEYWORDS = ["相關新聞", "基金查詢more", "熱門新訊more", "注目新聞", "延伸閱讀", "看更多相關新聞"]
READ_MORE_RE = re.compile(r"請繼續往下閱讀[ \t]*(?:\.{3,}|\u2026+|\uFF0E{3,})?")
CNYES_ARTICLE_ID_RE = re.compile(r"/news/id/(\d+)(?:[/?#]|$)")


def _compact_lines(text: str, stop_markers: list[str] | tuple[str, ...]) -> str:
    lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if any(re.match(re.escape(stop) + r"(?:$|[\s:：｜|])", line) for stop in stop_markers):
            break
        lines.append(line)
    return "\n".join(lines)


def _remove_ad_phrases(text: str) -> str:
    text = READ_MORE_RE.sub("", text)
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if len(stripped) >= 3 and (set(stripped) == {"."}
                                   or set(stripped) == {"\u2026"}
                                   or set(stripped) == {"\uFF0E"}):
            continue
        lines.append(line)
    for phrase in AD_PHRASES:
        text = "\n".join(lines).replace(phrase, "")
        lines = text.splitlines()
    return "\n".join(lines)


def article_id(source: str, title: str, pub_time: str) -> str:
    return hashlib.md5(f"{source}_{title}_{pub_time}".encode("utf-8"), usedforsecurity=False).hexdigest()


def clean_html_content(raw: str | None) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"<br\s*/?>|</p>", "\n", text, flags=re.IGNORECASE)
    text = strip_tags(text).replace("\xa0", " ")
    text = re.sub(r"\n\s+\n", "\n\n", text)
    text = _remove_ad_phrases(text)
    text = _compact_lines(text, BOTTOM_KEYWORDS)
    text = re.sub(r"[ \t]+", " ", text).strip()
    return text


def _normalize_symbol(value: object) -> str:
    symbol = str(value).strip() if value is not None else ""
    prefix = re.fullmatch(r"(?:TW|TWSE|TPEX|TWS|TWO):([0-9]{4,6})", symbol, flags=re.IGNORECASE)
    suffix = re.fullmatch(r"([0-9]{4,6})\.(?:TW|TWO)", symbol, flags=re.IGNORECASE)
    return (prefix or suffix).group(1) if prefix or suffix else symbol


def _cnyes_news_id(value: object) -> int | None:
    raw = value
    if isinstance(value, dict):
        raw = value.get("newsId") or value.get("news_id") or value.get("id")
    try:
        news_id = int(str(raw).strip())
    except (TypeError, ValueError):
        return None
    return news_id if news_id > 0 else None


def cnyes_article_url(news_id: object) -> str | None:
    parsed = _cnyes_news_id(news_id)
    return CNYES_ARTICLE_URL.format(news_id=parsed) if parsed is not None else None


def cnyes_article_fields(raw_html: str) -> dict:
    """Extract title/body from the same public article JSON-LD record."""
    bodies = []
    soup = BeautifulSoup(raw_html or "", "html.parser")
    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        try:
            payload = json.loads(script.string or script.get_text())
        except (TypeError, json.JSONDecodeError):
            continue
        stack = payload if isinstance(payload, list) else [payload]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
            elif isinstance(item, dict):
                body = item.get("articleBody")
                if isinstance(body, str) and body.strip():
                    bodies.append({"content": clean_html_content(body), "headline": clean_html_content(item.get("headline")),
                                   "name": clean_html_content(item.get("name"))})
                graph = item.get("@graph")
                if isinstance(graph, (dict, list)):
                    stack.append(graph)
    if not bodies:
        return {}
    chosen = max(bodies, key=lambda item: len(item["content"]))
    headings = soup.select("article h1") or soup.select("h1")
    heading = clean_html_content(headings[0].get_text()) if len(headings) == 1 else ""
    title = chosen["headline"] or heading or chosen["name"]
    title = re.sub(r"\s+\|\s*鉅亨網\s*$", "", title)
    return {"content": chosen["content"], "title": title}


def cnyes_detail_article(http: httpx.Client, news_id: object) -> dict | None:
    url = cnyes_article_url(news_id)
    if not url:
        return None
    for attempt in range(2):
        try:
            response = http.get(url, headers=CNYES_HEADERS, timeout=20)
            response.raise_for_status()
            content = cnyes_article_fields(response.text)
            return content if content.get("content") else None
        except (httpx.HTTPError, ValueError) as exc:
            if attempt:
                log.warning("Cnyes article detail unavailable (%s)", type(exc).__name__)
    return None


def _cnyes_news_id_from_url(url: str | None) -> int | None:
    match = CNYES_ARTICLE_ID_RE.search(url or "")
    return _cnyes_news_id(match.group(1)) if match else None


def cnyes_item(row: dict) -> dict:
    timestamp = row.get("publishAt") or row.get("publish_at") or row.get("createdAt") or row.get("updatedAt")
    title = (row.get("title") or "").strip()
    if not title or not timestamp:
        raise ValueError("News requires a title and publication time")
    pub_time = datetime.fromtimestamp(int(timestamp), TAIPEI).isoformat()
    related = list(dict.fromkeys(code for value in (row.get("stock") or []) if (code := _normalize_symbol(value))))
    for market in row.get("market") or []:
        code = _normalize_symbol(market.get("code")) if isinstance(market, dict) else ""
        if code and code not in related:
            related.append(code)
    news_id = _cnyes_news_id(row)
    content = clean_html_content(row.get("content")) or clean_html_content(row.get("summary") or row.get("excerpt"))
    return {"article_id": article_id("cnyes", title, pub_time), "source": "cnyes", "source_group": "cnyes",
            "stock_id": related[0][:20] if related else None, "title": title, "pub_time": pub_time,
            "url": cnyes_article_url(news_id) or row.get("url") or row.get("link"),
            "tags": ",".join(related), "content": content,
            "content_kind": "summary" if content else "title_only"}


def cnyes_page(http: httpx.Client, page: int, start: int, end: int, limit: int = 30,
               category: str = "tw_stock_news") -> list[dict]:
    response = http.get(CNYES_API_URL.replace("tw_stock_news", category), headers=CNYES_HEADERS, timeout=30,
        params={"page": page, "limit": limit, "isCategoryHeadline": 0, "startAt": start, "endAt": end})
    response.raise_for_status()
    payload = response.json()
    if isinstance(payload, dict):
        items, data = payload.get("items"), payload.get("data")
        options = [items.get("data") if isinstance(items, dict) else items,
                   data if isinstance(data, list) else None,
                   data.get("items") if isinstance(data, dict) else None,
                   data.get("list") if isinstance(data, dict) else None, payload.get("list")]
        for rows in options:
            if isinstance(rows, list):
                return rows
    raise ValueError("Invalid Cnyes list response")


def month_ranges(start: datetime, end: datetime) -> list[tuple[int, int]]:
    start = start.replace(tzinfo=TAIPEI) if start.tzinfo is None else start.astimezone(TAIPEI)
    end = end.replace(tzinfo=TAIPEI) if end.tzinfo is None else end.astimezone(TAIPEI)
    ranges = []
    current = start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while current <= end:
        following = (current.replace(day=28) + timedelta(days=4)).replace(day=1)
        ranges.append((int(max(current, start).timestamp()), int(min(following - timedelta(seconds=1), end).timestamp())))
        current = following
    return ranges


def store_news(db: Session, items: list[dict]) -> dict[str, int]:
    if not items:
        return {"inserted": 0, "updated": 0, "skipped": 0}
    unique = {}
    seen_urls = set()
    duplicates = 0
    for item in items:
        source_url = source_identity(item)[0] if item.get("url") else None
        if item["article_id"] in unique or source_url in seen_urls:
            duplicates += 1
            continue
        unique.setdefault(item["article_id"], item)
        if source_url:
            seen_urls.add(source_url)
    try:
        existing = {article.article_id: article for article in db.scalars(
            select(NewsArticle).where(NewsArticle.article_id.in_(unique)))}
        urls = [item["url"] for key, item in unique.items() if key not in existing and item.get("url")]
        existing_urls = {}
        for article in db.scalars(select(NewsArticle).where(NewsArticle.url.in_(urls))) if urls else []:
            existing_urls.setdefault(source_identity(article)[0], []).append(article)
        inserted = updated = 0
        skipped = duplicates
        for key, item in unique.items():
            source_key, canonical = source_identity(item)
            selection = db.get(NewsSourceSelection, source_key)
            if selection is not None and selection.status == "conflict":
                skipped += 1
                continue
            matches = existing_urls.get(source_key, [])
            if len(matches) > 1 and selection is None:
                set_selection(db, source_key, canonical, None, "conflict", "Multiple legacy IDs require reviewed source selection")
                skipped += 1
                continue
            article = (db.get(NewsArticle, selection.selected_article_id) if selection else None)
            article = article or existing.get(key) or (matches[0] if matches else None)
            if article is not None and source_identity(article)[0] != source_key:
                skipped += 1
                continue
            if article is None:
                if not acceptable_update(NewsArticle(content="", content_kind=item.get("content_kind")), item):
                    skipped += 1
                    continue
                article = NewsArticle(**item)
                db.add(article)
                record_version(db, article, observed_at=utc_now())
                set_selection(db, source_key, canonical, article.article_id, "active", "First observed source")
                inserted += 1
                continue
            record_version(db, article, observed_at=None)
            if selection is None:
                set_selection(db, source_key, canonical, article.article_id, "active", "Existing source; earlier observation time unknown")
            changed = update_article(db, article, item)
            if changed:
                updated += 1
            else:
                skipped += 1
        db.commit()
        return {"inserted": inserted, "updated": updated, "skipped": skipped}
    except BaseException:
        db.rollback()
        raise


def crawl_cnyes(engine, http: httpx.Client, start: datetime, end: datetime,
                limit: int | None = None, fetch_details: bool = False) -> dict[str, int]:
    def crawl_range(bounds, category, seen_urls):
        result = {"inserted": 0, "updated": 0, "skipped": 0, "failed": 0}
        read = 0

        def build_item(row):
            try:
                item = cnyes_item(row)
                if fetch_details and (item["source"], item.get("url")) not in seen_urls:
                    detail = cnyes_detail_article(http, _cnyes_news_id(row))
                    if detail:
                        item["content"] = detail["content"]
                        if detail.get("title"):
                            item["title"] = detail["title"]
                        item["content_kind"] = "full_text"
                return item
            except Exception as exc:
                return exc

        with Session(engine) as db:
            page = 1
            previous_ids = None
            while True:
                try:
                    rows = cnyes_page(http, page, *bounds, category=category)
                except httpx.HTTPStatusError as exc:
                    if page > 1 and exc.response.status_code == 422:
                        break
                    log.error("Cnyes %s page %d failed (%s)", category, page, type(exc).__name__)
                    result["failed"] += 1
                    break
                except Exception as exc:
                    log.error("Cnyes %s page %d failed (%s)", category, page, type(exc).__name__)
                    result["failed"] += 1
                    break
                if not rows:
                    break
                remaining = len(rows) if limit is None else max(0, limit - read)
                rows_to_process = rows[:remaining]
                if fetch_details and rows_to_process:
                    with ThreadPoolExecutor(max_workers=min(8, len(rows_to_process))) as pool:
                        candidates = pool.map(build_item, rows_to_process)
                else:
                    candidates = (build_item(row) for row in rows_to_process)
                items = []
                for candidate in candidates:
                    if isinstance(candidate, Exception):
                        log.warning("Invalid Cnyes article (%s)", type(candidate).__name__)
                        result["failed"] += 1
                    else:
                        items.append(candidate)
                        read += 1
                ids = {item["article_id"] for item in items}
                if not items:
                    break
                if ids and ids == previous_ids:
                    log.error("Cnyes repeated a page; pagination stopped")
                    result["failed"] += 1
                    break
                previous_ids = ids
                fresh = [item for item in items if (item["source"], item.get("url")) not in seen_urls]
                try:
                    if fresh:
                        stored = store_news(db, fresh)
                        for key in ("inserted", "updated", "skipped"):
                            result[key] += stored[key]
                        seen_urls.update((item["source"], item.get("url")) for item in fresh)
                except Exception as exc:
                    log.error("Cnyes page write failed (%s)", type(exc).__name__)
                    result["failed"] += len(fresh)
                if limit is not None and read >= limit:
                    break
                if len(rows) < 30:
                    break
                page += 1
        return result
    totals = {"inserted": 0, "updated": 0, "skipped": 0, "failed": 0}
    for bounds in month_ranges(start, end):
        seen_urls = set()
        for category in CNYES_CATEGORIES:
            result = crawl_range(bounds, category, seen_urls)
            for key in totals:
                totals[key] += result[key]
    return totals


def refresh_cnyes_existing(engine, http: httpx.Client, limit: int | None = None) -> dict[str, int]:
    """Refresh stored CNYES bodies from the public article pages."""
    with Session(engine) as db:
        articles = list(db.scalars(select(NewsArticle).where(NewsArticle.source == "cnyes")
                                   .order_by(NewsArticle.article_id)))
    if limit is not None:
        articles = articles[:limit]

    def fetch(article):
        news_id = _cnyes_news_id_from_url(article.url)
        return article.article_id, cnyes_detail_article(http, news_id), news_id is not None

    result = {"read": len(articles), "updated": 0, "skipped": 0, "failed": 0}
    with Session(engine) as db:
        with ThreadPoolExecutor(max_workers=16) as pool:
            completed = 0
            for article_id, detail, attempted in pool.map(fetch, articles):
                completed += 1
                if completed % 500 == 0:
                    print(f"cnyes refresh progress={completed}/{len(articles)}", flush=True)
                article = db.get(NewsArticle, article_id)
                if article is None or not attempted or not detail or not detail.get("title"):
                    result["skipped"] += 1
                    continue
                key, _ = source_identity(article)
                selection = db.get(NewsSourceSelection, key)
                if selection and (selection.status != "active" or selection.selected_article_id != article.article_id):
                    result["skipped"] += 1
                    continue
                changed = update_article(db, article, {**detail, "content_kind": "full_text"})
                result["updated" if changed else "skipped"] += 1
                if (result["updated"] + result["skipped"]) % 50 == 0:
                    db.commit()
        db.commit()
    return result


def parse_list_time(raw: str | None) -> datetime | None:
    if raw:
        for pattern in ("%Y/%m/%d %H:%M", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
            try:
                return datetime.strptime(raw.strip(), pattern)
            except ValueError:
                continue
    return None


def clean_ltn_content(text: str) -> str:
    text = _remove_ad_phrases(text)
    text = _compact_lines(text, BOTTOM_KEYWORDS)
    text = re.sub(r"^.{0,80}（[^）\n]{2,20}[攝提供截取資料照示意圖]{1,3}[^）\n]{0,10}）\s*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^[^\n]{2,15}／(核稿編輯|記者|特約記者)[^\n]*$", "", text, flags=re.MULTILINE)
    text = re.sub(r"^〔記者[^\n]{2,30}報導〕\s*", "", text, flags=re.MULTILINE)
    return "\n".join(line for line in text.split("\n") if line.strip()).strip()


def ltn_article(raw_html: str, url: str, catalog: dict | None = None) -> dict:
    soup = BeautifulSoup(raw_html, "html.parser")
    heading, content_div = soup.select_one("h1"), soup.select_one(".content")
    title = heading.get_text().strip() if heading else ""
    meta = soup.find("meta", attrs={"name": "pubdate"})
    pub_time = str(meta.get("content", "")).strip() if meta else ""
    content = clean_ltn_content("\n".join(paragraph.get_text().strip() for paragraph in content_div.select("p"))) if content_div else ""
    if len(title) <= 3 or not pub_time.startswith("20") or len(content) < 30:
        raise ValueError("LTN article lacks usable title, publication date or content")
    from app.features.news.sentiment import extract_candidate_stocks
    symbols = extract_candidate_stocks(None, None, title, content, catalog)
    symbol = symbols[0] if symbols else "tw_stock"
    return {"article_id": article_id("ltn", title, pub_time), "source": "ltn", "source_group": "ltn",
            "stock_id": symbol, "title": title, "pub_time": pub_time, "url": url, "tags": ",".join(symbols),
            "content": content, "content_kind": "full_text"}


def collect_ltn_urls(http: httpx.Client, existing: set[str], cutoff: datetime,
                     max_pages: int = 700, category: str = "securities") -> tuple[list[str], int]:
    def fetch(page):
        response = http.get(LTN_LIST_URL.replace("securities", category).format(page=page),
                            headers={**LTN_LIST_HEADERS, "referer": f"https://ec.ltn.com.tw/list/{category}"}, timeout=10)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError("Invalid LTN list response")
        return rows
    urls, seen, empty_streak, failed = [], set(), 0, 0
    with ThreadPoolExecutor(max_workers=5) as pool:
        for first_page in range(1, max_pages + 1, 10):
            futures = {page: pool.submit(fetch, page) for page in range(first_page, min(first_page + 10, max_pages + 1))}
            for page, future in futures.items():
                try:
                    rows = future.result()
                except Exception as exc:
                    failed += 1
                    log.error("LTN page %d failed (%s)", page, type(exc).__name__)
                    rows = []
                if not rows:
                    empty_streak += 1
                    if empty_streak >= 3:
                        return urls, failed
                    continue
                empty_streak = 0
                times = [parsed for row in rows if (parsed := parse_list_time(row.get("A_ViewTime"))) is not None]
                if times and max(times) < cutoff:
                    return urls, failed
                for row in rows:
                    when = parse_list_time(row.get("A_ViewTime"))
                    url = (row.get("url") or "").strip()
                    if when and when < cutoff or not url or url in seen or url in existing:
                        continue
                    parsed = urlparse(url)
                    if parsed.scheme not in {"https", "http"} or parsed.hostname not in {"ec.ltn.com.tw", "news.ltn.com.tw"}:
                        failed += 1
                        continue
                    seen.add(url)
                    urls.append(url)
    return urls, failed


def crawl_ltn(engine, http: httpx.Client, cutoff: datetime) -> dict[str, int]:
    from app.features.market.company_catalog import load_catalog
    catalog = load_catalog()

    def fetch(url):
        response = http.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        return ltn_article(response.text, url, catalog)
    totals = {"inserted": 0, "updated": 0, "skipped": 0, "failed": 0}
    with Session(engine) as db:
        existing = set(db.scalars(select(NewsArticle.url).where(NewsArticle.source == "ltn", NewsArticle.url.is_not(None))))
        db.rollback()
        urls = []
        for category in LTN_CATEGORIES:
            found, failed = collect_ltn_urls(http, existing | set(urls), cutoff, category=category)
            urls.extend(found)
            totals["failed"] += failed
        with ThreadPoolExecutor(max_workers=6) as pool:
            for future in as_completed([pool.submit(fetch, url) for url in urls]):
                try:
                    stored = store_news(db, [future.result()])
                    for key in ("inserted", "updated", "skipped"):
                        totals[key] += stored[key]
                except Exception as exc:
                    totals["failed"] += 1
                    log.error("LTN article failed (%s)", type(exc).__name__)
    return totals


def crawler_main(source: str, argv: list[str] | None = None) -> int:
    if source not in {"cnyes", "ltn"}:
        raise ValueError("Unsupported crawler source")
    parser = argparse.ArgumentParser(description=f"Crawl {source} into existing news_articles")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--scheduled-once", action="store_true")
    if source == "cnyes":
        group.add_argument("--refresh-existing", action="store_true",
                           help="Refresh existing CNYES article bodies from their detail pages")
        parser.add_argument("--limit", type=int, help="Maximum CNYES articles to inspect")
    parser.add_argument("--lookback-days", type=int, default=30)
    args = parser.parse_args(argv)
    if source == "cnyes" and args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    days = 5 if source == "cnyes" and args.scheduled_once else max(1, args.lookback_days)
    now = datetime.now(TAIPEI)
    engine = make_engine(get_settings())
    try:
        from app.jobs.impact.migrate import migrate_news_impact
        migrate_news_impact(engine)
        with httpx.Client() as http:
            if source == "cnyes":
                if args.refresh_existing:
                    result = refresh_cnyes_existing(engine, http, args.limit)
                else:
                    result = crawl_cnyes(engine, http, now - timedelta(days=days), now,
                                         args.limit, True)
            else:
                result = crawl_ltn(engine, http, (now - timedelta(days=days)).replace(tzinfo=None))
        log.info("%s crawl result: %s", source, result)
        print(json.dumps({"source": source, **result}, sort_keys=True))
        return int(result["failed"] > 0)
    except Exception as exc:
        log.error("%s crawler failed (%s)", source, type(exc).__name__)
        return 1
    finally:
        engine.dispose()
