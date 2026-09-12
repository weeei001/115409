from __future__ import annotations

from datetime import date, datetime, time, timedelta
from typing import Any

import httpx

from app.clients.rag import RagResult
from app.core.errors import AppError, NotFound
from .common import STOCK_OPTIONS, TAIPEI, article_identity, get_source_name, parse_timestamp, source_provenance
from .schemas import NewsSource, QuestionSearchResult, RetrievalRequest, RetrievalResponse


_MARKET_NOISE = (
    "盤中速報", "集中市場加權指數", "櫃買指數", "加權指數",
    "台股開盤", "台股收盤", "台股盤前", "台股盤中", "台股早盤",
)
_QUOTE_NOISE = ("盤中速報", "盤後速報", "盤中零股", "零股速報")
_MARKET_CONTEXT = (
    "台股", "大盤", "加權指數", "櫃買", "集中市場", "外資",
    "美股", "道瓊", "那斯達克", "標普", "費城半導體", "費半", "日股", "陸股",
    "聯準會", "Fed", "FOMC", "升息", "降息", "利率", "通膨", "CPI",
    "關稅", "川普", "貿易戰", "出口管制", "地緣", "匯率", "新台幣", "國安基金",
)


def _time_bound(value: str | None, field: str) -> datetime | None:
    if not value:
        return None
    parsed = parse_timestamp(value)
    if parsed is None:
        raise AppError(f"{field} 格式錯誤，請用 YYYY-MM-DD 或 YYYY-MM-DD HH:MM:SS")
    return parsed


def _within_window(hit: dict, start: datetime | None, end: datetime) -> bool:
    timestamp = parse_timestamp((hit.get("payload") or {}).get("pub_time"))
    return timestamp is not None and timestamp <= end and (start is None or timestamp >= start)


class RetrievalService:
    def __init__(self, http: httpx.AsyncClient, settings: Any, vector=None):
        if vector is None:
            from app.clients.vector import VectorClient
            vector = VectorClient(http, settings)
        self.vector = vector

    async def _query(self, vector: list[float], *, symbols: list[str] | None,
                     start: datetime | None, end: datetime, limit: int) -> list[dict]:
        hits = await self.vector.query(vector, symbols=symbols, start=start, end=end, limit=limit)
        # The payload is independently checked even when the vector store applies a timestamp filter.
        return [hit for hit in hits if _within_window(hit, start, end)]

    async def analyze(self, req: RetrievalRequest) -> RetrievalResponse:
        symbols = list(dict.fromkeys(symbol for symbol in req.symbols if symbol in STOCK_OPTIONS))
        if not symbols:
            raise AppError(f"無效的股票代號，支援：{list(STOCK_OPTIONS.keys())}")
        end = _time_bound(req.as_of, "as_of") or datetime.now(TAIPEI)
        days = max(1, min(req.lookback_days, 120))
        max_events = max(1, min(req.max_events, 50))
        start, fallback_start = end - timedelta(days=days), end - timedelta(days=days * 2)
        fetch_limit = max(40, max_events * 4)
        self.vector.require_enabled()
        names = "、".join(STOCK_OPTIONS[symbol] for symbol in symbols)
        stock_tokens = tuple(STOCK_OPTIONS[symbol] for symbol in symbols) + tuple(symbols)
        vectors = {
            "general": await self.vector.embed_query(f"{names} 近期表現 營收 股價 財報"),
            "guidance": await self.vector.embed_query(f"{names} 法說會 財測 展望 財務預測 毛利率目標 資本支出 上修 下修"),
            "market": await self.vector.embed_query(
                "台股大盤走勢 加權指數漲跌原因 外資買賣超 美股 費城半導體指數 "
                "聯準會利率 關稅 政策 匯率 國際情勢 系統性風險"),
        }
        grouped: list[tuple[str, list[dict], int]] = []
        no_recent_news = False
        for symbol in symbols:
            general = await self._query(vectors["general"], symbols=[symbol], start=start, end=end, limit=fetch_limit)
            if not general:
                no_recent_news = True
                general = await self._query(vectors["general"], symbols=[symbol], start=fallback_start, end=end, limit=fetch_limit)
            grouped.append(("general", general, max_events))
            grouped.append(("guidance", await self._query(
                vectors["guidance"], symbols=[symbol], start=start, end=end, limit=fetch_limit),
                max(2, max_events // 2)))
        grouped.append(("market", await self._query(
            vectors["market"], symbols=["tw_stock"], start=start, end=end, limit=fetch_limit),
            max(3, max_events // 3)))
        picked: dict[str, NewsSource] = {}
        for kind, hits, cap in grouped:
            count = 0
            seen = set()
            for hit in hits:
                if count >= cap:
                    break
                payload = hit.get("payload") or {}
                title, content = str(payload.get("title") or ""), str(payload.get("page_content") or "")
                text = f"{title}\n{content}"
                if kind == "market":
                    if any(word in title for word in _QUOTE_NOISE) or not any(word in text for word in _MARKET_CONTEXT):
                        continue
                elif any(word in title for word in _MARKET_NOISE) and not any(token in text for token in stock_tokens):
                    continue
                if not title.strip():
                    continue
                key = article_identity(payload)
                if key in seen:
                    continue
                seen.add(key)
                count += 1
                if key in picked and kind != "guidance":
                    continue
                picked[key] = NewsSource(
                    id=str(payload.get("chunk_id") or hit.get("id") or ""), title=title, summary=content,
                    timestamp=str(payload["pub_time"]),
                    url=str(payload.get("url") or ""), publisher=get_source_name(payload.get("source")), kind=kind,
                    **source_provenance(payload))
        return RetrievalResponse(news_sources=list(picked.values()), no_recent_news=no_recent_news or not picked)

    async def collect(self, *, symbol: str, lookback_days: int = 60, max_events: int = 50,
                      as_of: date | None = None, enforce_window: bool = False) -> RagResult:
        cutoff = as_of or datetime.now(TAIPEI).date()
        try:
            response = await self.analyze(RetrievalRequest(symbols=[symbol], lookback_days=lookback_days, max_events=max_events,
                as_of=datetime.combine(cutoff, time.max, TAIPEI).isoformat() if as_of else None))
        except AppError as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {}
            reason = "timeout" if exc.status_code == 504 else detail.get("code", "upstream_error")
            return RagResult(fallback_mode=True, status="unavailable", reason=reason)
        sources, seen = [], set()
        earliest = cutoff - timedelta(days=lookback_days)
        for source in sorted(response.news_sources, key=lambda item: parse_timestamp(item.timestamp), reverse=True):
            timestamp = parse_timestamp(source.timestamp)
            if enforce_window and timestamp.date() < earliest:
                continue
            key = source.id or source.url or f"{source.title}:{source.timestamp}"
            if key in seen:
                continue
            seen.add(key)
            item = source.model_dump()
            item.update(timestamp=timestamp.replace(tzinfo=None).isoformat(), url=source.url or None,
                        publisher=source.publisher or None)
            sources.append(item)
            if len(sources) >= max_events:
                break
        return RagResult(sources, response.no_recent_news, "degraded" if response.no_recent_news else "available",
                         "no_recent_news" if response.no_recent_news else None)

    async def search_question(self, query: str, symbols: list[str], time_from: str | None = None,
                              time_to: str | None = None) -> QuestionSearchResult:
        start = _time_bound(time_from, "time_from")
        requested_end = _time_bound(time_to, "time_to")
        end = requested_end or datetime.now(TAIPEI)
        start = start or end - timedelta(days=30)
        if start and start > end:
            raise AppError("time_from 不得晚於 time_to")
        self.vector.require_enabled()
        vector = await self.vector.embed_query(query)
        days = (end - start).days if start else 0
        base_limit = 10 if days <= 30 else 15 if days <= 90 else 20 if days <= 365 else 25
        groups = list(dict.fromkeys(symbols)) or [None]
        per_group = max(5, base_limit // len(groups)) if len(groups) > 1 else base_limit
        hits: list[dict] = []
        seen_chunks: set[str] = set()
        article_counts: dict[str, int] = {}
        for symbol in groups:
            stock_filter = [symbol] if symbol else None
            recent = await self._query(vector, symbols=stock_filter, start=start, end=end,
                                       limit=per_group * 4)

            def select(candidates: list[dict], budget: int, *, in_range: bool) -> list[dict]:
                selected = []
                for hit in sorted(candidates, key=lambda item: float(item.get("score") or 0), reverse=True):
                    if len(selected) >= budget:
                        break
                    payload = hit.get("payload") or {}
                    key = str(payload.get("chunk_id") or hit.get("id") or "")
                    article = article_identity(payload)
                    if key in seen_chunks or article_counts.get(article, 0) >= 2:
                        continue
                    seen_chunks.add(key)
                    article_counts[article] = article_counts.get(article, 0) + 1
                    selected.append({**hit, "_in_time_range": in_range})
                return selected

            selected = select(recent, per_group, in_range=True)
            hits.extend(selected)
        if not hits:
            raise NotFound("未找到相關新聞：指定時間範圍內沒有可用資料，未使用更早的新聞補足。")
        return QuestionSearchResult(hits=hits,
            time_from=start.replace(tzinfo=None).isoformat(sep=" ") if start else None,
            time_to=end.replace(tzinfo=None).isoformat(sep=" "),
            fallback_mode=False)
