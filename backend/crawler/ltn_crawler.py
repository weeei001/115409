"""自由時報財經（ec.ltn.com.tw）新聞爬蟲：抓到就直接寫入 MySQL `news_articles`。

改寫自 rag/crawler_ltn_gui.py，沿用其 list_ajax 分頁 + 並行抓內文的邏輯，
但拿掉整條 CSV 中繼流程（ltn_news.csv → clean_ltn.py → ingest_sources.py），
清洗與股票代號判定改成在記憶體內完成，逐篇 upsert 進資料庫。

與舊版的差異：
    - 從 page 1 起抓（舊版從 page 2 開始，每輪都漏掉最新一頁 20 篇）
    - 停止條件改為「列表日期早於回補區間」，而非「連續 N 頁全已知」，
      排程中斷後補跑也能把區間內的缺口補齊
    - 去重：先撈資料庫既有的 ltn url 略過，寫入前再用 article_id 檔一次
    - 內文清洗沿用 rag/clean_news.py 的 clean_ltn_news_text 規則（不依賴 pandas）

用法：
    python ltn_crawler.py                      # 回補最近 30 天
    python ltn_crawler.py --scheduled-once     # 同上，供 scheduler_utils.py 排程呼叫
    python ltn_crawler.py --lookback-days 90   # 自訂回補天數
"""

import argparse
import hashlib
import json
import logging
import re
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import pymysql
import requests
from bs4 import BeautifulSoup

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
LIST_API_URL = "https://ec.ltn.com.tw/list_ajax/securities/{page}"

HEADERS = {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                  "AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
}
AJAX_HEADERS = {
    **HEADERS,
    "x-requested-with": "XMLHttpRequest",
    "referer": "https://ec.ltn.com.tw/list/securities",
}

MYSQL_CONFIG = dict(get_pymysql_connect_kwargs(autocommit=True))

# news_articles 的來源標記；source_group 對媒體站台而言與 source 相同
SOURCE = "ltn"
SOURCE_GROUP = "ltn"

# 列表抓取與排程（定期更新，參數固定於此即可）
MAX_PAGES = 700            # 列表頁數上限，防呆用
API_WORKERS = 5            # 列表 API 並行數
API_BATCH_SIZE = 10        # 每批抓幾頁列表
ARTICLE_WORKERS = 6        # 抓內文並行數
EMPTY_PAGE_LIMIT = 3       # 連續幾頁空白就停
SCHEDULE_LOOKBACK_DAYS = 30
MIN_CONTENT_LENGTH = 30    # 清洗後內文長度下限
MIN_TITLE_LENGTH = 3

# 內文中的推銷語句，抓下來就直接濾掉
AD_PHRASES = [
    "點我訂閱自由財經Youtube頻道",
    "不用抽 不用搶 現在用APP看新聞 保證天天中獎",
    "點我下載APP",
]

# 內文底部導覽／推薦區塊，出現即從該處截斷
BOTTOM_KEYWORDS = [
    "一手掌握經濟脈動",
    "按我看活動辦法",
    "相關新聞",
    "基金查詢more",
    "熱門新訊more",
    "注目新聞",
    "請繼續往下閱讀",
    "延伸閱讀",
    "看更多相關新聞",
]

# 6 檔目標台股的代號 + 別名（公司名）。比對順序：代號 → 任一別名。
# 命中第一檔即回傳，避免一篇談台積電供應鏈的新聞被歸到鴻海。
TARGET_STOCKS_ALIASES = [
    ("2330", ["台積電", "台積", "TSMC"]),
    ("2317", ["鴻海", "Foxconn", "富士康"]),
    ("2454", ["聯發科", "MediaTek"]),
    ("2881", ["富邦金", "富邦金控"]),
    ("2408", ["南亞科"]),
    ("2615", ["萬海"]),
]
DEFAULT_STOCK_ID = "tw_stock"


# =========================
# MySQL
# =========================
def get_conn():
    return pymysql.connect(**MYSQL_CONFIG)


def upsert_news(conn, item: Dict[str, Any]) -> None:
    sql = """
    INSERT INTO news_articles
    (
        article_id, source, source_group, stock_id,
        title, pub_time, url, tags, content
    )
    VALUES
    (
        %(article_id)s, %(source)s, %(source_group)s, %(stock_id)s,
        %(title)s, %(pub_time)s, %(url)s, %(tags)s, %(content)s
    )
    ON DUPLICATE KEY UPDATE
        source = VALUES(source),
        source_group = VALUES(source_group),
        stock_id = VALUES(stock_id),
        title = VALUES(title),
        pub_time = VALUES(pub_time),
        url = VALUES(url),
        tags = VALUES(tags),
        content = VALUES(content)
    """
    with conn.cursor() as cursor:
        cursor.execute(sql, item)


def load_existing_urls(conn) -> Set[str]:
    """撈出資料庫既有的 LTN 連結，列表階段就略過，省下抓內文的請求。"""
    sql = "SELECT url FROM news_articles WHERE source = %s AND url IS NOT NULL"
    with conn.cursor() as cursor:
        cursor.execute(sql, (SOURCE,))
        return {row["url"] for row in cursor.fetchall() if row["url"]}


def news_exists(conn, article_id: str) -> bool:
    sql = "SELECT 1 FROM news_articles WHERE article_id = %s LIMIT 1"
    with conn.cursor() as cursor:
        cursor.execute(sql, (article_id,))
        return cursor.fetchone() is not None


# =========================
# 工具
# =========================
def build_article_id(source: str, title: str, pub_time: Optional[str]) -> str:
    """與 rag/news_storage_mysql.py 相同的 article_id 規則，確保跨來源去重一致。"""
    return hashlib.md5(f"{source}_{title}_{pub_time}".encode("utf-8")).hexdigest()


def extract_stock_id(*texts: Optional[str]) -> str:
    """從任意數量的文字片段（標題、內文…）判定股票代號，未命中白名單回傳 tw_stock。"""
    haystack = " ".join(t for t in texts if t)
    for code, aliases in TARGET_STOCKS_ALIASES:
        if code in haystack:
            return code
        for name in aliases:
            if name in haystack:
                return code
    return DEFAULT_STOCK_ID


def parse_list_time(raw: Optional[str]) -> Optional[datetime]:
    """列表 API 的 A_ViewTime 是 '2026/08/01 08:22'（斜線），僅供判斷是否還在回補區間。"""
    if not raw:
        return None
    for fmt in ("%Y/%m/%d %H:%M", "%Y/%m/%d", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            return datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue
    return None


def clean_content(text: str) -> str:
    """沿用 rag/clean_news.py 的 clean_ltn_news_text 規則，去掉站台雜訊與署名。"""
    if not text or not text.strip():
        return ""

    # 1. 推銷語句
    for ad in AD_PHRASES:
        text = text.replace(ad, "")

    # 2. 切除底部導覽/推薦區塊
    for kw in BOTTOM_KEYWORDS:
        idx = text.find(kw)
        if idx != -1:
            text = text[:idx]

    # 3. 移除圖片說明行（獨立一行的短句含括號來源）
    text = re.sub(
        r'^.{0,80}（[^）\n]{2,20}[攝提供截取資料照示意圖]{1,3}[^）\n]{0,10}）\s*$',
        '', text, flags=re.MULTILINE,
    )

    # 4. 移除記者/編輯署名行
    text = re.sub(r'^[^\n]{2,15}／(核稿編輯|記者|特約記者)[^\n]*$', '', text, flags=re.MULTILINE)
    text = re.sub(r'^〔記者[^\n]{2,30}報導〕\s*', '', text, flags=re.MULTILINE)

    # 5. 壓縮空行
    text = "\n".join(line for line in text.split("\n") if line.strip())
    return text.strip()


# =========================
# 抓取
# =========================
def fetch_list_page(page: int) -> Tuple[int, Optional[List[Dict[str, Any]]]]:
    """抓單頁列表，回傳 (page, 資料 或 None)。None 代表該頁失敗或已無資料。"""
    try:
        resp = requests.get(
            LIST_API_URL.format(page=page), headers=AJAX_HEADERS, timeout=10
        )
        data = json.loads(resp.text)
        return page, (data if data else None)
    except Exception as e:
        log.warning("列表第 %s 頁抓取失敗: %s", page, e)
        return page, None


def fetch_article(url: str) -> Optional[Dict[str, Any]]:
    """抓單篇內文並清洗，回傳可直接寫入 news_articles 的 dict；不合格回傳 None。"""
    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        soup = BeautifulSoup(resp.text, "html.parser")

        h1 = soup.select_one("h1")
        title = h1.text.strip() if h1 else ""
        if len(title) <= MIN_TITLE_LENGTH:
            return None

        # pub_time 沿用頁面 meta 的 ISO8601（例：2026-07-31T20:21:08+08:00），
        # 與既有資料一致才不會因格式不同重算出新的 article_id。
        time_meta = soup.find("meta", attrs={"name": "pubdate"})
        pub_time = time_meta.get("content", "").strip() if time_meta else ""
        if not pub_time or not pub_time.startswith("20"):
            return None

        content_div = soup.select_one(".content")
        if not content_div:
            return None
        content = "\n".join(p.text.strip() for p in content_div.select("p"))
        content = clean_content(content)
        if len(content) < MIN_CONTENT_LENGTH:
            return None

        return {
            "article_id": build_article_id(SOURCE, title, pub_time),
            "source": SOURCE,
            "source_group": SOURCE_GROUP,
            "stock_id": extract_stock_id(title, content[:1000]),
            "title": title,
            "pub_time": pub_time,
            "url": url,
            "tags": "",
            "content": content,
        }
    except Exception as e:
        log.warning("抓取內文失敗 %s: %s", url, e)
        return None


def collect_article_urls(existing_urls: Set[str], cutoff: datetime) -> List[str]:
    """走訪列表 API，收集回補區間內、資料庫還沒有的文章連結。

    列表依時間新到舊排列，因此整頁最新一篇都早於 cutoff 時即可停止翻頁。
    """
    urls: List[str] = []
    seen: Set[str] = set()
    empty_streak = 0
    page = 1
    stop = False
    oldest_seen: Optional[datetime] = None

    while page <= MAX_PAGES and not stop:
        batch = list(range(page, min(page + API_BATCH_SIZE, MAX_PAGES + 1)))
        results: Dict[int, Optional[List[Dict[str, Any]]]] = {}
        with ThreadPoolExecutor(max_workers=API_WORKERS) as pool:
            futures = [pool.submit(fetch_list_page, p) for p in batch]
            for future in as_completed(futures):
                pg, data = future.result()
                results[pg] = data

        # 依頁碼順序處理，停止判斷才不會被亂序影響
        for pg in sorted(results):
            data = results[pg]
            if data is None:
                empty_streak += 1
                if empty_streak >= EMPTY_PAGE_LIMIT:
                    log.info("連續 %s 頁無資料，列表結束於第 %s 頁", empty_streak, pg)
                    stop = True
                    break
                continue
            empty_streak = 0

            page_times = [parse_list_time(item.get("A_ViewTime")) for item in data]
            page_times = [t for t in page_times if t]
            if page_times:
                page_newest = max(page_times)
                page_oldest = min(page_times)
                if oldest_seen is None or page_oldest < oldest_seen:
                    oldest_seen = page_oldest
                # 整頁都早於回補起點，後面只會更舊
                if page_newest < cutoff:
                    log.info(
                        "第 %s 頁最新一篇 %s 已早於回補起點 %s，停止翻頁",
                        pg, page_newest.strftime("%Y-%m-%d %H:%M"), cutoff.strftime("%Y-%m-%d"),
                    )
                    stop = True
                    break

            for item in data:
                pub_dt = parse_list_time(item.get("A_ViewTime"))
                if pub_dt and pub_dt < cutoff:
                    continue
                url = (item.get("url") or "").strip()
                if not url or url in seen or url in existing_urls:
                    continue
                seen.add(url)
                urls.append(url)

        page = batch[-1] + 1

    if oldest_seen:
        log.info("列表掃到 %s，待抓新文章 %s 篇", oldest_seen.strftime("%Y-%m-%d %H:%M"), len(urls))
    else:
        log.info("列表未取得任何資料")
    return urls


# =========================
# 主流程
# =========================
def run_crawl(lookback_days: int = SCHEDULE_LOOKBACK_DAYS) -> None:
    """回補最近 lookback_days 天的 LTN 財經新聞，逐篇寫入 news_articles。"""
    cutoff = datetime.now() - timedelta(days=max(1, lookback_days))
    log.info("開始抓取 LTN 財經新聞（回補最近 %s 天，起點 %s）",
             lookback_days, cutoff.strftime("%Y-%m-%d"))

    conn = get_conn()
    try:
        existing_urls = load_existing_urls(conn)
        log.info("資料庫既有 LTN 文章 %s 篇", len(existing_urls))

        urls = collect_article_urls(existing_urls, cutoff)
        if not urls:
            log.info("沒有新文章，結束")
            return

        success = 0
        skipped = 0
        failed = 0
        write_lock = threading.Lock()

        with ThreadPoolExecutor(max_workers=ARTICLE_WORKERS) as pool:
            futures = [pool.submit(fetch_article, u) for u in urls]
            for future in as_completed(futures):
                item = future.result()
                if not item:
                    failed += 1
                    continue
                # 抓到就寫；連線只有一條，寫入用鎖串起來
                with write_lock:
                    try:
                        if news_exists(conn, item["article_id"]):
                            skipped += 1
                            continue
                        upsert_news(conn, item)
                        success += 1
                        log.info("已寫入 %s | %s | %s",
                                 item["pub_time"][:16], item["stock_id"], item["title"][:40])
                    except Exception as e:
                        failed += 1
                        log.error("寫入失敗 %s: %s", item["url"], e)

        log.info("完成，成功 %s 筆，跳過 %s 筆，失敗 %s 筆", success, skipped, failed)
    finally:
        conn.close()


def _scheduled_crawl_job(lookback_days: int) -> None:
    log.info("開始排程抓取 LTN 新聞（固定回補 %s 天）", lookback_days)
    try:
        run_crawl(lookback_days=lookback_days)
    except Exception:
        log.exception("排程抓取發生未預期錯誤")


def main() -> None:
    parser = argparse.ArgumentParser(description="自由時報財經新聞爬蟲（直接寫入 news_articles）")
    parser.add_argument(
        "--scheduled-once",
        action="store_true",
        help="執行一次排程抓取後結束，供 scheduler_utils 呼叫（失敗只記 log 不拋例外）",
    )
    parser.add_argument(
        "--lookback-days",
        type=int,
        default=SCHEDULE_LOOKBACK_DAYS,
        help=f"回補最近幾天（預設 {SCHEDULE_LOOKBACK_DAYS}）",
    )
    args = parser.parse_args()

    if args.scheduled_once:
        _scheduled_crawl_job(args.lookback_days)
    else:
        run_crawl(lookback_days=args.lookback_days)


if __name__ == "__main__":
    main()
