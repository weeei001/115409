"""
twse_crawler.py — 台股歷史日資料爬取與入庫 (MySQL 版)
=====================================================
資料來源：台灣證券交易所 TWSE
API：https://www.twse.com.tw/exchangeReport/STOCK_DAY

用法：
  python twse_crawler.py                      # 使用程式內建股票清單 (互動式)
  python twse_crawler.py --stocks 2330,2317   # 指定股票代號（逗號分隔）
  python twse_crawler.py --csv stocks.csv     # 從 CSV 讀取
  python twse_crawler.py --batch              # 批次排程模式 (不詢問任何輸入)

MySQL 連線設定（下方 DB_CONFIG 常數或用環境變數覆蓋）：
  host=localhost  port=3306  db=topic_stock
"""

import argparse
import csv
import logging
import os
import random
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional
import sys

import pymysql
import pymysql.cursors
import urllib3
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# 關閉 SSL 驗證不通過產生的 InsecureRequestWarning 警告
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─────────────────────────────────────────────
# 全域常數
# ─────────────────────────────────────────────
TZ_TAIPEI = timezone(timedelta(hours=8))   # UTC+8，台灣無夏令時
API_URL   = "https://www.twse.com.tw/exchangeReport/STOCK_DAY"

# 載入 backend/.env，讓爬蟲與 API 服務共用同一份設定
load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _get_env(*keys: str, default: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value is not None and value != "":
            return value
    return default

# ── MySQL 連線設定 ─────────────────────────────
# 優先讀取 DATABASE_*，並向下相容舊版 DB_*
DB_CONFIG: dict = {
    "host": _get_env("DATABASE_HOST", "DB_HOST", default="localhost"),
    "port": int(_get_env("DATABASE_PORT", "DB_PORT", default="3306")),
    "user": _get_env("DATABASE_USER", "DB_USER", default="root"),
    "password": _get_env("DATABASE_PASSWORD", "DB_PASS", default=""),
    "db": _get_env("DATABASE_NAME", "DB_NAME", default="topic_stock"),
    "charset": "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "autocommit": False,
}

DEFAULT_STOCKS = [
    s.strip()
    for s in _get_env("CRAWLER_DEFAULT_STOCKS", default="2330,2317,2454,2881,2408,2615").split(",")
    if s.strip()
]
DEFAULT_YEARS = int(_get_env("CRAWLER_DEFAULT_YEARS", default="5"))

# HTTP headers — 模擬瀏覽器，避免被擋
HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.twse.com.tw/",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

MAX_RETRY      = 5       # API 最大重試次數
BACKOFF_FACTOR = 0.8     # urllib3 退避係數
SLEEP_MIN      = 0.2     # 每次請求後最短 sleep（秒）
SLEEP_MAX      = 0.5     # 每次請求後最長 sleep（秒）

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


def configure_console_output() -> None:
    """Avoid crashing when console encoding cannot represent some characters (e.g. emoji on cp950)."""
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            # Some environments may not support reconfigure; keep default behavior.
            pass


# ─────────────────────────────────────────────
# 資料庫初始化
# ─────────────────────────────────────────────
def init_db() -> pymysql.connections.Connection:
    conn = pymysql.connect(**DB_CONFIG)
    with conn.cursor() as cur:
        # 每日價格表（僅一張，無外鍵）
        cur.execute("""
            CREATE TABLE IF NOT EXISTS daily_prices (
                date          DATE         NOT NULL,
                symbol        VARCHAR(10)  NOT NULL,
                open          DECIMAL(10,2),
                high          DECIMAL(10,2),
                low           DECIMAL(10,2),
                close         DECIMAL(10,2),
                volume_shares BIGINT       UNSIGNED,   -- 成交量（股）
                amount        BIGINT       UNSIGNED,   -- 成交金額（元）
                `change`      DECIMAL(10,2),           -- 漲跌價差
                trades        INT          UNSIGNED,   -- 成交筆數
                PRIMARY KEY (date, symbol),
                INDEX idx_symbol (symbol),
                INDEX idx_date   (date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)
        # 斷點續抓 checkpoint 表
        cur.execute("""
            CREATE TABLE IF NOT EXISTS crawl_checkpoint (
                symbol  VARCHAR(10) NOT NULL,
                yyyymm  CHAR(6)     NOT NULL,
                PRIMARY KEY (symbol, yyyymm)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)
    conn.commit()
    return conn


# ─────────────────────────────────────────────
# Checkpoint 機制
# ─────────────────────────────────────────────
def is_done(conn: pymysql.connections.Connection, symbol: str, yyyymm: str) -> bool:
    """回傳 True 代表此 (symbol, yyyymm) 已完成，不須重抓。
       如果是「當前月份」，為了排程每天能抓到最新的日資料，永遠回傳 False"""
    now = datetime.now(tz=TZ_TAIPEI)
    current_yyyymm = f"{now.year}{now.month:02d}"
    
    # 排程抓取時，當月從未「完成」，必須天天抓
    if yyyymm == current_yyyymm:
        return False

    with conn.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM crawl_checkpoint WHERE symbol=%s AND yyyymm=%s",
            (symbol, yyyymm),
        )
        return cur.fetchone() is not None


def mark_done(conn: pymysql.connections.Connection, symbol: str, yyyymm: str) -> None:
    """將 (symbol, yyyymm) 標記為已完成。當前月份不標記。"""
    now = datetime.now(tz=TZ_TAIPEI)
    current_yyyymm = f"{now.year}{now.month:02d}"
    
    if yyyymm == current_yyyymm:
        # 當前月份隨時都有新資料，不要將其標記為已完成 (Checkpoint)
        return

    with conn.cursor() as cur:
        cur.execute(
            "INSERT IGNORE INTO crawl_checkpoint(symbol, yyyymm) VALUES(%s, %s)",
            (symbol, yyyymm),
        )
    conn.commit()


# ─────────────────────────────────────────────
# HTTP Session（帶連線層重試）
# ─────────────────────────────────────────────
def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=MAX_RETRY,
        backoff_factor=BACKOFF_FACTOR,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://",  adapter)
    session.headers.update(HEADERS)
    return session


# ─────────────────────────────────────────────
# TWSE API 呼叫
# ─────────────────────────────────────────────
def fetch_month(
    session: requests.Session,
    symbol: str,
    year: int,
    month: int,
    timeout: int = 20,
    verify: bool = False,
) -> Optional[dict]:
    params = {
        "response": "json",
        "date":     f"{year}{month:02d}01",
        "stockNo":  symbol,
    }
    for attempt in range(1, MAX_RETRY + 1):
        try:
            resp = session.get(API_URL, params=params, timeout=timeout, verify=verify)
            if resp.status_code == 200:
                data = resp.json()
                stat = data.get("stat", "")
                if stat.startswith("很抱歉") or stat == "查詢日期大於可查詢最大日期":
                    log.debug("%s %04d-%02d 無資料（stat=%s）", symbol, year, month, stat)
                    return None
                if "data" not in data or "fields" not in data:
                    log.warning("%s %04d-%02d 回傳格式異常：%s", symbol, year, month, data)
                    return None
                return data
            elif resp.status_code == 429:
                wait = 2 ** attempt
                log.warning("429 Too Many Requests，等待 %ds（第 %d 次）", wait, attempt)
                time.sleep(wait)
            else:
                log.warning("HTTP %d，第 %d/%d 次", resp.status_code, attempt, MAX_RETRY)
                time.sleep(1.5 * attempt)
        except requests.exceptions.Timeout:
            log.warning("Timeout，第 %d/%d 次 (%s %04d-%02d)", attempt, MAX_RETRY, symbol, year, month)
            time.sleep(1.5 * attempt)
        except requests.exceptions.RequestException as exc:
            log.warning("RequestException: %s，第 %d/%d 次", exc, attempt, MAX_RETRY)
            time.sleep(1.5 * attempt)

    log.error("放棄 %s %04d-%02d（已重試 %d 次）", symbol, year, month, MAX_RETRY)
    return None


# ─────────────────────────────────────────────
# 資料清洗
# ─────────────────────────────────────────────
def clean_number(raw: str) -> Optional[str]:
    s = raw.strip().replace(",", "")
    return None if s in ("--", "-", "", "N/A") else s


def roc_to_ad(roc_date: str) -> str:
    parts = roc_date.strip().split("/")
    if len(parts) != 3:
        raise ValueError(f"無法解析民國日期：{roc_date!r}")
    year_ad = int(parts[0]) + 1911
    return f"{year_ad}-{int(parts[1]):02d}-{int(parts[2]):02d}"


def parse_row(fields: list[str], row: list[str]) -> Optional[dict]:
    if len(fields) != len(row):
        return None

    raw: dict[str, str] = dict(zip(fields, row))
    out: dict = {}

    date_field = next((k for k in raw if "日期" in k), None)
    if date_field is None:
        return None
    try:
        out["date"] = roc_to_ad(raw[date_field])
    except ValueError as exc:
        log.debug("日期解析失敗：%s", exc)
        return None

    numeric_cfg: dict[str, tuple[str, type]] = {
        "成交股數": ("volume_shares", int),
        "成交金額": ("amount",        int),
        "開盤價":   ("open",          float),
        "最高價":   ("high",          float),
        "最低價":   ("low",           float),
        "收盤價":   ("close",         float),
        "漲跌價差": ("change",        float),
        "成交筆數": ("trades",        int),
    }
    for zh_key, (col, cast) in numeric_cfg.items():
        matched = next((k for k in raw if zh_key in k), None)
        if matched is None:
            out[col] = None
            continue
        cleaned = clean_number(raw[matched])
        if cleaned is None:
            out[col] = None
        else:
            try:
                out[col] = cast(cleaned)
            except (ValueError, TypeError):
                out[col] = None

    return out


# ─────────────────────────────────────────────
# 入庫（MySQL）
# ─────────────────────────────────────────────
def upsert_prices(
    conn: pymysql.connections.Connection,
    symbol: str,
    rows: list[dict],
) -> int:
    sql = """
        REPLACE INTO daily_prices
            (date, symbol, open, high, low, close,
             volume_shares, amount, `change`, trades)
        VALUES
            (%(date)s, %(symbol)s, %(open)s, %(high)s, %(low)s, %(close)s,
             %(volume_shares)s, %(amount)s, %(change)s, %(trades)s)
    """
    data = [{**r, "symbol": symbol} for r in rows]
    with conn.cursor() as cur:
        cur.executemany(sql, data)
    conn.commit()
    return len(data)


# ─────────────────────────────────────────────
# 月份迭代器
# ─────────────────────────────────────────────
def iter_months(start_year: int, start_month: int, end_year: int, end_month: int):
    y, m = start_year, start_month
    while (y, m) <= (end_year, end_month):
        yield y, m
        m += 1
        if m > 12:
            m, y = 1, y + 1


# ─────────────────────────────────────────────
# 主爬取流程
# ─────────────────────────────────────────────
def crawl_stock(
    conn: pymysql.connections.Connection,
    session: requests.Session,
    symbol: str,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    verify: bool = False,
) -> int:
    total_written = 0
    months = list(iter_months(start_year, start_month, end_year, end_month))

    for i, (year, month) in enumerate(months, 1):
        yyyymm = f"{year}{month:02d}"

        if is_done(conn, symbol, yyyymm):
            print(f"  [{symbol}] {year}-{month:02d}  ⏭  已完成，略過")
            continue

        print(f"  [{symbol}] {year}-{month:02d}  ({i}/{len(months)})  抓取中...", end="", flush=True)
        raw = fetch_month(session, symbol, year, month, verify=verify)

        if raw is None:
            print("  ✗ 無資料或失敗")
            mark_done(conn, symbol, yyyymm)
            time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))
            continue

        parsed: list[dict] = [
            r for r in (parse_row(raw["fields"], row) for row in raw["data"]) if r
        ]

        if parsed:
            written = upsert_prices(conn, symbol, parsed)
            total_written += written
            print(f"  ✓ 寫入 {written} 筆（共 {len(raw['data'])} 列原始）")
        else:
            print("  ✓ 解析後無有效資料")

        mark_done(conn, symbol, yyyymm)
        time.sleep(random.uniform(SLEEP_MIN, SLEEP_MAX))

    return total_written


def load_stocks_from_csv(csv_path: str) -> list[str]:
    result: list[str] = []
    with open(csv_path, newline="", encoding="utf-8-sig") as f:
        rows = list(csv.reader(f))
    if not rows:
        return result

    first = [c.strip().lower() for c in rows[0]]
    has_header = any(h in first for h in ("symbol", "代號", "股票代號"))
    for row in (rows[1:] if has_header else rows):
        if row and row[0].strip():
            result.append(row[0].strip())
    return result


def print_summary(conn: pymysql.connections.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*), MIN(date), MAX(date) FROM daily_prices")
        row = cur.fetchone()
    total    = row["COUNT(*)"]
    min_date = row["MIN(date)"]
    max_date = row["MAX(date)"]
    print("\n" + "═" * 50)
    print(f"  ✅ 完成！daily_prices 共 {total:,} 筆")
    if min_date:
        print(f"  📅 日期範圍：{min_date} ～ {max_date}")
    print("═" * 50)


# ─────────────────────────────────────────────
# 入口
# ─────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description="TWSE 台股歷史日資料爬取工具 (MySQL)")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--stocks", type=str, help="股票代號，逗號分隔，例如 2330,2317")
    group.add_argument("--csv",    type=str, help="stocks.csv 路徑")
    parser.add_argument("--years", type=int, default=DEFAULT_YEARS, help="往回抓取年數（預設值可由 CRAWLER_DEFAULT_YEARS 控制）")
    parser.add_argument("--start", type=str, help="開始月份 (YYYYMM)，例如 202401")
    parser.add_argument("--end",   type=str, help="結束月份 (YYYYMM)，例如 202412")
    parser.add_argument("--batch", action="store_true", help="批次排程模式，不詢問任何輸入 (跳過 input)")
    configure_console_output()
    
    # MySQL 連線覆蓋
    parser.add_argument("--host",     default=DB_CONFIG["host"])
    parser.add_argument("--port",     type=int, default=DB_CONFIG["port"])
    parser.add_argument("--user",     default=DB_CONFIG["user"])
    parser.add_argument("--password", default=DB_CONFIG["password"])
    parser.add_argument("--dbname",   default=DB_CONFIG["db"])
    parser.add_argument("--no-verify", action="store_false", dest="verify", help="跳過 SSL 憑證驗證")
    parser.add_argument("--clean",     action="store_true", help="清除所有斷點記錄，重新抓取")
    parser.set_defaults(verify=False)
    args = parser.parse_args()

    # 套用命令列覆蓋到 DB_CONFIG
    DB_CONFIG.update({
        "host": args.host, "port": args.port,
        "user": args.user, "password": args.password,
        "db":   args.dbname,
    })

    # ── 決定股票清單 ──────────────────────────
    if args.csv:
        symbols = load_stocks_from_csv(args.csv)
        if not symbols:
            print("CSV 無有效資料，中止。")
            return
    elif args.stocks:
        symbols = [s.strip() for s in args.stocks.split(",") if s.strip()]
    elif args.batch:
        # 在批次模式下，直接使用預設股票不清單，不詢問使用者
        symbols = DEFAULT_STOCKS
    else:
        # 互動式輸入
        user_input_stocks = input(f"請輸入股票代號（多檔請用逗號隔開，直接按 Enter 使用預設 {DEFAULT_STOCKS}）: ").strip()
        if user_input_stocks:
            symbols = [s.strip() for s in user_input_stocks.split(",") if s.strip()]
        else:
            symbols = DEFAULT_STOCKS

    # ── 計算日期範圍 ──────────────────────────
    today = datetime.now(tz=TZ_TAIPEI).date()
    
    start_year, start_month = today.year - args.years, today.month
    end_year, end_month = today.year, today.month

    if args.start:
        try:
            s = args.start.strip().replace("-", "")
            start_year, start_month = int(s[:4]), int(s[4:6])
        except Exception:
            print(f"警告：開始日期格式錯誤 {args.start}，將採預設值。")
    
    if args.end:
        try:
            e = args.end.strip().replace("-", "")
            end_year, end_month = int(e[:4]), int(e[4:6])
        except Exception:
            print(f"警告：結束日期格式錯誤 {args.end}，將採預設值。")

    # 若完全沒帶參數，且不是在批次模式下，進入互動詢問
    if not any([args.stocks, args.csv, args.start, args.end]) and args.years == DEFAULT_YEARS and not args.batch:
        print("\n📅 抓取時間設定 (直接按 Enter 採預設值):")
        u_start = input(f"  開始月份 (YYYYMM, 預設 {start_year}{start_month:02d}): ").strip()
        if u_start and len(u_start) >= 6:
            try:
                start_year, start_month = int(u_start[:4]), int(u_start[4:6])
            except: pass
            
        u_end = input(f"  結束月份 (YYYYMM, 預設 {end_year}{end_month:02d}): ").strip()
        if u_end and len(u_end) >= 6:
            try:
                end_year, end_month = int(u_end[:4]), int(u_end[4:6])
            except: pass

    print("📡 TWSE 歷史日資料爬取 (MySQL)")
    print(f"   MySQL   ：{DB_CONFIG['user']}@{DB_CONFIG['host']}:{DB_CONFIG['port']}/{DB_CONFIG['db']}")
    print(f"   股票清單：{symbols}")
    print(f"   抓取範圍：{start_year}-{start_month:02d} ～ {end_year}-{end_month:02d}")
    print()

    conn    = init_db()
    
    if args.clean:
        print("🧹 正在清除斷點記錄 (crawl_checkpoint)...")
        with conn.cursor() as cur:
            cur.execute("TRUNCATE TABLE crawl_checkpoint")
        conn.commit()

    session = build_session()
    grand_total = 0

    for symbol in symbols:
        print(f"\n{'─' * 50}")
        print(f"▶ 股票 {symbol}")
        written = crawl_stock(
            conn, session, symbol,
            start_year, start_month,
            end_year, end_month,
            verify=args.verify,
        )
        print(f"  [{symbol}] 本次寫入 {written:,} 筆")
        grand_total += written

    print_summary(conn)
    conn.close()

if __name__ == "__main__":
    main()
