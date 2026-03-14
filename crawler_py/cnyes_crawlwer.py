import html
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymysql
import requests
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _get_env(*keys: str, default: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value is not None and value != "":
            return value
    return default


# =========================
# 基本設定
# =========================
API_URL = "https://api.cnyes.com/media/api/v1/newslist/category/tw_stock_news"

HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
    "Origin": "https://news.cnyes.com",
    "Referer": "https://news.cnyes.com/",
}

MYSQL_CONFIG = {
    "host": _get_env("DATABASE_HOST", "DB_HOST", default="localhost"),
    "port": int(_get_env("DATABASE_PORT", "DB_PORT", default="3306")),
    "user": _get_env("DATABASE_USER", "DB_USER", default="root"),
    "password": _get_env("DATABASE_PASSWORD", "DB_PASS", default=""),
    "database": _get_env("DATABASE_NAME", "DB_NAME", default="topic_stock"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": True,
}


# =========================
# MySQL
# =========================
def get_conn():
    return pymysql.connect(**MYSQL_CONFIG)


def upsert_news(conn, item: Dict[str, Any]) -> None:
    sql = """
    INSERT INTO cnyes_tw_stock_news
    (
        news_id, title, content, related_stocks,
        publish_time, url
    )
    VALUES
    (
        %(news_id)s, %(title)s, %(content)s, %(related_stocks)s,
        %(publish_time)s, %(url)s
    )
    ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        content = VALUES(content),
        related_stocks = VALUES(related_stocks),
        publish_time = VALUES(publish_time),
        url = VALUES(url),
        updated_at = CURRENT_TIMESTAMP
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, item)


def news_exists(conn, news_id: int) -> bool:
    sql = "SELECT 1 FROM cnyes_tw_stock_news WHERE news_id = %s LIMIT 1"
    with conn.cursor() as cursor:
        cursor.execute(sql, (news_id,))
        return cursor.fetchone() is not None


# =========================
# 工具
# =========================
def ts_to_mysql_datetime(ts: Optional[int]) -> Optional[str]:
    if not ts:
        return None
    try:
        return datetime.fromtimestamp(int(ts)).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return None


def build_article_url(news_id: Any) -> Optional[str]:
    if not news_id:
        return None
    return f"https://news.cnyes.com/news/id/{news_id}"


def extract_news_id(row: Dict[str, Any]) -> Optional[int]:
    news_id = row.get("newsId") or row.get("news_id") or row.get("id")
    if news_id is None:
        return None
    try:
        return int(news_id)
    except (TypeError, ValueError):
        return None


def clean_html_content(raw: Optional[str]) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\n\s+\n", "\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)
    return text.strip()


def normalize_related_stocks(row: Dict[str, Any]) -> Optional[str]:
    stocks: List[str] = []

    for s in row.get("stock", []) or []:
        s = str(s).strip()
        if s and s not in stocks:
            stocks.append(s)

    for m in row.get("market", []) or []:
        if isinstance(m, dict):
            code = str(m.get("code", "")).strip()
            if code and code not in stocks:
                stocks.append(code)

    return ",".join(stocks) if stocks else None


def month_ranges(start_dt: datetime, end_dt: datetime) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []

    current = datetime(start_dt.year, start_dt.month, 1, 0, 0, 0)

    while current <= end_dt:
        if current.month == 12:
            next_month = datetime(current.year + 1, 1, 1, 0, 0, 0)
        else:
            next_month = datetime(current.year, current.month + 1, 1, 0, 0, 0)

        range_start = max(current, start_dt)
        range_end = min(next_month - timedelta(seconds=1), end_dt)

        if range_start <= range_end:
            ranges.append((int(range_start.timestamp()), int(range_end.timestamp())))

        current = next_month

    return ranges


# =========================
# 呼叫 API
# =========================
def fetch_news_list(
    page: int = 1,
    limit: int = 30,
    is_category_headline: int = 0,
    start_at: Optional[int] = None,
    end_at: Optional[int] = None,
) -> List[Dict[str, Any]]:
    params = {
        "page": page,
        "limit": limit,
        "isCategoryHeadline": is_category_headline,
    }

    if start_at is not None:
        params["startAt"] = start_at
    if end_at is not None:
        params["endAt"] = end_at

    resp = requests.get(API_URL, params=params, headers=HEADERS, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    if isinstance(data, dict):
        if "items" in data:
            items = data["items"]

            if isinstance(items, dict) and "data" in items and isinstance(items["data"], list):
                return items["data"]

            if isinstance(items, list):
                return items

        if "data" in data:
            if isinstance(data["data"], list):
                return data["data"]

            if isinstance(data["data"], dict):
                if "items" in data["data"] and isinstance(data["data"]["items"], list):
                    return data["data"]["items"]
                if "list" in data["data"] and isinstance(data["data"]["list"], list):
                    return data["data"]["list"]

        if "list" in data and isinstance(data["list"], list):
            return data["list"]

    raise ValueError(f"無法辨識 API 回傳格式: {str(data)[:500]}")


# =========================
# 資料轉換
# =========================
def transform_news_item(row: Dict[str, Any]) -> Dict[str, Any]:
    news_id = extract_news_id(row)

    publish_at = (
        row.get("publishAt")
        or row.get("publish_at")
        or row.get("createdAt")
        or row.get("updatedAt")
    )

    title = (row.get("title") or "").strip()
    summary = clean_html_content(row.get("summary") or row.get("excerpt") or "")
    content = clean_html_content(row.get("content") or "") or summary

    article_url = row.get("url") or row.get("link") or build_article_url(news_id)
    related_stocks = normalize_related_stocks(row)

    return {
        "news_id": news_id,
        "title": title,
        "content": content,
        "related_stocks": related_stocks,
        "publish_time": ts_to_mysql_datetime(publish_at),
        "url": article_url,
    }


def process_month_range(
    start_at: int,
    end_at: int,
    limit: int,
    is_category_headline: int,
    processed_news_ids: set,
    processed_lock: threading.Lock,
) -> Tuple[int, int, int]:
    conn = get_conn()
    success = 0
    failed = 0
    skipped = 0

    try:
        print(
            f"[Thread] 抓取區間: {datetime.fromtimestamp(start_at)} ~ {datetime.fromtimestamp(end_at)}"
        )

        page = 1
        while True:
            try:
                rows = fetch_news_list(
                    page=page,
                    limit=limit,
                    is_category_headline=is_category_headline,
                    start_at=start_at,
                    end_at=end_at,
                )
            except Exception as e:
                print(f"[Thread] 區間抓取失敗 page={page}: {e}")
                failed += 1
                break

            if not rows:
                print(f"[Thread] 此區間第 {page} 頁無資料，結束")
                break

            print(f"[Thread] 第 {page} 頁抓到 {len(rows)} 筆")

            for row in rows:
                try:
                    item = transform_news_item(row)

                    if item["news_id"] is None:
                        print("[Thread] 跳過：缺少或無效 news_id")
                        failed += 1
                        continue

                    with processed_lock:
                        if item["news_id"] in processed_news_ids:
                            print(f"[Thread] 本次執行已處理過，跳過 news_id={item['news_id']}")
                            skipped += 1
                            continue
                        processed_news_ids.add(item["news_id"])

                    if news_exists(conn, item["news_id"]):
                        print(f"[Thread] 已存在，跳過 news_id={item['news_id']}")
                        skipped += 1
                        continue

                    upsert_news(conn, item)
                    success += 1
                    print(f"[Thread] 已寫入: {item['news_id']} | {item['title']}")

                except Exception as e:
                    failed += 1
                    print(f"[Thread] 單筆失敗: {e}")

            if len(rows) < limit:
                print("[Thread] 此區間已到最後一頁")
                break

            page += 1

    finally:
        conn.close()

    return success, skipped, failed


# =========================
# 主流程
# =========================
def run_by_year_month():
    limit = int(os.getenv("CNYES_LIMIT", "30"))
    is_category_headline = int(os.getenv("CNYES_IS_CATEGORY_HEADLINE", "0"))
    max_workers = int(os.getenv("CNYES_MAX_WORKERS", "4"))

    start_dt = datetime(2024, 1, 1, 0, 0, 0)
    end_dt = datetime.now()

    success = 0
    failed = 0
    skipped = 0

    processed_news_ids = set()
    processed_lock = threading.Lock()

    ranges = month_ranges(start_dt, end_dt)

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [
            executor.submit(
                process_month_range,
                start_at,
                end_at,
                limit,
                is_category_headline,
                processed_news_ids,
                processed_lock,
            )
            for start_at, end_at in ranges
        ]

        for future in as_completed(futures):
            try:
                s, sk, f = future.result()
                success += s
                skipped += sk
                failed += f
            except Exception as e:
                failed += 1
                print(f"區間任務失敗: {e}")

    print(f"完成，成功 {success} 筆，跳過 {skipped} 筆，失敗 {failed} 筆")


if __name__ == "__main__":
    run_by_year_month()