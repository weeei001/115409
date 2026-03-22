"""
cmnews.com.tw 個股新聞爬蟲（列表 + 內文）
- 列表：呼叫 Article/Search/Tags API，以 tag（如 萬海(2615)）與 cursor 分頁。
- 內文：優先呼叫 xlab 內文 API 以 articleId 取得 content；若沒設定 API key 才退回抓 HTML。
- 依賴：httpx、python-dotenv；若 FETCH_ARTICLE_CONTENT=True 需安裝 beautifulsoup4。
"""
import os
import asyncio
import csv
import time
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional, Set, Tuple
from urllib.parse import quote

import httpx
from dotenv import load_dotenv

# 載入 .env（若存在）供 os.getenv 使用
load_dotenv()

# BeautifulSoup 僅在抓內文時使用
try:
    from bs4 import BeautifulSoup
    HAS_BS4 = True
except ImportError:
    HAS_BS4 = False

# ────────── 你可調的參數 ──────────
STOCK_IDS = ["2330", "2317", "2454", "2881", "2408", "2615"]

# 個股代號 → 標籤名稱（與 cmnews 標籤頁一致，例如 萬海(2615)、富邦金(2881)）
STOCK_ID_TO_TAG: Dict[str, str] = {
    "2330": "台積電(2330)",
    "2317": "鴻海(2317)",
    "2454": "聯發科(2454)",
    "2881": "富邦金(2881)",
    "2408": "南亞科(2408)",
    "2615": "萬海(2615)",
}

MAX_PAGES = 10000
FETCH_ARTICLE_CONTENT = True  # 是否進入每篇抓完整內文（會較慢）

# 速度/穩定性
RETRIES = 5
TIMEOUT = 25
ARTICLE_TIMEOUT = 45
LIST_SLEEP_MS = 300
ARTICLE_SLEEP_MS = 500
BATCH_WRITE_SIZE = 50
PROGRESS_EVERY = 50
CONCURRENT_ARTICLES = 2  # 同時抓幾篇內文（1=逐篇，2~3 可加速，過大易 429）
RESUME_FROM_CSV = True  # True=若 CSV 已存在則讀取既有 ID、用 append 接寫並略過已抓過的

# 日期範圍（台灣時間）
DATE_START = None
DATE_END = None
STOP_ON_TOO_OLD = False
STOP_ON_TOO_NEW = False

# 其他
DEBUG_DIR = Path("debug_pages")
PAGE_ERR_LOG = DEBUG_DIR / "page_errors.log"
TIME_LOG: List[str] = []

# ────────── cmnews 列表 API ──────────
BASE_LIST_URL = "https://cmnews.com.tw/tag"
LIST_API_URL = "https://cmnews.com.tw/api/investment/api/Article/Search/Tags"
LIST_FETCH_SIZE = 10
LIST_METHOD = "POST"
LIST_CURSOR_PARAM = "startCursor"
ORDER_TYPE = "updatedAt"
FILTERS = ["aiAuthor"]

# CSV 欄位（含內文）
NEWS_CSV_HEADERS = ["新聞 ID", "標題", "發布時間", "來源", "標籤", "連結", "內文"]

TZ_TW = timezone(timedelta(hours=8))


def fmt_mmss(sec: float) -> str:
    m, s = divmod(int(sec), 60)
    return f"{m} 分 {s} 秒"


def to_iso_tw(ms_or_iso) -> str:
    if ms_or_iso is None:
        return ""
    try:
        if isinstance(ms_or_iso, (int, float)):
            sec = ms_or_iso / 1000 if ms_or_iso > 10_000_000_000 else ms_or_iso
            return datetime.fromtimestamp(sec, tz=TZ_TW).strftime("%Y-%m-%d %H:%M:%S")
        s = str(ms_or_iso)
        if s.isdigit():
            v = float(s)
            sec = v / 1000 if v > 10_000_000_000 else v
            return datetime.fromtimestamp(sec, tz=TZ_TW).strftime("%Y-%m-%d %H:%M:%S")
        return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ_TW).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return ""


def to_epoch_seconds(ms_or_iso) -> Optional[int]:
    try:
        if ms_or_iso is None:
            return None
        if isinstance(ms_or_iso, (int, float)):
            sec = ms_or_iso / 1000 if ms_or_iso > 10_000_000_000 else ms_or_iso
            return int(sec)
        s = str(ms_or_iso)
        if s.isdigit():
            v = float(s)
            sec = v / 1000 if v > 10_000_000_000 else v
            return int(sec)
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return None


def parse_date_boundary(val: Optional[str], *, is_end: bool) -> Optional[int]:
    if not val:
        return None
    s = val if len(val) > 10 else (val + (" 23:59:59" if is_end else " 00:00:00"))
    return int(datetime.fromisoformat(s).replace(tzinfo=TZ_TW).timestamp())


def log_err(stock: str, msg: str) -> None:
    DEBUG_DIR.mkdir(exist_ok=True)
    ts = datetime.now(TZ_TW).strftime("%Y-%m-%d %H:%M:%S")
    with PAGE_ERR_LOG.open("a", encoding="utf-8") as f:
        f.write(f"[{ts}] [{stock}] {msg}\n")


def tag_page_url(tag: str) -> str:
    return f"{BASE_LIST_URL}/{quote(tag, safe='()')}"


def headers_for_cmnews(tag: str) -> Dict[str, str]:
    h: Dict[str, str] = {
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "zh-TW,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        "Origin": "https://cmnews.com.tw",
        "Referer": tag_page_url(tag) + "/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139 Safari/537.36",
    }
    tok = os.getenv("CMONEY_TOKEN", "").strip()
    if tok:
        if not tok.lower().startswith("bearer "):
            tok = "Bearer " + tok
        h["Authorization"] = tok
    return h


def article_url(author_id: str, article_id: str) -> str:
    return f"https://cmnews.com.tw/article/{author_id}-{article_id}"


def row_from_list_item(item: dict, content: str = "") -> List[Any]:
    """從列表 API 一筆（summaryArticles 元素）組出 CSV 一列；content 為階段二填入的內文。"""
    aid = item.get("articleId") or ""
    title = (item.get("title") or "").strip()
    created = to_iso_tw(item.get("createdAt") or item.get("updatedAt"))
    author_id = (item.get("authorId") or "").strip()
    tags_list = item.get("tags") or []
    stock_tags = item.get("stockTags") or []
    tags_str = ",".join([str(t) for t in (tags_list + stock_tags) if t])
    url = article_url(author_id, aid) if author_id and aid else ""
    return [aid, title, created, author_id, tags_str, url, content]


async def fetch_list_page(
    client: httpx.AsyncClient,
    tag: str,
    start_cursor: Optional[str] = None,
) -> Tuple[List[dict], Optional[str], bool, int]:
    """
    呼叫 cmnews Tags API：POST，URL 帶 ?fetch=10，body 為 tags 陣列、orderType、（有需要才帶 filters）、startCursor。
    回傳 (summaryArticles, next_cursor, has_next_page, status)。
    """
    params = {"fetch": LIST_FETCH_SIZE}
    payload: Dict[str, Any] = {
        "tags": [tag],
        "orderType": ORDER_TYPE,
    }
    # FILTERS 為空時完全不傳 filters，行為更接近官網預設
    if FILTERS:
        payload["filters"] = FILTERS
    if start_cursor:
        payload[LIST_CURSOR_PARAM] = start_cursor
    status = 0
    for attempt in range(1, RETRIES + 1):
        try:
            r = await client.post(
                LIST_API_URL,
                params=params,
                json=payload,
                timeout=TIMEOUT,
            )
            status = r.status_code
            if status == 429:
                ra = r.headers.get("Retry-After")
                wait = int(ra) if (ra and ra.isdigit()) else (2 * attempt)
                log_err(tag, f"429 startCursor retry_after={wait}")
                await asyncio.sleep(wait)
                continue
            if status // 100 != 2:
                try:
                    body = (r.text or "")[:500].replace("\n", " ")
                except Exception:
                    body = ""
                log_err(tag, f"HTTP {status} body={body}")
                await asyncio.sleep(0.35 * attempt)
                continue
            data = r.json()
            items = data.get("summaryArticles") if isinstance(data, dict) else []
            if not isinstance(items, list):
                items = []
            page_info = data.get("pageInfo") if isinstance(data, dict) else {}
            next_cursor = page_info.get("endCursor") if isinstance(page_info, dict) else None
            has_next = bool(page_info.get("hasNextPage")) if isinstance(page_info, dict) else False
            return items, next_cursor, has_next, status
        except Exception as e:
            log_err(tag, f"list_req_error startCursor err={e}")
            await asyncio.sleep(0.35 * attempt)
    return [], None, False, status


def parse_article_content_from_html(html: str) -> str:
    """從文章頁 HTML 抽出內文區塊，回傳純文字。"""
    if not HAS_BS4:
        return ""
    try:
        soup = BeautifulSoup(html, "html.parser")
        # 常見內文容器
        for selector in ["article", "[class*='article-body']", "[class*='content']", "[class*='post-body']", ".prose", "main"]:
            el = soup.select_one(selector)
            if el:
                text = el.get_text(separator="\n", strip=True)
                if len(text) > 100:
                    return text
        #  fallback: 取 body 內主要段落
        body = soup.find("body")
        if body:
            p = body.get_text(separator="\n", strip=True)
            if len(p) > 80:
                return p
        return ""
    except Exception:
        return ""


async def fetch_article_content(
    client: httpx.AsyncClient,
    url: str,
    stock_label: str,
) -> str:
    """GET 文章頁並解析內文，失敗回傳空字串或「取得失敗」。"""
    if not url:
        return ""
    for attempt in range(1, RETRIES + 1):
        try:
            r = await client.get(url, timeout=ARTICLE_TIMEOUT)
            if r.status_code // 100 != 2:
                log_err(stock_label, f"article HTTP {r.status_code} url={url[:80]}")
                await asyncio.sleep(0.3 * attempt)
                continue
            text = parse_article_content_from_html(r.text or "")
            return text if text else "(無內文)"
        except Exception as e:
            err_msg = f"{type(e).__name__}: {e!r}" if e else type(e).__name__
            log_err(stock_label, f"article_error url={url[:80]} err={err_msg}")
            await asyncio.sleep(0.3 * attempt)
    return "取得失敗"


def _load_existing_article_ids(csv_path: Path) -> Set[str]:
    """若 RESUME_FROM_CSV，讀取已存在 CSV 的新聞 ID（第一欄）。"""
    ids: Set[str] = set()
    if not csv_path.exists():
        return ids
    try:
        with csv_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            next(reader, None)
            for row in reader:
                if row:
                    ids.add(str(row[0]).strip())
    except Exception:
        pass
    return ids


async def crawl_stock_news(stock_id: str, tag: str, max_pages: int) -> None:
    t0 = time.perf_counter()
    out_csv = Path(f"{stock_id}_news.csv")

    ts_start = parse_date_boundary(DATE_START, is_end=False)
    ts_end = parse_date_boundary(DATE_END, is_end=True)
    if ts_start and ts_end and ts_start > ts_end:
        raise ValueError("DATE_START 不能晚於 DATE_END")

    seen_ids: Set[str] = set()
    if RESUME_FROM_CSV and out_csv.exists():
        seen_ids = _load_existing_article_ids(out_csv)
        if seen_ids:
            print(f"[{stock_id}] 續抓模式：已存在 {len(seen_ids)} 筆，將略過並接續寫入")

    append_mode = RESUME_FROM_CSV and out_csv.exists()
    csv_file = out_csv.open("a" if append_mode else "w", encoding="utf-8-sig", newline="")
    w = csv.writer(csv_file)
    if not append_mode:
        w.writerow(NEWS_CSV_HEADERS)

    total_written = 0
    hard_stop = False
    next_cursor: Optional[str] = None
    page_count = 0
    row_buf: List[List[Any]] = []
    article_sem = asyncio.Semaphore(CONCURRENT_ARTICLES)

    async def fetch_one_content(client: httpx.AsyncClient, item: dict, aid: str) -> str:
        """僅用 HTML 方式抓內文，已移除 xlab 內文 API。"""
        async with article_sem:
            url = article_url(item.get("authorId") or "", aid)
            c = await fetch_article_content(client, url, stock_id)
            if ARTICLE_SLEEP_MS > 0:
                await asyncio.sleep(ARTICLE_SLEEP_MS / 1000.0)
            return c

    limits = httpx.Limits(max_connections=8, max_keepalive_connections=6, keepalive_expiry=30)
    async with httpx.AsyncClient(
        headers=headers_for_cmnews(tag),
        follow_redirects=True,
        limits=limits,
    ) as client:
        while page_count < max_pages:
            items, next_cursor, has_next, status = await fetch_list_page(
                client, tag, start_cursor=next_cursor
            )

            if status in (401, 403):
                print(f"[{stock_id}] 401/403：若需登入請設定環境變數 CMONEY_TOKEN")
                break
            if not items:
                break

            to_fetch: List[dict] = []
            for item in items:
                aid = item.get("articleId") or ""
                if aid in seen_ids:
                    continue
                seen_ids.add(aid)
                ct_raw = item.get("createdAt") or item.get("updatedAt")
                ct_sec = to_epoch_seconds(ct_raw)
                too_old = ts_start is not None and ct_sec is not None and ct_sec < ts_start
                too_new = ts_end is not None and ct_sec is not None and ct_sec > ts_end
                if too_old and STOP_ON_TOO_OLD:
                    hard_stop = True
                if too_new and STOP_ON_TOO_NEW:
                    hard_stop = True
                if too_old or too_new:
                    continue
                to_fetch.append(item)

            if FETCH_ARTICLE_CONTENT and to_fetch:
                tasks = [fetch_one_content(client, item, item.get("articleId") or "") for item in to_fetch]
                contents = await asyncio.gather(*tasks, return_exceptions=True)
                for item, c in zip(to_fetch, contents):
                    content = c if isinstance(c, str) else "取得失敗"
                    row = row_from_list_item(item, content)
                    row_buf.append(row)
                    total_written += 1
                    if len(row_buf) >= BATCH_WRITE_SIZE:
                        w.writerows(row_buf)
                        row_buf.clear()
                        csv_file.flush()
            else:
                for item in to_fetch:
                    row = row_from_list_item(item, "")
                    row_buf.append(row)
                    total_written += 1
                    if len(row_buf) >= BATCH_WRITE_SIZE:
                        w.writerows(row_buf)
                        row_buf.clear()
                        csv_file.flush()

            if row_buf:
                w.writerows(row_buf)
                row_buf.clear()
                csv_file.flush()
            if PROGRESS_EVERY and total_written and total_written % PROGRESS_EVERY == 0:
                print(
                    f"[{stock_id}] 已寫入 {total_written}，耗時 {fmt_mmss(time.perf_counter() - t0)}",
                    flush=True,
                )

            page_count += 1
            print(f"[{stock_id}] page={page_count} 本頁 {len(items)} 筆，累計 {total_written}", flush=True)

            if hard_stop or not has_next or not next_cursor:
                break
            if LIST_SLEEP_MS > 0:
                await asyncio.sleep(LIST_SLEEP_MS / 1000.0)

    if row_buf:
        w.writerows(row_buf)
        csv_file.flush()
    csv_file.close()

    # 抓完後依「發布時間」欄位重新排序（新到舊），方便後續閱讀與分析
    try:
        rows: List[List[str]] = []
        with out_csv.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.reader(f)
            rows = list(reader)
        if len(rows) > 1:
            header, data = rows[0], rows[1:]

            def _key(row: List[str]) -> int:
                # 第 3 欄為發布時間字串，轉成 epoch 做排序；解析失敗放最舊
                ts = to_epoch_seconds(row[2]) if len(row) > 2 else None
                return ts if ts is not None else -1

            data.sort(key=_key, reverse=True)  # 新到舊
            with out_csv.open("w", encoding="utf-8-sig", newline="") as f:
                writer = csv.writer(f)
                writer.writerow(header)
                writer.writerows(data)
    except Exception as e:
        log_err(stock_id, f"sort_csv_error err={e}")

    TIME_LOG.append(f"\n[{stock_id}] 共寫入 {total_written}，耗時 {fmt_mmss(time.perf_counter() - t0)}")


async def main() -> None:
    if FETCH_ARTICLE_CONTENT and not HAS_BS4:
        print("FETCH_ARTICLE_CONTENT=True 需安裝 beautifulsoup4：pip install beautifulsoup4")
    tasks = []
    for sid in STOCK_IDS:
        tag = STOCK_ID_TO_TAG.get(sid)
        if not tag:
            print(f"略過 {sid}：STOCK_ID_TO_TAG 無對應標籤")
            continue
        tasks.append(crawl_stock_news(sid, tag, MAX_PAGES))
    await asyncio.gather(*tasks)


if __name__ == "__main__":
    asyncio.run(main())
    print("\n".join(TIME_LOG))
