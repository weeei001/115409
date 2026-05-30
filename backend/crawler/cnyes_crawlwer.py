import argparse
import html
import logging
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pymysql
import requests

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from database import get_pymysql_connect_kwargs

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


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

MYSQL_CONFIG = dict(get_pymysql_connect_kwargs(autocommit=True))

# 列表抓取與排程（定期更新，參數固定於此即可）
PAGE_LIMIT = 30
IS_CATEGORY_HEADLINE = 0
MAX_WORKERS = 4
MONTH_BACKFILL_DAYS = 30
SCHEDULE_LOOKBACK_DAYS = 5


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
        url = VALUES(url)
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
def run_by_year_month(
    start_dt: Optional[datetime] = None,
    end_dt: Optional[datetime] = None,
) -> None:
    limit = PAGE_LIMIT
    is_category_headline = IS_CATEGORY_HEADLINE
    max_workers = MAX_WORKERS

    if start_dt is None:
        start_dt = datetime(2024, 1, 1, 0, 0, 0)
    if end_dt is None:
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


def _scheduled_crawl_job() -> None:
    """排程用：固定回補最近 5 天，避免每日重掃全歷史。"""
    days = max(1, SCHEDULE_LOOKBACK_DAYS)
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=days)
    log.info("開始排程抓取鉅亨新聞（固定回補 %s 天）", days)
    try:
        run_by_year_month(start_dt=start_dt, end_dt=end_dt)
    except Exception:
        log.exception("排程抓取發生未預期錯誤")


def _month_backfill_job() -> None:
    """手動回補：只回補最近一個月。"""
    end_dt = datetime.now()
    start_dt = end_dt - timedelta(days=MONTH_BACKFILL_DAYS)
    log.info("開始手動回補鉅亨新聞（最近 %s 天）", MONTH_BACKFILL_DAYS)
    run_by_year_month(start_dt=start_dt, end_dt=end_dt)


def main() -> None:
    parser = argparse.ArgumentParser(description="鉅亨網台股新聞爬蟲")
    parser.add_argument(
        "--scheduled-once",
        action="store_true",
        help=f"執行一次排程抓取：固定回補最近 {SCHEDULE_LOOKBACK_DAYS} 天，供 scheduler_utils 呼叫",
    )
    parser.add_argument(
        "--backfill-month",
        action="store_true",
        help=f"手動回補最近 {MONTH_BACKFILL_DAYS} 天；未帶參數時也會執行此模式",
    )
    args = parser.parse_args()

    if args.scheduled_once:
        if args.backfill_month:
            parser.error("--scheduled-once 與 --backfill-month 請勿併用")
        _scheduled_crawl_job()
    else:
        _month_backfill_job()


if __name__ == "__main__":
    main()
