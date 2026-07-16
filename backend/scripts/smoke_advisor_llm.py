from __future__ import annotations

import argparse
import asyncio
from pathlib import Path
import sys
from time import perf_counter


BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from config import get_settings
from stock_behavior.llm import StockBehaviorLlmService
from stock_behavior.utils import detect_simplified_chinese


def build_task_packet(symbol: str) -> dict:
    return {
        "task": {
            "type": "stock_behavior_evidence_projection",
            "symbol": symbol,
            "as_of_date": "2026-07-15",
            "horizon_days": 40,
            "recent_lookback_days": 5,
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
            "count": 1,
            "data": [{"date": "2026-07-15", "foreign_net": 1200000}],
        },
        "technical_window": {
            "count": 1,
            "data": [{"date": "2026-07-15", "ma5": 1078, "rsi14": 58.2}],
        },
        "data_inventory": {
            "price_volume": [
                {"id": "pv_01", "field": "close", "date": "2026-07-15", "value": 1095}
            ],
            "chip": [
                {
                    "id": "chip_01",
                    "field": "foreign_net",
                    "date": "2026-07-15",
                    "value": 1200000,
                }
            ],
            "technical": [
                {"id": "tech_01", "field": "rsi14", "date": "2026-07-15", "value": 58.2}
            ],
            "news": [],
            "missing_fields": [],
        },
    }


async def run(symbol: str) -> None:
    service = StockBehaviorLlmService(get_settings())
    started_at = perf_counter()
    parsed, raw_text, meta = await service.generate_analysis_from_evidence(
        task_packet=build_task_packet(symbol)
    )
    latency_ms = round((perf_counter() - started_at) * 1000)

    print(f"model={service.model_name}")
    print(f"finish_reason={meta['finish_reason']}")
    print(f"truncated={meta['truncated']}")
    print(f"parsed_top_level_keys={sorted(parsed)}")
    print(f"simplified_chinese={detect_simplified_chinese(raw_text)}")
    print(f"latency_ms={latency_ms}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test the advisor LLM")
    parser.add_argument("--symbol", default="2330")
    args = parser.parse_args()
    asyncio.run(run(args.symbol.strip().upper()))


if __name__ == "__main__":
    main()
