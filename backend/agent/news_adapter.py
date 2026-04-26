"""News adapter — fetches from external RAG API only."""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime
from typing import List, Optional, Tuple

import httpx

from agent.schemas import NormalizedNewsChunk

logger = logging.getLogger(__name__)

_MAX_CONTENT_LEN = 300


def _truncate(text: Optional[str], max_len: int = _MAX_CONTENT_LEN) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."


def _make_id(title: str, ts: str) -> str:
    return hashlib.md5(f"{title}:{ts}".encode()).hexdigest()[:12]


async def fetch_from_rag_api(
    query: str,
    symbols: list[str],
    *,
    rag_url: str,
    rag_key: str,
    timeout: int = 10,
) -> Tuple[List[NormalizedNewsChunk], str, bool]:
    """Call external RAG API. Returns (chunks, rag_summary, is_fallback).
    If RAG_API_URL is not configured, returns empty list with fallback=True.
    """
    if not rag_url:
        return [], "", True

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            payload = {
                "query": query,
                "symbols": symbols,
            }
            headers = {}
            if rag_key:
                headers["Authorization"] = f"Bearer {rag_key}"

            started_at = time.perf_counter()
            resp = await client.post(rag_url, json=payload, headers=headers)
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            print(
                "[timing.rag] symbols={symbols} elapsed_ms={elapsed_ms:.1f} status_code={status_code}".format(
                    symbols=",".join(symbols),
                    elapsed_ms=elapsed_ms,
                    status_code=resp.status_code,
                )
            )
            resp.raise_for_status()
            data = resp.json()

        rag_summary: str = data.get("raw_answer") or ""

        chunks: list[NormalizedNewsChunk] = []
        for item in (data.get("news_sources") or data.get("results") or data.get("items") or []):
            ts_raw = item.get("timestamp") or item.get("publish_time") or item.get("date") or ""
            try:
                ts = datetime.fromisoformat(str(ts_raw))
            except (ValueError, TypeError):
                ts = datetime.now()

            chunks.append(NormalizedNewsChunk(
                id=str(item.get("id") or _make_id(str(item.get("title", "")), str(ts))),
                title=str(item.get("title", "無標題")),
                content=_truncate(item.get("content") or item.get("summary") or ""),
                timestamp=ts,
                url=item.get("url") or None,
                relevance_score=float(item.get("score", 0.0)),
            ))
        return chunks[:5], rag_summary, False

    except Exception:
        if "started_at" in locals():
            elapsed_ms = (time.perf_counter() - started_at) * 1000
            print(
                "[timing.rag] symbols={symbols} elapsed_ms={elapsed_ms:.1f} status=error".format(
                    symbols=",".join(symbols),
                    elapsed_ms=elapsed_ms,
                )
            )
        logger.exception("RAG API call failed")
        return [], "", True
