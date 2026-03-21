"""
institutional_trades_job.py — 三大法人買賣超（TWSE T86）單次請求入庫
================================================================
資料來源：證交所「三大法人買賣超日報」
API：https://www.twse.com.tw/rwd/zh/fund/T86（selectType=ALL，一日一請求全市場）

預設只保留六檔（可改環境變數 INSTITUTIONAL_TRADES_SYMBOLS）。
為降低被擋風險：每次執行對「單一交易日」僅發起 **一筆** GET；若需補歷史請用
--backfill，會「僅週一至週五逐日、間隔 sleep」請求，不並行、不連發多筆於同一瞬間。
自動回溯同樣略過週六、週日（不發 HTTP）。

用法：
  python institutional_trades_job.py
  python institutional_trades_job.py --date 20240320
  python institutional_trades_job.py --backfill --start-date 2024-01-02 --end-date 2024-03-20
"""

from __future__ import annotations

import argparse
import logging
import os
import random
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable, Optional

import pymysql
import pymysql.cursors
import urllib3
import requests
from dotenv import load_dotenv
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

TZ_TAIPEI = timezone(timedelta(hours=8))
API_URL = "https://www.twse.com.tw/rwd/zh/fund/T86"

load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _get_env(*keys: str, default: str) -> str:
    for key in keys:
        value = os.getenv(key)
        if value is not None and value != "":
            return value
    return default


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

DEFAULT_SYMBOLS = [
    s.strip()
    for s in _get_env(
        "INSTITUTIONAL_TRADES_SYMBOLS",
        "CRAWLER_DEFAULT_STOCKS",
        default="2330,2317,2454,2881,2408,2615",
    ).split(",")
    if s.strip()
]

HEADERS: dict[str, str] = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.twse.com.tw/",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.8",
}

MAX_RETRY = 5
BACKOFF_FACTOR = 0.8
# 單次 job 內「兩次 GET 之間」最短間隔（backfill 多日時使用）
BACKFILL_SLEEP_MIN = float(_get_env("INSTITUTIONAL_TRADES_BACKFILL_SLEEP_MIN", default="2.0"))
BACKFILL_SLEEP_MAX = float(_get_env("INSTITUTIONAL_TRADES_BACKFILL_SLEEP_MAX", default="5.0"))

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)


def configure_console_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except Exception:
            pass


def init_db(conn: pymysql.connections.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS institutional_trades (
              `date` date NOT NULL COMMENT '交易日期',
              `symbol` varchar(10) NOT NULL COMMENT '證券代號',
              `stock_name` varchar(100) DEFAULT NULL COMMENT '證券名稱',
              `foreign_excl_dealer_buy` bigint DEFAULT NULL COMMENT '外陸資買進股數(不含外資自營商)',
              `foreign_excl_dealer_sell` bigint DEFAULT NULL COMMENT '外陸資賣出股數(不含外資自營商)',
              `foreign_excl_dealer_net` bigint DEFAULT NULL COMMENT '外陸資買賣超股數(不含外資自營商)',
              `foreign_dealer_buy` bigint DEFAULT NULL COMMENT '外資自營商買進股數',
              `foreign_dealer_sell` bigint DEFAULT NULL COMMENT '外資自營商賣出股數',
              `foreign_dealer_net` bigint DEFAULT NULL COMMENT '外資自營商買賣超股數',
              `investment_trust_buy` bigint DEFAULT NULL COMMENT '投信買進股數',
              `investment_trust_sell` bigint DEFAULT NULL COMMENT '投信賣出股數',
              `investment_trust_net` bigint DEFAULT NULL COMMENT '投信買賣超股數',
              `dealer_net_total` bigint DEFAULT NULL COMMENT '自營商買賣超股數',
              `dealer_self_buy` bigint DEFAULT NULL COMMENT '自營商買進股數(自行買賣)',
              `dealer_self_sell` bigint DEFAULT NULL COMMENT '自營商賣出股數(自行買賣)',
              `dealer_self_net` bigint DEFAULT NULL COMMENT '自營商買賣超股數(自行買賣)',
              `dealer_hedge_buy` bigint DEFAULT NULL COMMENT '自營商買進股數(避險)',
              `dealer_hedge_sell` bigint DEFAULT NULL COMMENT '自營商賣出股數(避險)',
              `dealer_hedge_net` bigint DEFAULT NULL COMMENT '自營商買賣超股數(避險)',
              `total_net` bigint DEFAULT NULL COMMENT '三大法人買賣超股數',
              `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '建立時間',
              `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新時間',
              PRIMARY KEY (`date`,`symbol`),
              KEY `idx_it_date_symbol` (`date`,`symbol`),
              KEY `idx_it_date` (`date`),
              KEY `idx_it_symbol` (`symbol`)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
            """
        )
    conn.commit()


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
    session.mount("http://", adapter)
    session.headers.update(HEADERS)
    return session


def clean_int(raw: Any) -> Optional[int]:
    """TWSE JSON 有時回傳字串（含千分位）、有時回傳整數／浮點數。"""
    if raw is None:
        return None
    if isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw
    if isinstance(raw, float):
        if raw != raw:  # NaN
            return None
        try:
            return int(raw)
        except (ValueError, OverflowError):
            return None
    s = str(raw).strip().replace(",", "")
    if s in ("--", "-", "", "N/A"):
        return None
    try:
        return int(s)
    except ValueError:
        return None


def _t86_cell_str(raw: Any) -> str:
    """證券代號／名稱等欄位可能是字串或數字。"""
    if raw is None:
        return ""
    if isinstance(raw, bool):
        return ""
    if isinstance(raw, int):
        return str(raw)
    if isinstance(raw, float):
        if raw != raw:
            return ""
        if raw == int(raw):
            return str(int(raw))
        return str(raw).strip()
    return str(raw).strip()


def fetch_t86_once(
    session: requests.Session,
    trade_date: date,
    *,
    timeout: int = 30,
    verify: bool = False,
) -> Optional[dict]:
    """單一交易日、單一 GET。成功回傳 TWSE JSON dict；無資料或失敗回傳 None。"""
    date_str = trade_date.strftime("%Y%m%d")
    params = {"date": date_str, "selectType": "ALL", "response": "json"}

    for attempt in range(1, MAX_RETRY + 1):
        try:
            resp = session.get(API_URL, params=params, timeout=timeout, verify=verify)
            if resp.status_code == 200:
                data = resp.json()
                stat = data.get("stat", "")
                if stat != "OK":
                    log.debug("T86 %s stat=%s", date_str, stat)
                    return None
                if "data" not in data or "fields" not in data:
                    log.warning("T86 %s 回傳格式異常", date_str)
                    return None
                return data
            if resp.status_code == 429:
                wait = 2**attempt
                log.warning("429 Too Many Requests，等待 %ds（第 %d 次）", wait, attempt)
                time.sleep(wait)
            else:
                log.warning("HTTP %d，第 %d/%d 次", resp.status_code, attempt, MAX_RETRY)
                time.sleep(1.5 * attempt)
        except requests.exceptions.Timeout:
            log.warning("Timeout，第 %d/%d 次 (%s)", attempt, MAX_RETRY, date_str)
            time.sleep(1.5 * attempt)
        except requests.exceptions.RequestException as exc:
            log.warning("RequestException: %s，第 %d/%d 次", exc, attempt, MAX_RETRY)
            time.sleep(1.5 * attempt)

    log.error("放棄 T86 %s（已重試 %d 次）", date_str, MAX_RETRY)
    return None


def parse_t86_row(row: list[Any]) -> Optional[dict]:
    """依證交所 T86 欄位順序解析一列（不依賴中文欄位名在執行環境的編碼）。"""
    if len(row) < 19:
        return None
    symbol = _t86_cell_str(row[0])
    if not symbol:
        return None

    nums = [clean_int(row[i]) for i in range(2, 19)]

    return {
        "symbol": symbol,
        "stock_name": _t86_cell_str(row[1]) or None,
        "foreign_excl_dealer_buy": nums[0],
        "foreign_excl_dealer_sell": nums[1],
        "foreign_excl_dealer_net": nums[2],
        "foreign_dealer_buy": nums[3],
        "foreign_dealer_sell": nums[4],
        "foreign_dealer_net": nums[5],
        "investment_trust_buy": nums[6],
        "investment_trust_sell": nums[7],
        "investment_trust_net": nums[8],
        "dealer_net_total": nums[9],
        "dealer_self_buy": nums[10],
        "dealer_self_sell": nums[11],
        "dealer_self_net": nums[12],
        "dealer_hedge_buy": nums[13],
        "dealer_hedge_sell": nums[14],
        "dealer_hedge_net": nums[15],
        "total_net": nums[16],
    }


def upsert_rows(
    conn: pymysql.connections.Connection,
    trade_date: date,
    rows: list[dict],
) -> int:
    sql = """
        INSERT INTO institutional_trades (
            `date`, symbol, stock_name,
            foreign_excl_dealer_buy, foreign_excl_dealer_sell, foreign_excl_dealer_net,
            foreign_dealer_buy, foreign_dealer_sell, foreign_dealer_net,
            investment_trust_buy, investment_trust_sell, investment_trust_net,
            dealer_net_total, dealer_self_buy, dealer_self_sell, dealer_self_net,
            dealer_hedge_buy, dealer_hedge_sell, dealer_hedge_net,
            total_net
        ) VALUES (
            %(date)s, %(symbol)s, %(stock_name)s,
            %(foreign_excl_dealer_buy)s, %(foreign_excl_dealer_sell)s, %(foreign_excl_dealer_net)s,
            %(foreign_dealer_buy)s, %(foreign_dealer_sell)s, %(foreign_dealer_net)s,
            %(investment_trust_buy)s, %(investment_trust_sell)s, %(investment_trust_net)s,
            %(dealer_net_total)s, %(dealer_self_buy)s, %(dealer_self_sell)s, %(dealer_self_net)s,
            %(dealer_hedge_buy)s, %(dealer_hedge_sell)s, %(dealer_hedge_net)s,
            %(total_net)s
        )
        ON DUPLICATE KEY UPDATE
            stock_name = VALUES(stock_name),
            foreign_excl_dealer_buy = VALUES(foreign_excl_dealer_buy),
            foreign_excl_dealer_sell = VALUES(foreign_excl_dealer_sell),
            foreign_excl_dealer_net = VALUES(foreign_excl_dealer_net),
            foreign_dealer_buy = VALUES(foreign_dealer_buy),
            foreign_dealer_sell = VALUES(foreign_dealer_sell),
            foreign_dealer_net = VALUES(foreign_dealer_net),
            investment_trust_buy = VALUES(investment_trust_buy),
            investment_trust_sell = VALUES(investment_trust_sell),
            investment_trust_net = VALUES(investment_trust_net),
            dealer_net_total = VALUES(dealer_net_total),
            dealer_self_buy = VALUES(dealer_self_buy),
            dealer_self_sell = VALUES(dealer_self_sell),
            dealer_self_net = VALUES(dealer_self_net),
            dealer_hedge_buy = VALUES(dealer_hedge_buy),
            dealer_hedge_sell = VALUES(dealer_hedge_sell),
            dealer_hedge_net = VALUES(dealer_hedge_net),
            total_net = VALUES(total_net),
            updated_at = CURRENT_TIMESTAMP
    """
    d = trade_date.isoformat()
    payload = [{**r, "date": d} for r in rows]
    with conn.cursor() as cur:
        cur.executemany(sql, payload)
    conn.commit()
    return len(payload)


def filter_symbols(rows: Iterable[dict], wanted: set[str]) -> list[dict]:
    return [r for r in rows if r["symbol"] in wanted]


def extract_rows_from_t86(data: dict) -> list[dict]:
    out: list[dict] = []
    for row in data.get("data") or []:
        if not row:
            continue
        parsed = parse_t86_row(row)
        if parsed:
            out.append(parsed)
    return out


def is_weekend(d: date) -> bool:
    """週六、週日（datetime.weekday：5=六、6=日）。"""
    return d.weekday() >= 5


def daterange_inclusive_weekdays(start: date, end: date) -> Iterable[date]:
    """由小到大，僅產出週一至週五。"""
    d = start
    while d <= end:
        if not is_weekend(d):
            yield d
        d += timedelta(days=1)


def pick_latest_trading_day(
    session: requests.Session,
    *,
    start: date,
    max_lookback_days: int = 15,
    verify: bool = False,
) -> Optional[tuple[date, dict]]:
    """從 start 起往前，僅在週一至週五發 GET，最多 max_lookback_days 次請求，找到首個有資料者。"""
    d = start
    while is_weekend(d):
        d -= timedelta(days=1)

    for attempt in range(max_lookback_days):
        raw = fetch_t86_once(session, d, verify=verify)
        if raw is not None:
            return d, raw
        if attempt < max_lookback_days - 1:
            time.sleep(random.uniform(BACKFILL_SLEEP_MIN, BACKFILL_SLEEP_MAX))
        d -= timedelta(days=1)
        while is_weekend(d):
            d -= timedelta(days=1)
    return None


def parse_cli_date(s: str) -> date:
    s = s.strip().replace("-", "")
    if len(s) != 8 or not s.isdigit():
        raise ValueError(f"日期格式須為 YYYYMMDD 或 YYYY-MM-DD：{s!r}")
    return date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def main() -> None:
    parser = argparse.ArgumentParser(description="三大法人買賣超（T86）入庫 — 單日單請求")
    parser.add_argument(
        "--date",
        type=str,
        help="交易日期 YYYYMMDD（不指定則自動自今日起往前找最近有資料的交易日）",
    )
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="補歷史：區間內僅週一至週五各發 1 次 GET（略過週六日；有資料才寫入）",
    )
    parser.add_argument("--start-date", type=str, help="backfill 開始日 YYYYMMDD")
    parser.add_argument("--end-date", type=str, help="backfill 結束日 YYYYMMDD（含）")
    parser.add_argument(
        "--max-lookback-days",
        type=int,
        default=15,
        help="自動模式：僅週一至週五發請求，最多嘗試次數（預設 15）",
    )
    parser.add_argument("--no-verify", action="store_false", dest="verify", help="略過 SSL 憑證驗證（與 twse_crawler 一致）")
    parser.add_argument("--host", default=DB_CONFIG["host"])
    parser.add_argument("--port", type=int, default=DB_CONFIG["port"])
    parser.add_argument("--user", default=DB_CONFIG["user"])
    parser.add_argument("--password", default=DB_CONFIG["password"])
    parser.add_argument("--dbname", default=DB_CONFIG["db"])
    parser.set_defaults(verify=False)
    args = parser.parse_args()
    configure_console_output()

    DB_CONFIG.update(
        {
            "host": args.host,
            "port": args.port,
            "user": args.user,
            "password": args.password,
            "db": args.dbname,
        }
    )

    wanted = set(DEFAULT_SYMBOLS)
    log.info("目標股票（%d 檔）：%s", len(wanted), sorted(wanted))

    conn = pymysql.connect(**DB_CONFIG)
    try:
        init_db(conn)
    except Exception:
        conn.close()
        raise

    session = build_session()
    verify = args.verify

    try:
        if args.backfill:
            if not args.start_date or not args.end_date:
                log.error("--backfill 需同時指定 --start-date 與 --end-date")
                sys.exit(2)
            start_d = parse_cli_date(args.start_date)
            end_d = parse_cli_date(args.end_date)
            if start_d > end_d:
                log.error("start-date 不可晚於 end-date")
                sys.exit(2)

            total_upsert = 0
            for i, d in enumerate(daterange_inclusive_weekdays(start_d, end_d)):
                if i > 0:
                    time.sleep(random.uniform(BACKFILL_SLEEP_MIN, BACKFILL_SLEEP_MAX))
                raw = fetch_t86_once(session, d, verify=verify)
                if raw is None:
                    log.info("[%s] 無資料或請求失敗，略過", d.isoformat())
                    continue
                all_rows = extract_rows_from_t86(raw)
                picked = filter_symbols(all_rows, wanted)
                if len(picked) < len(wanted):
                    missing = wanted - {r["symbol"] for r in picked}
                    log.warning(
                        "[%s] 僅找到 %d/%d 檔，缺少：%s",
                        d.isoformat(),
                        len(picked),
                        len(wanted),
                        sorted(missing),
                    )
                if picked:
                    n = upsert_rows(conn, d, picked)
                    total_upsert += n
                    log.info("[%s] upsert %d 筆", d.isoformat(), n)
            log.info("backfill 完成，累計 upsert %d 筆列（可能同日多檔）", total_upsert)
            return

        if args.date:
            target = parse_cli_date(args.date)
            if is_weekend(target):
                log.error("%s 為週六或週日，證交所無此日資料，已略過請求", target.isoformat())
                sys.exit(2)
            raw = fetch_t86_once(session, target, verify=verify)
            if raw is None:
                log.error("指定日 %s 無資料或請求失敗", target.isoformat())
                sys.exit(1)
        else:
            today = datetime.now(tz=TZ_TAIPEI).date()
            found = pick_latest_trading_day(
                session,
                start=today,
                max_lookback_days=args.max_lookback_days,
                verify=verify,
            )
            if found is None:
                log.error("近 %d 次（僅週一至週五）嘗試仍找不到 T86 資料", args.max_lookback_days)
                sys.exit(1)
            target, raw = found
            log.info("自動選用交易日：%s", target.isoformat())

        all_rows = extract_rows_from_t86(raw)
        picked = filter_symbols(all_rows, wanted)
        if len(picked) < len(wanted):
            missing = wanted - {r["symbol"] for r in picked}
            log.warning("僅找到 %d/%d 檔，缺少：%s", len(picked), len(wanted), sorted(missing))
        if not picked:
            log.error("篩選後無任何目標股票資料")
            sys.exit(1)
        n = upsert_rows(conn, target, picked)
        log.info("%s upsert %d 筆", target.isoformat(), n)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
