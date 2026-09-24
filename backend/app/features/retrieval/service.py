from __future__ import annotations

import asyncio
from datetime import date, datetime, time, timedelta
from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.clients.rag import RagResult
from app.core.errors import AppError, NotFound, ServiceUnavailable
from app.db.models.news_article import NewsArticle
from app.db.models.news_impact import NewsEventAnalysis
from app.features.market.company_catalog import load_catalog
from app.features.news.impact import config_hash
from .common import STOCK_OPTIONS, TAIPEI, article_identity, get_source_name, parse_timestamp, source_provenance
from .impact_metadata import IMPACT_PAYLOAD_KEYS, current_analysis, current_chunk_ids
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
    def __init__(self, http: httpx.AsyncClient, settings: Any, vector=None, session_factory=None,
                 stock_options=None):
        if vector is None:
            from app.clients.vector import VectorClient
            vector = VectorClient(http, settings)
        self.vector = vector
        self.settings = settings
        self.session_factory = session_factory if settings and settings.NEWS_INDEX_VERSION else None
        self.catalog = load_catalog()
        if stock_options is None and self.catalog:
            stock_options = {symbol: row.get("name") for symbol, row in self.catalog.items()
                             if row.get("name")}
        self.stock_options = {**STOCK_OPTIONS, **(stock_options or {})}
        self.impact_config = config_hash(settings, self.catalog) if self.session_factory and self.catalog else None

    def _stock_descriptor(self, symbol: str) -> tuple[str, dict]:
        row = self.catalog.get(symbol) or load_catalog().get(symbol) or {}
        name = self.stock_options.get(symbol) or row.get("name")
        if not name:
            raise AppError(f"Invalid stock symbol: {symbol}")
        return str(name), row

    @staticmethod
    def _related_query(symbol: str, name: str, row: dict, relation: str) -> str:
        industry = row.get("industry_name") or row.get("industry") or ""
        aliases = " ".join(str(alias) for alias in row.get("aliases") or [])
        focus = {
            "direct": "company news earnings revenue operations guidance outlook",
            "industry_context": "industry peers demand supply chain sector news",
            "market_context": "Taiwan stock market macroeconomy interest rates exchange rates policy news",
        }[relation]
        return " ".join(part for part in (name, aliases, symbol, industry, focus) if part)

    @staticmethod
    def _relation_bonus(payload: dict, symbol: str, relation: str, row: dict) -> float:
        if payload.get("analysis_status") != "success":
            return 0.0
        industry = row.get("industry")
        if relation == "direct" and symbol in (payload.get("impact_company_ids") or []):
            return 0.15
        if relation == "industry_context" and industry in (payload.get("impact_industry_ids") or []):
            return 0.15
        if relation == "market_context" and "market" in (payload.get("impact_scopes") or []):
            return 0.15
        return 0.0

    def _select_related_hits(self, hits: list[dict], *, symbol: str, relation: str,
                             row: dict, limit: int) -> list[dict]:
        ranked = sorted(hits, key=lambda hit: float(hit.get("score") or 0) + self._relation_bonus(
            hit.get("payload") or {}, symbol, relation, row), reverse=True)
        selected, seen = [], set()
        for hit in ranked:
            payload = hit.get("payload") or {}
            if not str(payload.get("title") or "").strip():
                continue
            key = article_identity(payload)
            if key in seen:
                continue
            seen.add(key)
            selected.append(hit)
            if len(selected) >= limit:
                break
        return selected

    async def related_news(self, db: Session, *, symbol: str, relation: str = "direct",
                           lookback_days: int = 30, limit: int = 20,
                           as_of: str | None = None) -> dict:
        symbol = symbol.strip().upper()
        if relation not in {"direct", "industry_context", "market_context"}:
            raise AppError("Invalid news relation")
        name, row = self._stock_descriptor(symbol)
        end = _time_bound(as_of, "as_of") or datetime.now(TAIPEI)
        days = max(1, min(lookback_days, 120))
        limit = max(1, min(limit, 50))
        self.vector.require_enabled()
        vector = await self.vector.embed_query(self._related_query(symbol, name, row, relation))
        candidate_limit = min(200, max(40, limit * 5))
        hits = await self._query(vector, symbols=None, start=end - timedelta(days=days), end=end,
                                 limit=candidate_limit)
        hits = self._select_related_hits(hits, symbol=symbol, relation=relation, row=row,
                                         limit=candidate_limit)
        article_ids = [str((hit.get("payload") or {}).get("article_id") or "") for hit in hits]
        urls = [str((hit.get("payload") or {}).get("url") or "") for hit in hits]
        clauses = []
        if any(article_ids):
            clauses.append(NewsArticle.article_id.in_([value for value in article_ids if value]))
        if any(urls):
            clauses.append(NewsArticle.url.in_([value for value in urls if value]))
        articles = []
        if clauses:
            rows = list(db.scalars(select(NewsArticle).where(or_(*clauses))))
            by_id = {article.article_id: article for article in rows}
            by_url = {article.url: article for article in rows if article.url}
            seen_articles = set()
            for hit in hits:
                payload = hit.get("payload") or {}
                article = by_id.get(payload.get("article_id")) or by_url.get(payload.get("url"))
                if article is not None and article.article_id not in seen_articles:
                    seen_articles.add(article.article_id)
                    articles.append(article)
        from app.features.news.service import attach_event_analysis

        items = attach_event_analysis(db, articles[:limit], symbol, settings=self.settings)
        return {"page": 1, "page_size": limit, "total": len(items), "items": items}

    def _fresh_hits(self, hits: list[dict], symbols: list[str] | None) -> list[dict]:
        if not self.session_factory or not hits:
            return hits
        from app.jobs.ingestion.repository import news_chunks

        ids = {str((hit.get("payload") or {}).get("chunk_id") or "") for hit in hits} - {""}
        with self.session_factory() as db:
            chunks = {row["chunk_id"]: dict(row) for row in db.execute(select(news_chunks).where(
                news_chunks.c.chunk_id.in_(ids))).mappings()}
            article_ids = {chunk["article_id"] for chunk in chunks.values()}
            articles = {item.article_id: item for item in db.scalars(select(NewsArticle).where(
                NewsArticle.article_id.in_(article_ids)))}
            analyses = {item.article_id: item for item in db.scalars(select(NewsEventAnalysis).where(
                NewsEventAnalysis.article_id.in_(article_ids)))} if self.impact_config else {}
            valid = {article_id: current_chunk_ids(article, self.settings)
                     for article_id, article in articles.items()}
            result = []
            for hit in hits:
                payload = hit.get("payload") or {}
                chunk_id = payload.get("chunk_id")
                chunk = chunks.get(chunk_id)
                if (chunk is None or chunk_id not in valid.get(chunk["article_id"], set())
                        or payload.get("revision") != chunk["revision"]
                        or payload.get("content_hash") != chunk["content_hash"]
                        or payload.get("article_id") != chunk["article_id"]
                        or payload.get("page_content") != chunk["content_chunk"]
                        or payload.get("title") != chunk["title"]
                        or payload.get("pub_time") != chunk["pub_time"]):
                    continue
                article = articles[chunk["article_id"]]
                analysis = analyses.get(article.article_id)
                analysis_is_current = bool(self.impact_config and current_analysis(article, analysis, self.impact_config))
                metadata_is_current = (analysis_is_current
                    and payload.get("analysis_input_hash") == analysis.input_hash
                    and payload.get("analysis_config_hash") == analysis.config_hash
                    and all(key in payload for key in IMPACT_PAYLOAD_KEYS))
                if not metadata_is_current:
                    payload = {key: value for key, value in payload.items() if key not in IMPACT_PAYLOAD_KEYS}
                if symbols and analysis_is_current and not set(symbols).intersection(payload.get("impact_company_ids") or []):
                    continue
                result.append({**hit, "payload": payload})
            return result

    async def _query(self, vector: list[float], *, symbols: list[str] | None,
                     start: datetime | None, end: datetime, limit: int) -> list[dict]:
        hits = await self.vector.query(vector, symbols=symbols, start=start, end=end, limit=limit)
        # The payload is independently checked even when the vector store applies a timestamp filter.
        hits = [hit for hit in hits if _within_window(hit, start, end)]
        if not self.session_factory:
            return hits
        try:
            return await asyncio.to_thread(self._fresh_hits, hits, symbols)
        except (SQLAlchemyError, ValueError, KeyError) as exc:
            raise ServiceUnavailable("News version check unavailable") from exc

    async def analyze(self, req: RetrievalRequest) -> RetrievalResponse:
        symbols = list(dict.fromkeys(symbol for symbol in req.symbols if symbol in self.stock_options))
        if not symbols:
            raise AppError(f"無效的股票代號，支援：{list(self.stock_options.keys())}")
        end = _time_bound(req.as_of, "as_of") or datetime.now(TAIPEI)
        days = max(1, min(req.lookback_days, 120))
        max_events = max(1, min(req.max_events, 50))
        start, fallback_start = end - timedelta(days=days), end - timedelta(days=days * 2)
        fetch_limit = max(40, max_events * 4)
        self.vector.require_enabled()
        names = "、".join(self.stock_options[symbol] for symbol in symbols)
        stock_tokens = tuple(self.stock_options[symbol] for symbol in symbols) + tuple(symbols)
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
            vectors["market"], symbols=None, start=start, end=end, limit=fetch_limit),
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
