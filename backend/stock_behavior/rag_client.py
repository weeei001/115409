from __future__ import annotations

from datetime import date, datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError


class RagResponse(BaseModel):
    news_sources: list[dict[str, Any]] = Field(default_factory=list)
    fallback_mode: bool = False
    raw_answer: str = ""


def _build_reference_materials(
    *,
    fallback_mode: bool,
    raw_answer: str,
    news_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "rag_api_response": {
            "usage": "reference_only",
            "fallback_mode": fallback_mode,
            "raw_answer": raw_answer,
            "news_sources": news_sources,
        },
    }


def _build_rag_news_payload(
    *,
    news_sources: list[dict[str, Any]],
    fallback_mode: bool,
    raw_answer: str,
) -> dict[str, Any]:
    return {
        "news_sources": news_sources,
        "fallback_mode": fallback_mode,
        "raw_answer": raw_answer,
        "raw_answer_usage": "reference_only",
        "reference_materials": _build_reference_materials(
            fallback_mode=fallback_mode,
            raw_answer=raw_answer,
            news_sources=news_sources,
        ),
    }


def _fallback_rag_news_payload() -> dict[str, Any]:
    return _build_rag_news_payload(news_sources=[], fallback_mode=True, raw_answer="")


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    text = value.strip()
    if not text:
        return None
    normalized = text.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _parse_news_source_items(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw_items = data.get("news_sources") or data.get("results") or data.get("items") or []
    if not isinstance(raw_items, list):
        return []

    parsed_items: list[dict[str, Any]] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            continue
        ts = _parse_timestamp(raw_item.get("timestamp") or raw_item.get("publish_time") or raw_item.get("date"))
        if ts is None:
            continue
        title = str(raw_item.get("title") or "").strip()
        if not title:
            continue
        source_id = str(raw_item.get("id") or "").strip()
        summary = str(raw_item.get("summary") or raw_item.get("content") or "").strip()
        url_value = raw_item.get("url")
        parsed_items.append(
            {
                "id": source_id,
                "title": title,
                "summary": summary,
                "timestamp": ts,
                "url": str(url_value).strip() if isinstance(url_value, str) and url_value.strip() else None,
            }
        )
    return parsed_items


async def fetch_rag_news(
    *,
    rag_api_url: str,
    rag_api_key: str,
    symbol: str,
    as_of_date: date,
    lookback_days: int,
    max_events: int,
    timeout_seconds: int,
) -> dict[str, Any]:
    if not rag_api_url:
        return _fallback_rag_news_payload()

    headers: dict[str, str] = {}
    if rag_api_key:
        headers["Authorization"] = f"Bearer {rag_api_key}"

    payload = {"symbols": [symbol]}

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(rag_api_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        parsed = RagResponse.model_validate(
            {
                "news_sources": _parse_news_source_items(data),
                "fallback_mode": bool(data.get("fallback_mode", False)),
                "raw_answer": str(data.get("raw_answer") or ""),
            }
        )
    except (httpx.HTTPError, ValidationError, ValueError):
        return _fallback_rag_news_payload()

    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in parsed.news_sources:
        timestamp = item.get("timestamp")
        if not isinstance(timestamp, datetime):
            continue

        item_id = str(item.get("id") or "").strip()
        item_url = item.get("url")
        item_title = str(item.get("title") or "").strip()
        item_summary = str(item.get("summary") or "").strip()

        dedupe_key = item_id or item_url or f"{item_title}:{timestamp.isoformat()}"
        if dedupe_key in seen_keys:
            continue
        seen_keys.add(dedupe_key)
        deduped.append(
            {
                "id": item_id,
                "title": item_title,
                "summary": item_summary,
                "timestamp": timestamp.isoformat(),
                "url": item_url,
            }
        )
        if len(deduped) >= max_events:
            break

    return _build_rag_news_payload(
        news_sources=deduped,
        fallback_mode=parsed.fallback_mode,
        raw_answer=parsed.raw_answer,
    )
