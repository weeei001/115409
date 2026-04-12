from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass
from typing import Awaitable, Callable

from agent.analyzer import analyze_final_integrated, analyze_quick_insights
from agent.data_fetcher import fetch_db_data, fetch_news
from agent.llm_client import LLMClient
from agent.schemas import AnalysisResult, DBData, NormalizedNewsChunk, ParsedIntent

logger = logging.getLogger(__name__)

_RAG_SUMMARY_LOG_MAX_LEN = 280


def _format_rag_summary_for_log(summary: str, max_len: int = _RAG_SUMMARY_LOG_MAX_LEN) -> str:
    normalized = " ".join((summary or "").split())
    if not normalized:
        return "(empty)"
    if len(normalized) <= max_len:
        return normalized
    return normalized[:max_len] + "..."


NewsFetcher = Callable[[ParsedIntent], Awaitable[tuple[list[NormalizedNewsChunk], str, bool]]]
DBFetcher = Callable[[ParsedIntent], Awaitable[DBData]]
QuickAnalyzer = Callable[[LLMClient, DBData], Awaitable[dict]]
FinalAnalyzer = Callable[[LLMClient, DBData, str, list[NormalizedNewsChunk] | None], Awaitable[AnalysisResult]]


class NoCoreDataError(ValueError):
    """Raised when prices/indicators/institutional are all missing."""


@dataclass
class PipelineTimings:
    core_ready_ms: float = 0.0
    quick_ready_ms: float = 0.0
    news_ready_ms: float = 0.0
    final_ready_ms: float = 0.0
    total_ms: float = 0.0


@dataclass
class CorePipelineResult:
    data: DBData
    quick_payload: dict
    timings: PipelineTimings


@dataclass
class PipelineReportResult:
    data: DBData
    quick_payload: dict
    final_result: AnalysisResult
    news_chunks: list[NormalizedNewsChunk]
    rag_summary: str
    news_fallback: bool
    timings: PipelineTimings


class AnalysisPipelineService:
    def __init__(
        self,
        *,
        llm_primary: LLMClient,
        llm_secondary: LLMClient,
        fetch_db_data_fn: DBFetcher = fetch_db_data,
        fetch_news_fn: NewsFetcher = fetch_news,
        analyze_quick_fn: QuickAnalyzer = analyze_quick_insights,
        analyze_final_fn: FinalAnalyzer = analyze_final_integrated,
    ) -> None:
        self._llm_primary = llm_primary
        self._llm_secondary = llm_secondary
        self._fetch_db_data_fn = fetch_db_data_fn
        self._fetch_news_fn = fetch_news_fn
        self._analyze_quick_fn = analyze_quick_fn
        self._analyze_final_fn = analyze_final_fn

    @staticmethod
    def has_core_data(data: DBData) -> bool:
        return bool(data.prices or data.indicators or data.institutional)

    async def fetch_news_with_fallback(
        self,
        intent: ParsedIntent,
        *,
        request_id: str = "",
    ) -> tuple[list[NormalizedNewsChunk], str, bool]:
        try:
            news_chunks, rag_summary, is_fallback = await self._fetch_news_fn(intent)
            print(
                "[pipeline.news] request_id={request_id} symbols={symbols} chunks={chunks} "
                "fallback={fallback} rag_summary={summary}".format(
                    request_id=request_id,
                    symbols=intent.symbols,
                    chunks=len(news_chunks),
                    fallback=is_fallback,
                    summary=_format_rag_summary_for_log(rag_summary),
                )
            )
            return news_chunks, rag_summary, is_fallback
        except Exception:
            logger.warning(
                "pipeline.news failed request_id=%s symbols=%s",
                request_id,
                intent.symbols,
                exc_info=True,
            )
            return [], "", True

    async def run_core(
        self,
        intent: ParsedIntent,
        *,
        request_id: str = "",
        started_at: float | None = None,
    ) -> CorePipelineResult:
        t0 = started_at or time.perf_counter()
        timings = PipelineTimings()

        data = await self._fetch_db_data_fn(intent)
        timings.core_ready_ms = (time.perf_counter() - t0) * 1000

        if not self.has_core_data(data):
            raise NoCoreDataError(f"No analysis data for symbol={data.symbol}")

        quick_payload = await self._analyze_quick_fn(self._llm_secondary, data)
        timings.quick_ready_ms = (time.perf_counter() - t0) * 1000

        logger.info(
            "pipeline.core request_id=%s symbol=%s core_ready=%.0fms quick_ready=%.0fms quick_fallback=%s",
            request_id,
            data.symbol,
            timings.core_ready_ms,
            timings.quick_ready_ms,
            bool(quick_payload.get("fallback_mode")),
        )
        return CorePipelineResult(data=data, quick_payload=quick_payload, timings=timings)

    async def run_report(
        self,
        intent: ParsedIntent,
        *,
        request_id: str = "",
    ) -> PipelineReportResult:
        t0 = time.perf_counter()
        news_task = asyncio.create_task(self.fetch_news_with_fallback(intent, request_id=request_id))

        try:
            core = await self.run_core(intent, request_id=request_id, started_at=t0)
        except Exception:
            news_task.cancel()
            await asyncio.gather(news_task, return_exceptions=True)
            raise

        news_chunks, rag_summary, news_fallback = await news_task
        core.timings.news_ready_ms = (time.perf_counter() - t0) * 1000

        final_result = await self.run_final(
            core.data,
            rag_summary or "",
            news_chunks,
            request_id=request_id,
            started_at=t0,
        )
        core.timings.final_ready_ms = (time.perf_counter() - t0) * 1000
        core.timings.total_ms = core.timings.final_ready_ms

        logger.info(
            "pipeline.report request_id=%s symbol=%s core=%.0fms quick=%.0fms news=%.0fms final=%.0fms total=%.0fms "
            "quick_fallback=%s final_fallback=%s news_fallback=%s",
            request_id,
            core.data.symbol,
            core.timings.core_ready_ms,
            core.timings.quick_ready_ms,
            core.timings.news_ready_ms,
            core.timings.final_ready_ms,
            core.timings.total_ms,
            bool(core.quick_payload.get("fallback_mode")),
            final_result.fallback_mode,
            news_fallback,
        )

        return PipelineReportResult(
            data=core.data,
            quick_payload=core.quick_payload,
            final_result=final_result,
            news_chunks=news_chunks,
            rag_summary=rag_summary or "",
            news_fallback=news_fallback,
            timings=core.timings,
        )

    async def run_final(
        self,
        data: DBData,
        rag_summary: str,
        news_chunks: list[NormalizedNewsChunk],
        *,
        request_id: str = "",
        started_at: float | None = None,
    ) -> AnalysisResult:
        t0 = started_at or time.perf_counter()
        final_result = await self._analyze_final_fn(
            self._llm_primary,
            data,
            rag_summary or "",
            news_chunks,
        )
        final_ready_ms = (time.perf_counter() - t0) * 1000
        logger.info(
            "pipeline.final request_id=%s symbol=%s final_ready=%.0fms final_fallback=%s",
            request_id,
            data.symbol,
            final_ready_ms,
            final_result.fallback_mode,
        )
        return final_result
