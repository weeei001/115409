from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys
from time import perf_counter

from pydantic import ValidationError


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from schemas.stock_behavior import StockBehaviorTextBrief
from stock_behavior.compliance import scan_compliance
from stock_behavior.llm import StockBehaviorLlmService
from stock_behavior.utils import detect_simplified_chinese


def build_task_packet(symbol: str) -> dict:
    return {
        "task": {
            "type": "stock_behavior_text_brief",
            "symbol": symbol,
            "as_of_date": "2026-07-15",
            "horizon_days": 40,
            "recent_lookback_days": 20,
            "analysis_language": "zh-TW",
        },
        "price_window": {
            "count": 2,
            "data": [
                {"date": "2026-07-14", "close": 1080, "volume_shares": 30000000},
                {"date": "2026-07-15", "close": 1095, "volume_shares": 32000000},
            ],
        },
        "chip_window": {
            "count": 2,
            "data": [
                {"date": "2026-07-14", "foreign_net": -800000},
                {"date": "2026-07-15", "foreign_net": 1200000},
            ],
        },
        "technical_window": {
            "count": 1,
            "data": [
                {
                    "date": "2026-07-15",
                    "ma20": 1078,
                    "volume_ma5": 31000000,
                    "macd_hist": 1.2,
                    "rsi5": 58.2,
                }
            ],
        },
        "rag_news": {"news_sources": [], "fallback_mode": False},
        "data_inventory": {
            "price_volume": [
                {"id": "pv_01", "field": "close", "date": "2026-07-15", "value": 1095},
                {
                    "id": "pv_02",
                    "field": "volume_shares",
                    "date": "2026-07-15",
                    "value": 32000000,
                },
                {
                    "id": "pv_03",
                    "field": "volume_ma5",
                    "date": "2026-07-15",
                    "value": 31000000,
                },
            ],
            "chip": [
                {
                    "id": "ch_01",
                    "field": "foreign_net",
                    "date": "2026-07-15",
                    "value": 1200000,
                }
            ],
            "technical": [
                {"id": "tc_01", "field": "ma20", "date": "2026-07-15", "value": 1078},
                {
                    "id": "tc_02",
                    "field": "macd_histogram",
                    "date": "2026-07-15",
                    "value": 1.2,
                },
            ],
            "news": [],
            "missing_fields": ["foreign_net 近 10 日累計"],
        },
    }


async def run(symbol: str, dump_raw: str | None = None) -> None:
    service = StockBehaviorLlmService(get_settings())
    started_at = perf_counter()
    parsed, raw_text, meta = await service.generate_text_brief_from_evidence(
        task_packet=build_task_packet(symbol)
    )
    latency_ms = round((perf_counter() - started_at) * 1000)

    if dump_raw:
        Path(dump_raw).write_text(raw_text, encoding="utf-8")

    status = "unavailable"
    horizons: list[str] = []
    validation_error = ""
    if parsed and not meta["truncated"]:
        try:
            brief = StockBehaviorTextBrief.model_validate(parsed)
            horizons = [view.horizon for view in brief.forward_views]
            status = "verified"
        except ValidationError as exc:
            validation_error = str(exc)

    print(f"model={service.model_name}")
    print(f"finish_reason={meta['finish_reason']}")
    print(f"truncated={meta['truncated']}")
    print(f"status={status}")
    print(f"forward_views={horizons}")
    print(f"simplified_chinese={detect_simplified_chinese(raw_text)}")
    print(f"compliance_violations={scan_compliance(raw_text)}")
    print(f"validation_error={validation_error}")
    print(f"latency_ms={latency_ms}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test the text brief LLM")
    parser.add_argument("--symbol", default="2330")
    parser.add_argument("--dump-raw", default=None, help="將原始回覆寫入 UTF-8 檔案")
    args = parser.parse_args()
    asyncio.run(run(args.symbol.strip().upper(), dump_raw=args.dump_raw))


if __name__ == "__main__":
    main()
