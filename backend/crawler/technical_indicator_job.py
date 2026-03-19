import argparse
import logging
import sys
from datetime import date, datetime
from pathlib import Path
from time import perf_counter
from typing import Optional

from dotenv import load_dotenv

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from crud.daily_price import get_available_symbols
from crud.technical_indicator import compute_all_for_symbol, compute_latest_for_symbol
from database import Base, SessionLocal, engine

load_dotenv(BACKEND_ROOT / ".env")

logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
    level=logging.INFO,
)
log = logging.getLogger(__name__)

BACKFILL_START_DATE = date(2021, 1, 4)


def _parse_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise argparse.ArgumentTypeError("日期格式需為 YYYY-MM-DD") from exc


def run_backfill(start_date: date, end_date: Optional[date]) -> None:
    started = perf_counter()
    success_symbols = 0
    failed_symbols = 0
    total_rows = 0

    db = SessionLocal()
    try:
        symbols = get_available_symbols(db)
        if not symbols:
            log.warning("daily_prices 目前沒有任何股票資料，略過回填。")
            return

        log.info("開始全量回填：%s ~ %s", start_date, end_date or "最新可用日期")
        for idx, symbol in enumerate(symbols, start=1):
            try:
                written = compute_all_for_symbol(
                    db=db, symbol=symbol, start_date=start_date, end_date=end_date
                )
                total_rows += written
                success_symbols += 1
                log.info("[%d/%d] %s 回填完成，upsert %d 筆", idx, len(symbols), symbol, written)
            except Exception:
                failed_symbols += 1
                db.rollback()
                log.exception("[%d/%d] %s 回填失敗", idx, len(symbols), symbol)
    finally:
        db.close()

    elapsed = perf_counter() - started
    log.info(
        "回填完成：成功 %d 檔，失敗 %d 檔，總 upsert %d 筆，耗時 %.2f 秒",
        success_symbols,
        failed_symbols,
        total_rows,
        elapsed,
    )


def run_incremental(target_date: Optional[date]) -> None:
    started = perf_counter()
    success_symbols = 0
    failed_symbols = 0
    total_rows = 0

    db = SessionLocal()
    try:
        symbols = get_available_symbols(db)
        if not symbols:
            log.warning("daily_prices 目前沒有任何股票資料，略過增量計算。")
            return

        log.info("開始增量計算：target_date=%s", target_date or "各股票最新交易日")
        for idx, symbol in enumerate(symbols, start=1):
            try:
                written = compute_latest_for_symbol(db=db, symbol=symbol, target_date=target_date)
                total_rows += written
                success_symbols += 1
                log.info("[%d/%d] %s 增量完成，upsert %d 筆", idx, len(symbols), symbol, written)
            except Exception:
                failed_symbols += 1
                db.rollback()
                log.exception("[%d/%d] %s 增量失敗", idx, len(symbols), symbol)
    finally:
        db.close()

    elapsed = perf_counter() - started
    log.info(
        "增量完成：成功 %d 檔，失敗 %d 檔，總 upsert %d 筆，耗時 %.2f 秒",
        success_symbols,
        failed_symbols,
        total_rows,
        elapsed,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="技術指標批次計算工具")
    parser.add_argument(
        "--backfill",
        action="store_true",
        help="全量回填模式（預設從 2021-01-04 起）",
    )
    parser.add_argument(
        "--start-date",
        type=_parse_date,
        default=BACKFILL_START_DATE,
        help="回填開始日期，格式 YYYY-MM-DD（預設 2021-01-04）",
    )
    parser.add_argument(
        "--end-date",
        type=_parse_date,
        help="回填結束日期，格式 YYYY-MM-DD（預設為最新可用日期）",
    )
    parser.add_argument(
        "--date",
        type=_parse_date,
        help="增量模式指定日期（YYYY-MM-DD），不帶則使用各股票最新交易日",
    )
    args = parser.parse_args()

    # 確保 technical_indicators 表存在（腳本可獨立於 API 啟動流程執行）
    Base.metadata.create_all(bind=engine)

    if args.backfill:
        run_backfill(start_date=args.start_date, end_date=args.end_date)
    else:
        run_incremental(target_date=args.date)


if __name__ == "__main__":
    main()
