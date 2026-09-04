from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Callable

import httpx
from pydantic import BaseModel, Field, ValidationError

from stock_behavior.utils import PolicyViolationError


FieldConverter = Callable[[Any], Any]
FieldSpec = tuple[str, str, FieldConverter]


@dataclass(frozen=True)
class ToolPolicy:
    max_tool_calls_per_request: int = 10
    max_lookback_days_recent_analysis: int = 120
    max_news_events: int = 50
    allowed_symbols: tuple[str, ...] = ("2317", "2330", "2408", "2454", "2615", "2881")


POLICY = ToolPolicy()


def _optional_float(value: Any) -> float | None:
    return float(value) if value is not None else None


def _optional_int(value: Any) -> int | None:
    return int(value) if value is not None else None


def _zero_default_int(value: Any) -> int:
    return int(value or 0)


PRICE_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("open", "open", _optional_float),
    ("high", "high", _optional_float),
    ("low", "low", _optional_float),
    ("close", "close", _optional_float),
    ("volume_shares", "volume_shares", _optional_int),
    ("amount", "amount", _optional_int),
    ("change", "change", _optional_float),
)

CHIP_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("foreign_buy", "foreign_buy", _zero_default_int),
    ("foreign_sell", "foreign_sell", _zero_default_int),
    ("foreign_net", "foreign_net", _zero_default_int),
    ("investment_trust_buy", "investment_trust_buy", _zero_default_int),
    ("investment_trust_sell", "investment_trust_sell", _zero_default_int),
    ("investment_trust_net", "investment_trust_net", _zero_default_int),
    ("dealer_buy", "dealer_buy", _zero_default_int),
    ("dealer_sell", "dealer_sell", _zero_default_int),
    ("dealer_net", "dealer_net", _zero_default_int),
    ("total_institutional_buy", "total_institutional_buy", _zero_default_int),
    ("total_institutional_sell", "total_institutional_sell", _zero_default_int),
    ("total_institutional_net", "total_institutional_net", _zero_default_int),
)

TECHNICAL_FIELD_SPECS: tuple[FieldSpec, ...] = (
    ("close", "close", _optional_float),
    ("ma5", "ma5", _optional_float),
    ("ma10", "ma10", _optional_float),
    ("ma20", "ma20", _optional_float),
    ("ma60", "ma60", _optional_float),
    ("ma120", "ma120", _optional_float),
    ("ma240", "ma240", _optional_float),
    ("rsi5", "rsi5", _optional_float),
    ("rsi10", "rsi10", _optional_float),
    ("rsv9", "rsv9", _optional_float),
    ("kd_k9", "kd_k9", _optional_float),
    ("kd_d9", "kd_d9", _optional_float),
    ("kd_j9", "kd_j9", _optional_float),
    ("ema12", "ema12", _optional_float),
    ("ema26", "ema26", _optional_float),
    ("macd_dif", "macd_dif", _optional_float),
    ("macd_dea", "macd_dea", _optional_float),
    ("macd_signal", "macd_signal", _optional_float),
    ("macd_hist", "macd_hist", _optional_float),
    ("boll_mid20", "boll_mid20", _optional_float),
    ("boll_upper20", "boll_upper20", _optional_float),
    ("boll_lower20", "boll_lower20", _optional_float),
    ("volume_ma5", "volume_ma5", _optional_float),
)


def serialize_window_rows(
    rows: list[Any],
    *,
    field_specs: tuple[FieldSpec, ...],
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    data = [
        {
            "date": row.date.isoformat(),
            **{
                output_field: converter(getattr(row, source_field, None))
                for output_field, source_field, converter in field_specs
            },
        }
        for row in rows
    ]
    return {
        "window": f"{start_date.isoformat()}~{end_date.isoformat()}",
        "data": data,
        "count": len(data),
    }


def serialize_price_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=PRICE_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )


def serialize_chip_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=CHIP_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )


def serialize_technical_window_rows(rows: list[Any], *, start_date: date, end_date: date) -> dict[str, Any]:
    return serialize_window_rows(
        rows,
        field_specs=TECHNICAL_FIELD_SPECS,
        start_date=start_date,
        end_date=end_date,
    )


class RagResponse(BaseModel):
    news_sources: list[dict[str, Any]] = Field(default_factory=list)
    fallback_mode: bool = False


def _build_reference_materials(
    *,
    fallback_mode: bool,
    news_sources: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "rag_api_response": {
            "usage": "reference_only",
            "fallback_mode": fallback_mode,
            "news_sources": news_sources,
        },
    }


def _build_rag_news_payload(
    *,
    news_sources: list[dict[str, Any]],
    fallback_mode: bool,
) -> dict[str, Any]:
    return {
        "news_sources": news_sources,
        "fallback_mode": fallback_mode,
        "reference_materials": _build_reference_materials(
            fallback_mode=fallback_mode,
            news_sources=news_sources,
        ),
    }


def _fallback_rag_news_payload() -> dict[str, Any]:
    return _build_rag_news_payload(news_sources=[], fallback_mode=True)


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


def _to_naive_taipei(ts: datetime) -> datetime:
    """統一成台北時間的 naive datetime，讓 aware 與 naive 時間戳可以互相比較。"""
    if ts.tzinfo is not None:
        return ts.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
    return ts


def _is_on_or_before_as_of(ts: datetime, as_of: date) -> bool:
    # time.max 而非 time(23, 59, 59)：後者會把 23:59:59.5 這種帶次秒的時間戳
    # 判成「晚於 as_of」而丟掉，但它其實就落在當天。
    cutoff = datetime.combine(as_of, time.max)
    return _to_naive_taipei(ts) <= cutoff


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
        publisher_value = raw_item.get("publisher")
        # kind 由 RAG 端的三路檢索提供（/api/analyze）：guidance 為財測展望、
        # market 為大盤／總經脈絡（用來分辨整體性漲跌與個股自身事件）。
        # 舊版本或非預期值一律視為 general，簡報端會在 limitations 說明未涵蓋。
        kind = raw_item.get("kind")
        parsed_items.append(
            {
                "id": source_id,
                "title": title,
                "summary": summary,
                "timestamp": ts,
                "url": str(url_value).strip() if isinstance(url_value, str) and url_value.strip() else None,
                # 發布媒體只從 RAG metadata 帶過來；帶不到就留 None，不從 url 反推。
                "publisher": (
                    str(publisher_value).strip()
                    if isinstance(publisher_value, str) and publisher_value.strip()
                    else None
                ),
                "kind": kind if kind in {"general", "guidance", "market"} else "general",
            }
        )
    return parsed_items


async def fetch_rag_news(
    *,
    rag_api_url: str,
    rag_api_key: str,
    symbol: str,
    lookback_days: int,
    max_events: int,
    timeout_seconds: int,
    as_of: date | None = None,
) -> dict[str, Any]:
    if not rag_api_url:
        return _fallback_rag_news_payload()

    headers: dict[str, str] = {}
    if rag_api_key:
        headers["Authorization"] = f"Bearer {rag_api_key}"

    payload: dict[str, Any] = {
        "symbols": [symbol],
        "lookback_days": lookback_days,
    }
    if as_of is not None:
        payload["as_of"] = f"{as_of.isoformat()} 23:59:59"

    try:
        async with httpx.AsyncClient(timeout=timeout_seconds) as client:
            response = await client.post(rag_api_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()
        parsed = RagResponse.model_validate(
            {
                "news_sources": _parse_news_source_items(data),
                "fallback_mode": bool(data.get("fallback_mode", False)),
            }
        )
    except (httpx.HTTPError, ValidationError, ValueError):
        return _fallback_rag_news_payload()

    # 先按時間由新到舊排序再截斷：RAG 回傳順序是相關度，直接切前 N 則會留下六月舊聞、
    # 丟掉當週的盤後報導。
    ordered = sorted(
        parsed.news_sources,
        key=lambda item: (
            _to_naive_taipei(item["timestamp"])
            if isinstance(item.get("timestamp"), datetime)
            else datetime.min
        ),
        reverse=True,
    )

    deduped: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for item in ordered:
        timestamp = item.get("timestamp")
        if not isinstance(timestamp, datetime):
            continue
        if as_of is not None and not _is_on_or_before_as_of(timestamp, as_of):
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
                "publisher": item.get("publisher"),
                "kind": item.get("kind") or "general",
            }
        )
        if len(deduped) >= max_events:
            break

    return _build_rag_news_payload(
        news_sources=deduped,
        fallback_mode=parsed.fallback_mode,
    )


class ToolExecutor:
    def __init__(self, *, settings: Any) -> None:
        self._settings = settings
        self._tool_calls = 0

    def _ensure_symbol_allowed(self, symbol: str) -> None:
        if symbol not in POLICY.allowed_symbols:
            raise PolicyViolationError(f"symbol is not allowed by policy: {symbol}")

    def _consume_call(self) -> None:
        self._tool_calls += 1
        if self._tool_calls > POLICY.max_tool_calls_per_request:
            raise PolicyViolationError("tool call count exceeded policy limit")

    async def get_rag_news(
        self,
        *,
        symbol: str,
        lookback_days: int,
        max_events: int,
        as_of: date | None = None,
    ) -> dict[str, Any]:
        self._consume_call()
        self._ensure_symbol_allowed(symbol)
        if lookback_days > POLICY.max_lookback_days_recent_analysis:
            raise PolicyViolationError("news lookback exceeds policy limit")
        if max_events > POLICY.max_news_events:
            raise PolicyViolationError("max news events exceeds policy limit")

        output = await fetch_rag_news(
            rag_api_url=self._settings.RAG_API_URL,
            rag_api_key=self._settings.RAG_API_KEY,
            symbol=symbol,
            lookback_days=lookback_days,
            max_events=max_events,
            timeout_seconds=self._settings.RAG_API_TIMEOUT,
            as_of=as_of,
        )
        output["count"] = len(output.get("news_sources", []))
        return output
