
import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from agent.data_fetcher import (
    fetch_db_data,
    fetch_indicators_only,
    fetch_institutional_only,
    fetch_news,
    fetch_prices_only,
)
from agent.llm_client import LLMClient
from agent.pipeline import AnalysisPipelineService, NoCoreDataError, PipelineReportResult
from agent.schemas import AnalysisResult, NormalizedNewsChunk, ParsedIntent
from config import get_settings
from schemas.chat import (
    AnalyzeFinalResponse,
    AnalyzeIndicatorsResponse,
    AnalyzeInstitutionalSliceResponse,
    AnalyzePricesResponse,
    AnalyzeReportResponse,
    AnalyzeSymbolsRequest,
    InstitutionalRow,
    NewsSourceItem,
    QuickInsightsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI Advisor"])

_llm_clients: dict[str, LLMClient] = {}

_STEP_LABELS = {
    "institutional": "Fetch institutional flow",
    "news": "Fetch news and sentiment",
    "cross_check": "Cross-check prices and indicators",
    "final": "Generate final report",
}

_QUERY_TEMPLATE = "Analyze TW stock {symbol} with price, technical and institutional data."
_LOOKBACK_DAYS = 30

_DOC_OK_JSON = "Request completed successfully."
_DOC_400 = "Bad request or no data in selected range."
_DOC_500 = "Internal error while fetching or analyzing data."
_ANALYZE_RESPONSES = {
    200: {"description": _DOC_OK_JSON},
    400: {"description": _DOC_400},
    500: {"description": _DOC_500},
}


def _resolve_model_key(
    request_model: str | None,
    *,
    fallback_default: str | None = None,
) -> str:
    settings = get_settings()
    if request_model:
        model_key = request_model.lower()
    elif fallback_default:
        model_key = fallback_default.lower()
    else:
        model_key = (settings.NIM_DEFAULT_MODEL or "primary").lower()

    if model_key not in {"primary", "secondary"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="model must be primary or secondary",
        )
    return model_key


def _model_name_from_key(model_key: str) -> str:
    settings = get_settings()
    if model_key == "secondary":
        return settings.NIM_MODEL_SECONDARY
    return settings.NIM_MODEL or settings.NIM_MODEL_PRIMARY


def _get_llm(model_key: str) -> LLMClient:
    client = _llm_clients.get(model_key)
    if client is None:
        client = LLMClient(get_settings(), model=_model_name_from_key(model_key))
        _llm_clients[model_key] = client
    return client


async def _branch_news(intent: ParsedIntent) -> tuple[list[NormalizedNewsChunk], str, bool]:
    try:
        return await fetch_news(intent)
    except Exception:
        logger.warning("news branch failed symbols=%s", intent.symbols, exc_info=True)
        return [], "", True


def _first_symbol(symbols: list[str]) -> str:
    cleaned = [s.strip().upper() for s in symbols if s.strip()]
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide at least one stock symbol, e.g. 2330",
        )
    return cleaned[0]


def _intent_raw(symbol: str, lookback_days: int) -> ParsedIntent:
    today = date.today()
    return ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=lookback_days),
        date_end=today,
        original_query="",
    )


def _intent_advisor(symbol: str, lookback_days: int) -> ParsedIntent:
    today = date.today()
    return ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=lookback_days),
        date_end=today,
        original_query=_QUERY_TEMPLATE.format(symbol=symbol),
    )


def _make_pipeline() -> AnalysisPipelineService:
    llm_primary = _get_llm(_resolve_model_key(None, fallback_default="primary"))
    llm_secondary = _get_llm(_resolve_model_key(None, fallback_default="secondary"))
    return AnalysisPipelineService(
        llm_primary=llm_primary,
        llm_secondary=llm_secondary,
        fetch_db_data_fn=fetch_db_data,
        fetch_news_fn=_branch_news,
    )


def _institutional_rows_from_dicts(rows: list[dict]) -> list[InstitutionalRow]:
    return [
        InstitutionalRow(
            date=row.get("date", ""),
            foreign_net=row.get("foreign_net", 0),
            trust_net=row.get("trust_net", 0),
            dealer_net=row.get("dealer_net", 0),
            total_net=row.get("total_net", 0),
        )
        for row in rows
    ]


def _build_final_response(
    result: AnalysisResult,
    *,
    symbol: str,
    date_start: str,
    date_end: str,
) -> AnalyzeFinalResponse:
    news_items = [
        NewsSourceItem(
            id=n.id,
            title=n.title,
            summary=n.content,
            timestamp=n.timestamp.isoformat() if n.timestamp else "",
            url=n.url,
        )
        for n in result.news_sources
    ]

    return AnalyzeFinalResponse(
        symbol=symbol,
        date_start=date_start,
        date_end=date_end,
        summary=result.summary,
        sentiment_score=result.sentiment_score,
        recommendation=result.recommendation,
        recommendation_basis=result.recommendation_basis,
        news_sources=news_items,
        score_breakdown=result.score_breakdown.model_dump(),
        fallback_mode=result.fallback_mode,
        status="done",
    )


def _build_report_response(
    payload: PipelineReportResult,
    *,
    symbol: str,
    date_start: str,
    date_end: str,
) -> AnalyzeReportResponse:
    final_resp = _build_final_response(
        payload.final_result,
        symbol=symbol,
        date_start=date_start,
        date_end=date_end,
    )

    return AnalyzeReportResponse(
        symbol=final_resp.symbol,
        date_start=final_resp.date_start,
        date_end=final_resp.date_end,
        summary=final_resp.summary,
        sentiment_score=final_resp.sentiment_score,
        recommendation=final_resp.recommendation,
        recommendation_basis=final_resp.recommendation_basis,
        news_sources=final_resp.news_sources,
        score_breakdown=final_resp.score_breakdown,
        fallback_mode=final_resp.fallback_mode,
        quick_points=[str(p) for p in payload.quick_payload.get("points", [])],
        quick_fallback_mode=bool(payload.quick_payload.get("fallback_mode")),
        institutional_data=_institutional_rows_from_dicts(payload.data.institutional),
        status="done",
    )


def _preview_prices(prices: list[dict]) -> list[dict]:
    return prices[-10:] if prices else []


def _preview_indicators(indicators: list[dict]) -> list[dict]:
    return indicators[-10:] if indicators else []


def _step_payload(
    request_id: str,
    step_key: str,
    status_text: str,
    message: str,
) -> dict:
    return {
        "request_id": request_id,
        "step_key": step_key,
        "step_label": _STEP_LABELS.get(step_key, step_key),
        "status": status_text,
        "message": message,
    }


def _sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _data_not_found_detail(symbol: str) -> str:
    return f"No prices / indicators / institutional data found for symbol={symbol}"

@router.post(
    "/analyze/raw/prices",
    response_model=AnalyzePricesResponse,
    summary="Get raw prices",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_raw_prices(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)

    try:
        data = await fetch_prices_only(intent)
    except Exception:
        logger.exception("fetch_prices_only failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch prices")

    if not data.prices:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No prices for symbol={symbol}")

    return AnalyzePricesResponse(
        status="prices_ready",
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        prices=data.prices,
    )


@router.post(
    "/analyze/raw/indicators",
    response_model=AnalyzeIndicatorsResponse,
    summary="Get raw indicators",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_raw_indicators(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)

    try:
        data = await fetch_indicators_only(intent)
    except Exception:
        logger.exception("fetch_indicators_only failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to fetch indicators")

    if not data.indicators:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"No indicators for symbol={symbol}")

    return AnalyzeIndicatorsResponse(
        status="indicators_ready",
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        indicators=data.indicators,
    )


@router.post(
    "/analyze/raw/institutional",
    response_model=AnalyzeInstitutionalSliceResponse,
    summary="Get raw institutional flow",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_raw_institutional(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)

    try:
        data = await fetch_institutional_only(intent)
    except Exception:
        logger.exception("fetch_institutional_only failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to fetch institutional flow",
        )

    if not data.institutional:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No institutional flow for symbol={symbol}",
        )

    return AnalyzeInstitutionalSliceResponse(
        status="institutional_ready",
        symbol=data.symbol,
        date_start=data.date_start.isoformat(),
        date_end=data.date_end.isoformat(),
        institutional_data=_institutional_rows_from_dicts(data.institutional),
    )


@router.post(
    "/analyze/quick-insights",
    response_model=QuickInsightsResponse,
    summary="Quick technical/institutional insights",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_quick_insights_endpoint(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)

    llm_secondary = _get_llm(_resolve_model_key(None, fallback_default="secondary"))
    pipeline = AnalysisPipelineService(
        llm_primary=llm_secondary,
        llm_secondary=llm_secondary,
        fetch_db_data_fn=fetch_db_data,
        fetch_news_fn=_branch_news,
    )
    request_id = uuid.uuid4().hex

    try:
        core = await pipeline.run_core(intent, request_id=request_id)
    except NoCoreDataError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_data_not_found_detail(symbol))
    except Exception:
        logger.exception("quick insights pipeline failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Quick insights failed")

    return QuickInsightsResponse(
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
        points=[str(p) for p in core.quick_payload.get("points", [])],
        fallback_mode=bool(core.quick_payload.get("fallback_mode")),
    )


@router.post(
    "/analyze/final",
    response_model=AnalyzeFinalResponse,
    summary="Final integrated report",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_final_only(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_advisor(symbol, _LOOKBACK_DAYS)
    request_id = uuid.uuid4().hex

    pipeline = _make_pipeline()
    try:
        payload = await pipeline.run_report(intent, request_id=request_id)
    except NoCoreDataError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_data_not_found_detail(symbol))
    except Exception:
        logger.exception("final pipeline failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Final analysis failed")

    logger.info(
        "/analyze/final request_id=%s symbol=%s core=%.0fms quick=%.0fms news=%.0fms final=%.0fms total=%.0fms",
        request_id,
        symbol,
        payload.timings.core_ready_ms,
        payload.timings.quick_ready_ms,
        payload.timings.news_ready_ms,
        payload.timings.final_ready_ms,
        payload.timings.total_ms,
    )

    return _build_final_response(
        payload.final_result,
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
    )


@router.post(
    "/analyze/report",
    response_model=AnalyzeReportResponse,
    summary="Aggregated non-stream report",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_report(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_advisor(symbol, _LOOKBACK_DAYS)
    request_id = uuid.uuid4().hex

    pipeline = _make_pipeline()
    try:
        payload = await pipeline.run_report(intent, request_id=request_id)
    except NoCoreDataError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_data_not_found_detail(symbol))
    except Exception:
        logger.exception("report pipeline failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Report generation failed")

    return _build_report_response(
        payload,
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
    )

@router.post(
    "/analyze/stream",
    summary="Streaming analysis (SSE)",
)
async def analyze_stream(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_advisor(symbol, _LOOKBACK_DAYS)
    request_id = uuid.uuid4().hex

    pipeline = _make_pipeline()

    async def _event_stream() -> AsyncIterator[str]:
        t0 = time.perf_counter()
        news_task = asyncio.create_task(pipeline.fetch_news_with_fallback(intent, request_id=request_id))

        # Step 1: institutional (from core data, no extra query)
        step_key = "institutional"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 1] {_STEP_LABELS[step_key]}..."),
        )

        try:
            core = await pipeline.run_core(intent, request_id=request_id, started_at=t0)
        except NoCoreDataError:
            news_task.cancel()
            await asyncio.gather(news_task, return_exceptions=True)
            message = _data_not_found_detail(symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": message,
                    "recoverable": False,
                },
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": False})
            return
        except Exception:
            news_task.cancel()
            await asyncio.gather(news_task, return_exceptions=True)
            logger.exception("stream core pipeline failed symbol=%s", symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": "Failed to prepare core analysis data",
                    "recoverable": False,
                },
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": False})
            return

        data = core.data
        quick_payload = core.quick_payload

        inst_rows = [row.model_dump() for row in _institutional_rows_from_dicts(data.institutional)]
        inst_preview = inst_rows[-10:]
        latest_inst = inst_preview[-1] if inst_preview else None

        yield _sse_event(
            "partial_data",
            {
                "request_id": request_id,
                "step_key": step_key,
                "dataset": "institutional",
                "summary": {
                    "symbol": symbol,
                    "date_start": intent.date_start.isoformat(),
                    "date_end": intent.date_end.isoformat(),
                    "rows": len(inst_rows),
                    "latest_date": latest_inst.get("date") if latest_inst else None,
                    "latest_total_net": latest_inst.get("total_net") if latest_inst else None,
                },
                "preview": inst_preview,
            },
        )
        yield _sse_event(
            "step_done",
            _step_payload(request_id, step_key, "done", f"[Step 1] {_STEP_LABELS[step_key]}... (Done)"),
        )

        # Step 2: cross-check emits prices, indicators and quick insights.
        step_key = "cross_check"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 2] {_STEP_LABELS[step_key]}..."),
        )

        price_preview = _preview_prices(data.prices)
        latest_price = price_preview[-1] if price_preview else None
        yield _sse_event(
            "partial_data",
            {
                "request_id": request_id,
                "step_key": step_key,
                "dataset": "prices",
                "summary": {
                    "rows": len(data.prices),
                    "latest_date": latest_price.get("date") if latest_price else None,
                    "latest_close": latest_price.get("close") if latest_price else None,
                    "latest_change": latest_price.get("change") if latest_price else None,
                },
                "preview": price_preview,
            },
        )

        indicator_preview = _preview_indicators(data.indicators)
        latest_indicator = indicator_preview[-1] if indicator_preview else None
        yield _sse_event(
            "partial_data",
            {
                "request_id": request_id,
                "step_key": step_key,
                "dataset": "indicators",
                "summary": {
                    "rows": len(data.indicators),
                    "latest_date": latest_indicator.get("date") if latest_indicator else None,
                    "latest_rsi14": latest_indicator.get("rsi14") if latest_indicator else None,
                    "latest_macd_hist": latest_indicator.get("macd_hist") if latest_indicator else None,
                },
                "preview": indicator_preview,
            },
        )

        yield _sse_event(
            "partial_data",
            {
                "request_id": request_id,
                "step_key": step_key,
                "dataset": "quick_insights",
                "summary": {
                    "rows": len(quick_payload.get("points", [])),
                    "fallback_mode": bool(quick_payload.get("fallback_mode")),
                    "points": quick_payload.get("points", []),
                },
                "preview": [{"point": p} for p in quick_payload.get("points", [])[:5]],
            },
        )

        yield _sse_event(
            "step_done",
            _step_payload(request_id, step_key, "done", f"[Step 2] {_STEP_LABELS[step_key]}... (Done)"),
        )

        # Step 3: news can finish after quick insights.
        step_key = "news"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 3] {_STEP_LABELS[step_key]}..."),
        )

        news_chunks, rag_summary, news_is_fallback = await news_task
        news_ready_ms = (time.perf_counter() - t0) * 1000

        news_preview = [
            {
                "id": n.id,
                "title": n.title,
                "timestamp": n.timestamp.isoformat() if n.timestamp else "",
                "url": n.url,
            }
            for n in news_chunks[:5]
        ]
        yield _sse_event(
            "partial_data",
            {
                "request_id": request_id,
                "step_key": step_key,
                "dataset": "news",
                "summary": {
                    "rows": len(news_chunks),
                    "fallback_mode": news_is_fallback,
                },
                "preview": news_preview,
            },
        )

        yield _sse_event(
            "step_done",
            _step_payload(request_id, step_key, "done", f"[Step 3] {_STEP_LABELS[step_key]}... (Done)"),
        )

        # Step 4: final report.
        step_key = "final"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Final] {_STEP_LABELS[step_key]}..."),
        )

        try:
            final_result = await pipeline.run_final(
                data,
                rag_summary or "",
                news_chunks,
                request_id=request_id,
                started_at=t0,
            )
        except Exception:
            logger.exception("stream final analysis failed symbol=%s", symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": "Failed to generate final report",
                    "recoverable": False,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "error", f"[Final] {_STEP_LABELS[step_key]}... (Failed)"),
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": False})
            return

        final_ready_ms = (time.perf_counter() - t0) * 1000
        final_resp = _build_final_response(
            final_result,
            symbol=symbol,
            date_start=intent.date_start.isoformat(),
            date_end=intent.date_end.isoformat(),
        )

        yield _sse_event(
            "final_report",
            {
                "request_id": request_id,
                "report": final_resp.model_dump(),
                "quick_insights": {
                    "symbol": symbol,
                    "date_start": intent.date_start.isoformat(),
                    "date_end": intent.date_end.isoformat(),
                    "points": quick_payload.get("points", []),
                    "fallback_mode": bool(quick_payload.get("fallback_mode")),
                },
                "institutional": {
                    "status": "institutional_ready",
                    "symbol": symbol,
                    "date_start": intent.date_start.isoformat(),
                    "date_end": intent.date_end.isoformat(),
                    "institutional_data": inst_rows,
                },
            },
        )

        yield _sse_event(
            "step_done",
            _step_payload(request_id, step_key, "done", f"[Final] {_STEP_LABELS[step_key]}... (Done)"),
        )
        yield _sse_event("completed", {"request_id": request_id, "ok": True})

        logger.info(
            "/analyze/stream request_id=%s symbol=%s core=%.0fms quick=%.0fms news=%.0fms final=%.0fms total=%.0fms",
            request_id,
            symbol,
            core.timings.core_ready_ms,
            core.timings.quick_ready_ms,
            news_ready_ms,
            final_ready_ms,
            final_ready_ms,
        )

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
