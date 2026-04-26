from __future__ import annotations

import asyncio
import logging
import time
from datetime import date, datetime, timedelta
from typing import Any

from agent.data_fetcher import fetch_news
from agent.schemas import NormalizedNewsChunk, ParsedIntent
from config import get_settings

logger = logging.getLogger(__name__)

_LOOKBACK_DAYS = 30
# Temporary switch: disable RAG/news integration for advisor path only.
_ADVISOR_RAG_ENABLED = True


class NewsContextService:
    """Fetch advisor news / RAG context without blocking overview."""

    def __init__(self, *, timeout_sec: float | None = None) -> None:
        settings = get_settings()
        default_timeout = float(settings.RAG_API_TIMEOUT or 10)
        self._timeout_sec = max(1.0, float(timeout_sec if timeout_sec is not None else default_timeout))

    @staticmethod
    def _build_intent(symbol: str, as_of_date: date, core_decision: dict[str, Any]) -> ParsedIntent:
        trend = str(core_decision.get("trend_conclusion") or "")
        confidence = str(core_decision.get("confidence_level") or "")
        reason_points = [str(item) for item in (core_decision.get("reason_points") or [])][:3]
        query = (
            f"Analyze TW stock {symbol}. "
            f"Core decision={trend}, confidence={confidence}, reasons={reason_points}."
        )
        return ParsedIntent(
            symbols=[symbol],
            date_start=as_of_date - timedelta(days=_LOOKBACK_DAYS),
            date_end=as_of_date,
            original_query=query,
        )

    @staticmethod
    def _news_preview(news_chunks: list[NormalizedNewsChunk]) -> list[dict[str, Any]]:
        return [
            {
                "id": item.id,
                "title": item.title,
                "timestamp": item.timestamp.isoformat() if item.timestamp else "",
                "url": item.url,
            }
            for item in news_chunks[:5]
        ]

    @staticmethod
    def _source_items(news_chunks: list[NormalizedNewsChunk]) -> list[dict[str, Any]]:
        return [
            {
                "id": item.id,
                "title": item.title,
                "summary": item.content,
                "timestamp": item.timestamp.isoformat() if item.timestamp else "",
                "url": item.url,
            }
            for item in news_chunks
        ]

    async def build_context(
        self,
        *,
        symbol: str,
        as_of_date: date,
        core_decision: dict[str, Any],
    ) -> dict[str, Any]:
        started_at = time.perf_counter()
        if not _ADVISOR_RAG_ENABLED:
            ready_ms = round((time.perf_counter() - started_at) * 1000, 1)
            return {
                "count": 0,
                "fallback_mode": True,
                "preview": [],
                "source_items": [],
                "rag_summary": "",
                "ready_ms": ready_ms,
                "as_of_date": as_of_date.isoformat(),
                "symbol": symbol,
            }

        intent = self._build_intent(symbol, as_of_date, core_decision)
        try:
            news_chunks, rag_summary, fallback_mode = await asyncio.wait_for(
                fetch_news(intent),
                timeout=self._timeout_sec,
            )
        except Exception:
            logger.warning("advisor news context failed symbol=%s", symbol, exc_info=True)
            news_chunks, rag_summary, fallback_mode = [], "", True

        ready_ms = round((time.perf_counter() - started_at) * 1000, 1)
        return {
            "count": len(news_chunks),
            "fallback_mode": bool(fallback_mode),
            "preview": self._news_preview(news_chunks),
            "source_items": self._source_items(news_chunks),
            "rag_summary": rag_summary or "",
            "ready_ms": ready_ms,
            "as_of_date": as_of_date.isoformat(),
            "symbol": symbol,
        }

    @staticmethod
    def to_news_chunks(payload: dict[str, Any]) -> list[NormalizedNewsChunk]:
        out: list[NormalizedNewsChunk] = []
        for item in (payload.get("source_items") or [])[:10]:
            timestamp_raw = item.get("timestamp")
            timestamp = None
            if isinstance(timestamp_raw, str) and timestamp_raw:
                try:
                    timestamp = datetime.fromisoformat(timestamp_raw.replace("Z", "+00:00"))
                except ValueError:
                    timestamp = None
            out.append(
                NormalizedNewsChunk(
                    id=str(item.get("id") or ""),
                    title=str(item.get("title") or ""),
                    content=str(item.get("summary") or ""),
                    timestamp=timestamp or datetime.utcnow(),
                    url=item.get("url") or None,
                )
            )
        return out
