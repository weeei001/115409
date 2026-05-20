from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ToolPolicy:
    max_tool_calls_per_request: int = 10
    max_lookback_days_recent_analysis: int = 120
    max_profile_chunk_months: int = 6
    max_news_events: int = 10
    allowed_symbols: tuple[str, ...] = ("2317", "2330", "2408", "2454", "2615", "2881")


POLICY = ToolPolicy()

