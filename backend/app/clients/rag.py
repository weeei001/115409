"""Retained HTTP compatibility adapter; active features use internal retrieval."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

import httpx
from pydantic import BaseModel, Field, ValidationError


class RagResponse(BaseModel):
    news_sources: list[dict[str, Any]] = Field(default_factory=list)
    fallback_mode: bool = False


@dataclass
class RagResult:
    news_sources: list[dict[str, Any]] = field(default_factory=list)
    fallback_mode: bool = False
    status: str = "available"
    reason: str | None = None


def _parse_timestamp(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def _to_naive_taipei(timestamp: datetime) -> datetime:
    if timestamp.tzinfo is not None:
        return timestamp.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
    return timestamp


def _is_on_or_before_as_of(timestamp: datetime, as_of: date) -> bool:
    return _to_naive_taipei(timestamp) <= datetime.combine(as_of, time.max)


class RagClient:
    def __init__(self, http: httpx.AsyncClient, settings: Any):
        self.http = http
        self.settings = settings

    async def collect(self, *, symbol: str, lookback_days: int = 60,
                      max_events: int = 50, as_of: date | None = None,
                      enforce_window: bool = False) -> RagResult:
        if not self.settings.RAG_API_URL:
            return RagResult(fallback_mode=True, status="unavailable", reason="disabled")
        payload: dict[str, Any] = {"symbols": [symbol], "lookback_days": lookback_days}
        if as_of is not None:
            payload["as_of"] = f"{as_of.isoformat()} 23:59:59"
        headers = ({"Authorization": f"Bearer {self.settings.RAG_API_KEY}"}
                   if self.settings.RAG_API_KEY else {})
        try:
            response = await self.http.post(self.settings.RAG_API_URL, json=payload,
                                           headers=headers, timeout=self.settings.RAG_API_TIMEOUT)
            response.raise_for_status()
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("RAG response must be an object")
            raw_items = data.get("news_sources") or data.get("results") or data.get("items") or []
            # An explicitly malformed list must not silently become an empty success.
            for key in ("news_sources", "results", "items"):
                if key in data and not isinstance(data[key], list):
                    raise ValueError("RAG sources must be a list")
            if not any(key in data for key in ("news_sources", "results", "items")):
                raise ValueError("RAG response is missing sources")
            invalid_items = any(not isinstance(item, dict) for item in raw_items)
            parsed = RagResponse.model_validate({"news_sources": [item for item in raw_items if isinstance(item, dict)],
                                                "fallback_mode": data.get("fallback_mode", False)})
        except httpx.TimeoutException:
            return RagResult(fallback_mode=True, status="unavailable", reason="timeout")
        except httpx.HTTPError:
            return RagResult(fallback_mode=True, status="unavailable", reason="upstream_error")
        except (ValueError, ValidationError):
            return RagResult(fallback_mode=True, status="unavailable", reason="invalid_response")

        cutoff = as_of or date.today()
        earliest = cutoff - timedelta(days=lookback_days)
        candidates = []
        invalid = invalid_items
        for source in parsed.news_sources:
            ts = _parse_timestamp(source.get("timestamp") or source.get("publish_time") or source.get("date"))
            title = str(source.get("title") or "").strip()
            if ts is None or not title:
                invalid = True
                continue
            if not _is_on_or_before_as_of(ts, cutoff):
                continue
            if enforce_window and _to_naive_taipei(ts).date() < earliest:
                continue
            candidates.append((ts, title, source))
        candidates.sort(key=lambda entry: _to_naive_taipei(entry[0]), reverse=True)
        kept, seen = [], set()
        for timestamp, title, source in candidates:
            item_id = str(source.get("article_id") or source.get("id") or "").strip()
            url = source.get("url")
            url = url.strip() if isinstance(url, str) and url.strip() else None
            key = item_id or url or f"{title}:{timestamp.isoformat()}"
            if key in seen:
                continue
            seen.add(key)
            publisher = source.get("publisher")
            kind = source.get("kind")
            kept.append({"id": item_id, "title": title,
                         "summary": str(source.get("summary") or source.get("content") or "").strip(),
                         "timestamp": timestamp.isoformat(), "url": url,
                         "publisher": publisher.strip() if isinstance(publisher, str) and publisher.strip() else None,
                         "kind": kind if isinstance(kind, str) and kind in {"general", "guidance", "market"} else "general"})
            if len(kept) >= max_events:
                break
        degraded = parsed.fallback_mode or invalid
        return RagResult(kept, degraded, "degraded" if degraded else "available",
                         "invalid_items" if invalid else "upstream_fallback" if parsed.fallback_mode else None)
