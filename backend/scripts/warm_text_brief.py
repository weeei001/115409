"""排程用：資料齊了之後，把各檔的 text-brief 先產生好放進快取。

基準日取 daily_prices 該檔的最新交易日，跟個股頁送的 as_of_date 一致；
force_refresh=False，所以同一組 symbol＋基準日只會真的跑一次 LLM，重跑不花錢。
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from crud.daily_price import get_date_range_for_symbol
from database import SessionLocal
from schemas.stock_behavior import StockBehaviorTextBriefRequest
from stock_behavior.orchestrator import StockBehaviorOrchestrator


async def warm(db, symbols: list[str]) -> int:
    orchestrator = StockBehaviorOrchestrator(db=db, settings=get_settings())
    failed = 0
    for symbol in symbols:
        date_range = get_date_range_for_symbol(db, symbol)
        if date_range is None:
            print(f"symbol={symbol} result=skipped reason=no_price_data")
            failed += 1
            continue
        as_of = date_range[1]
        try:
            response = await orchestrator.generate_text_brief(
                StockBehaviorTextBriefRequest(symbol=symbol, as_of_date=as_of)
            )
            print(
                f"symbol={symbol} as_of={as_of} result={response.status} cached={response.cached}"
            )
        except Exception as exc:  # 一檔失敗不影響其他檔
            db.rollback()
            failed += 1
            print(f"symbol={symbol} as_of={as_of} result=failed error={exc}")
    return failed


def main() -> None:
    parser = argparse.ArgumentParser(description="Warm text-brief cache for scheduler.")
    parser.add_argument("--symbols", required=True, help="逗號分隔的股票代號，例如 2330,2317")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    if not symbols:
        raise SystemExit("--symbols 至少要有一檔")

    db = SessionLocal()
    try:
        failed = asyncio.run(warm(db, symbols))
    finally:
        db.close()
    if failed:
        raise SystemExit(f"{failed}/{len(symbols)} 檔未產生")


if __name__ == "__main__":
    main()
