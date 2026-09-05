"""排程用：資料齊了之後，把各檔的 text-brief 先產生好放進快取。

預設基準日取 daily_prices 該檔的最新交易日，跟個股頁送的 as_of_date 一致；
給 --start/--end 則逐個交易日回補（歷史回填用，證據與新聞都是 as-of 時點）。
force_refresh=False，所以同一組 symbol＋基準日只會真的跑一次 LLM，重跑不花錢。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import date
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from crud.daily_price import get_date_range_for_symbol
from database import SessionLocal
from models.daily_price import DailyPrice
from schemas.stock_behavior import StockBehaviorTextBriefRequest
from stock_behavior.orchestrator import StockBehaviorOrchestrator


def as_of_dates(db, symbol: str, start: date | None, end: date | None) -> list[date]:
    """回填模式取區間內的交易日，否則只取最新交易日。"""
    if start is None and end is None:
        date_range = get_date_range_for_symbol(db, symbol)
        return [date_range[1]] if date_range else []
    query = db.query(DailyPrice.date).filter(DailyPrice.symbol == symbol)
    if start is not None:
        query = query.filter(DailyPrice.date >= start)
    if end is not None:
        query = query.filter(DailyPrice.date <= end)
    return [row[0] for row in query.distinct().order_by(DailyPrice.date).all()]


async def warm(db, symbols: list[str], start: date | None, end: date | None) -> tuple[int, int]:
    orchestrator = StockBehaviorOrchestrator(db=db, settings=get_settings())
    failed = 0
    total = 0
    for symbol in symbols:
        dates = as_of_dates(db, symbol, start, end)
        if not dates:
            total += 1
            failed += 1
            print(f"symbol={symbol} result=skipped reason=no_price_data", flush=True)
            continue
        for as_of in dates:
            total += 1
            try:
                response = await orchestrator.generate_text_brief(
                    StockBehaviorTextBriefRequest(symbol=symbol, as_of_date=as_of)
                )
                print(
                    f"symbol={symbol} as_of={as_of} result={response.status} cached={response.cached}",
                    flush=True,
                )
            except Exception as exc:  # 一檔失敗不影響其他檔
                db.rollback()
                failed += 1
                print(f"symbol={symbol} as_of={as_of} result=failed error={exc}", flush=True)
    return failed, total


def main() -> None:
    parser = argparse.ArgumentParser(description="Warm text-brief cache for scheduler.")
    parser.add_argument("--symbols", required=True, help="逗號分隔的股票代號，例如 2330,2317")
    parser.add_argument("--start", type=date.fromisoformat, help="回填起日 YYYY-MM-DD")
    parser.add_argument("--end", type=date.fromisoformat, help="回填迄日 YYYY-MM-DD")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        raise SystemExit("--symbols 至少要有一檔")

    db = SessionLocal()
    try:
        failed, total = asyncio.run(warm(db, symbols, args.start, args.end))
    finally:
        db.close()
    if failed:
        raise SystemExit(f"{failed}/{total} 筆未產生")


if __name__ == "__main__":
    main()
