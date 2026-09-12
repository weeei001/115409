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
from sqlalchemy.dialects.mysql import insert as mysql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.engine import make_engine
from app.db.models.news_article import NewsArticle


log = logging.getLogger(__name__)
TAIPEI = timezone(timedelta(hours=8))
CNYES_API_URL = "https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news"
LTN_LIST_URL = "https://ec.ltn.com.tw/list_ajax/securities/{page}"
HEADERS = {"User-Agent": "Mozilla/5.0"}
CNYES_HEADERS = {**HEADERS, "Accept": "application/json, text/plain, */*",
                 "Origin": "https://news.cnyes.com", "Referer": "https://news.cnyes.com/"}
LTN_LIST_HEADERS = {**HEADERS, "x-requested-with": "XMLHttpRequest", "referer": "https://ec.ltn.com.tw/list/securities"}
LTN_ALIASES = [("2330", ["台積電", "台積", "TSMC"]), ("2317", ["鴻海", "Foxconn", "富士康"]),
               ("2454", ["聯發科", "MediaTek"]), ("2881", ["富邦金", "富邦金控"]),
               ("2408", ["南亞科"]), ("2615", ["萬海"])]
AD_PHRASES = ["點我訂閱自由財經Youtube頻道", "不用抽 不用搶 現在用APP看新聞 保證天天中獎", "點我下載APP",
              "一手掌握經濟脈動", "按我看活動辦法"]
BOTTOM_KEYWORDS = ["相關新聞", "基金查詢more", "熱門新訊more", "注目新聞", "延伸閱讀", "看更多相關新聞"]
READ_MORE_RE = re.compile(r"請繼續往下閱讀[ \t]*(?:\.{3,}|\u2026+|\uFF0E{3,})?")


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
    return hashlib.md5(f"{source}_{title}_{pub_time}".encode("utf-8")).hexdigest()


def clean_html_content(raw: str | None) -> str:
    text = html.unescape(raw or "")
    text = re.sub(r"<br\s*/?>|</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text).replace("\xa0", " ")
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
    raw_id = row.get("newsId") or row.get("news_id") or row.get("id")
    try:
        news_id = int(raw_id) if raw_id is not None else None
    except (TypeError, ValueError):
        news_id = None
    return {"article_id": article_id("cnyes", title, pub_time), "source": "cnyes", "source_group": "cnyes",
            "stock_id": related[0][:20] if related else None, "title": title, "pub_time": pub_time,
            "url": row.get("url") or row.get("link") or (f"https://news.cnyes.com/news/id/{news_id}" if news_id else None),
            "tags": ",".join(related), "content": clean_html_content(row.get("content"))
            or clean_html_content(row.get("summary") or row.get("excerpt"))}


def cnyes_page(http: httpx.Client, page: int, start: int, end: int, limit: int = 30) -> list[dict]:
    response = http.get(CNYES_API_URL, headers=CNYES_HEADERS, timeout=30,
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


def store_news(db: Session, items: list[dict]) -> tuple[int, int]:
    if not items:
        return 0, 0
    unique = {}
    for item in items:
        unique.setdefault(item["article_id"], item)
    try:
        existing = set(db.scalars(select(NewsArticle.article_id).where(NewsArticle.article_id.in_(unique))))
        new = [item for key, item in unique.items() if key not in existing]
        if new:
            table = NewsArticle.__table__
            if db.bind.dialect.name == "sqlite":
                statement = sqlite_insert(table).values(new).on_conflict_do_nothing(index_elements=["article_id"])
            else:
                statement = mysql_insert(table).values(new)
                statement = statement.on_duplicate_key_update(article_id=statement.inserted.article_id)
            db.execute(statement)
            db.commit()
        else:
            db.rollback()
        return len(new), len(items) - len(new)
    except BaseException:
        db.rollback()
        raise


def crawl_cnyes(engine, http: httpx.Client, start: datetime, end: datetime) -> dict[str, int]:
    def crawl_range(bounds):
        result = {"inserted": 0, "skipped": 0, "failed": 0}
        with Session(engine) as db:
            page = 1
            previous_ids = None
            while True:
                try:
                    rows = cnyes_page(http, page, *bounds)
                except httpx.HTTPStatusError as exc:
                    if page > 1 and exc.response.status_code == 422:
                        break
                    log.error("Cnyes page %d failed (%s)", page, type(exc).__name__)
                    result["failed"] += 1
                    break
                except Exception as exc:
                    log.error("Cnyes page %d failed (%s)", page, type(exc).__name__)
                    result["failed"] += 1
                    break
                if not rows:
                    break
                items = []
                for row in rows:
                    try:
                        items.append(cnyes_item(row))
                    except Exception as exc:
                        log.warning("Invalid Cnyes article (%s)", type(exc).__name__)
                        result["failed"] += 1
                ids = {item["article_id"] for item in items}
                if not items:
                    break
                if ids and ids == previous_ids:
                    log.error("Cnyes repeated a page; pagination stopped")
                    result["failed"] += 1
                    break
                previous_ids = ids
                try:
                    inserted, skipped = store_news(db, items)
                    result["inserted"] += inserted
                    result["skipped"] += skipped
                except Exception as exc:
                    log.error("Cnyes page write failed (%s)", type(exc).__name__)
                    result["failed"] += len(items)
                if len(rows) < 30:
                    break
                page += 1
        return result
    totals = {"inserted": 0, "skipped": 0, "failed": 0}
    with ThreadPoolExecutor(max_workers=4) as pool:
        for result in pool.map(crawl_range, month_ranges(start, end)):
            for key in totals:
                totals[key] += result[key]
    return totals


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


def ltn_article(raw_html: str, url: str) -> dict:
    soup = BeautifulSoup(raw_html, "html.parser")
    heading, content_div = soup.select_one("h1"), soup.select_one(".content")
    title = heading.get_text().strip() if heading else ""
    meta = soup.find("meta", attrs={"name": "pubdate"})
    pub_time = str(meta.get("content", "")).strip() if meta else ""
    content = clean_ltn_content("\n".join(paragraph.get_text().strip() for paragraph in content_div.select("p"))) if content_div else ""
    if len(title) <= 3 or not pub_time.startswith("20") or len(content) < 30:
        raise ValueError("LTN article lacks usable title, publication date or content")
    haystack = title + " " + content
    # ponytail: curated aliases only; use an exchange symbol catalog when broader coverage is needed.
    symbols = [code for code, aliases in LTN_ALIASES
               if re.search(r"(?<![A-Za-z0-9_.])" + code + r"(?![A-Za-z0-9_.])", haystack)
               or any(re.search(r"(?<![A-Za-z])" + re.escape(alias) + r"(?![A-Za-z])", haystack, re.IGNORECASE)
                      if alias.isascii() else alias in haystack for alias in aliases)]
    symbol = symbols[0] if symbols else "tw_stock"
    return {"article_id": article_id("ltn", title, pub_time), "source": "ltn", "source_group": "ltn",
            "stock_id": symbol, "title": title, "pub_time": pub_time, "url": url, "tags": ",".join(symbols), "content": content}


def collect_ltn_urls(http: httpx.Client, existing: set[str], cutoff: datetime,
                     max_pages: int = 700) -> tuple[list[str], int]:
    def fetch(page):
        response = http.get(LTN_LIST_URL.format(page=page), headers=LTN_LIST_HEADERS, timeout=10)
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
    def fetch(url):
        response = http.get(url, headers=HEADERS, timeout=15)
        response.raise_for_status()
        return ltn_article(response.text, url)
    totals = {"inserted": 0, "skipped": 0, "failed": 0}
    with Session(engine) as db:
        existing = set(db.scalars(select(NewsArticle.url).where(NewsArticle.source == "ltn", NewsArticle.url.is_not(None))))
        db.rollback()
        urls, totals["failed"] = collect_ltn_urls(http, existing, cutoff)
        with ThreadPoolExecutor(max_workers=6) as pool:
            for future in as_completed([pool.submit(fetch, url) for url in urls]):
                try:
                    inserted, skipped = store_news(db, [future.result()])
                    totals["inserted"] += inserted
                    totals["skipped"] += skipped
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
        group.add_argument("--backfill-month", action="store_true")
    parser.add_argument("--lookback-days", type=int, default=30)
    args = parser.parse_args(argv)
    days = 5 if source == "cnyes" and args.scheduled_once else max(1, args.lookback_days)
    now = datetime.now(TAIPEI)
    engine = make_engine(get_settings())
    try:
        with httpx.Client() as http:
            if source == "cnyes":
                result = crawl_cnyes(engine, http, now - timedelta(days=days), now)
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
