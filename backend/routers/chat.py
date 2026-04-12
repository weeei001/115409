import asyncio
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from agent.analyzer import (
    analyze_final_integrated,
    analyze_quick_insights,
)
from agent.data_fetcher import (
    fetch_db_data,
    fetch_indicators_only,
    fetch_institutional_only,
    fetch_news,
    fetch_prices_only,
)
from agent.llm_client import LLMClient
from agent.schemas import DBData, NormalizedNewsChunk, ParsedIntent
from config import get_settings
from schemas.chat import (
    AnalyzeSymbolsRequest,
    AnalyzeFinalResponse,
    AnalyzeIndicatorsResponse,
    AnalyzeInstitutionalSliceResponse,
    AnalyzePricesResponse,
    QuickInsightsResponse,
    InstitutionalRow,
    NewsSourceItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI 分析"])

_llm_clients: dict[str, LLMClient] = {}

_STEP_LABELS = {
    "institutional": "抓取近 30 日法人籌碼",
    "news": "檢索相關新聞與情緒摘要",
    "cross_check": "交叉比對股價與技術指標",
    "final": "生成綜合報告",
}


def _resolve_model_key(
    request_model: str | None,
    *,
    fallback_default: str | None = None,
) -> str:
    """解析模型鍵（僅後端內部使用）。`request_model` 一律由路由傳入 `None`；依 `fallback_default` 或 `NIM_DEFAULT_MODEL`。"""
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
            detail="model 只支援 primary 或 secondary",
        )
    return model_key


def _model_name_from_key(model_key: str) -> str:
    settings = get_settings()
    if model_key == "secondary":
        return settings.NIM_MODEL_SECONDARY
    # Backward compatibility: legacy NIM_MODEL overrides primary when provided.
    return settings.NIM_MODEL or settings.NIM_MODEL_PRIMARY


def _get_llm(model_key: str) -> LLMClient:
    client = _llm_clients.get(model_key)
    if client is None:
        client = LLMClient(get_settings(), model=_model_name_from_key(model_key))
        _llm_clients[model_key] = client
    return client


def _build_final_response(
    result,
    *,
    symbol: str = "",
    date_start: str = "",
    date_end: str = "",
) -> AnalyzeFinalResponse:
    """組 /analyze/final 回應（不含 technical_highlights、institutional_data、raw_answer）。"""
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


def _sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


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


def _preview_prices(prices: list[dict]) -> list[dict]:
    return prices[-10:] if prices else []


def _preview_indicators(indicators: list[dict]) -> list[dict]:
    return indicators[-10:] if indicators else []


def _first_symbol(symbols: list[str]) -> str:
    cleaned = [s.strip().upper() for s in symbols if s.strip()]
    if not cleaned:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供股票代號（如 2330）",
        )
    return cleaned[0]


_QUERY_TEMPLATE = "請以專業投資顧問的角度，針對 {symbol} 提供技術面、籌碼面的綜合分析與操作建議。"
_LOOKBACK_DAYS = 30

# OpenAPI / Swagger：共用 HTTP 回應說明
_DOC_OK_JSON = "成功；回應 body 符合右側 **Response schema**。"
_DOC_400 = (
    "**客戶端／業務錯誤**：未帶有效代號、查無該股資料、或區間內無價量/指標/法人資料。\n"
    "Body 格式：`{\"detail\": \"說明文字\"}`。"
)
_DOC_500 = (
    "**伺服器錯誤**：資料庫連線/查詢失敗或其他未預期例外。\n"
    "Body 格式：`{\"detail\": \"說明文字\"}`。"
)
_ANALYZE_RESPONSES = {
    200: {"description": _DOC_OK_JSON},
    400: {"description": _DOC_400},
    500: {"description": _DOC_500},
}


# ── Parallel branch helpers ──────────────────────────────────────────────────

async def _branch_news(intent: ParsedIntent) -> tuple[list[NormalizedNewsChunk], str, bool]:
    """Fetch news from RAG；連線失敗或例外時略過新聞，不讓整段分析失敗。"""
    try:
        return await fetch_news(intent)
    except Exception:
        logger.warning(
            "新聞 API 不可用，略過新聞（symbols=%s）",
            intent.symbols,
            exc_info=True,
        )
        return [], "", True


# ── Split APIs: raw data vs technical LLM ─────────────────────────────────────


def _intent_raw(symbol: str, lookback_days: int) -> ParsedIntent:
    today = date.today()
    return ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=lookback_days),
        date_end=today,
        original_query="",
    )


@router.post(
    "/analyze/raw/prices",
    response_model=AnalyzePricesResponse,
    summary="原始資料：僅日 K 價量",
    description=(
        "只查 **價量** 一類；**不呼叫 LLM**。`status` 為 `prices_ready`。\n\n"
        "可與 `POST /analyze/raw/indicators`、`/analyze/raw/institutional` **並行**以取得完整原始資料。"
    ),
    response_description="含 `prices` 陣列與 `date_start`/`date_end`。",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_raw_prices(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)
    try:
        data = await fetch_prices_only(intent)
    except Exception:
        logger.exception("fetch_prices_only failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="資料庫讀取失敗，請稍後再試",
        )
    if not data.prices:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的價量資料，請確認代號或區間",
        )
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
    summary="原始資料：僅技術指標序列",
    description=(
        "只查 **技術指標**；**不呼叫 LLM**。`status` 為 `indicators_ready`。\n\n"
        "欄位依資料庫實際結構（如 MA、RSI、MACD、KD 等）。"
    ),
    response_description="含 `indicators` 陣列。",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_raw_indicators(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    intent = _intent_raw(symbol, _LOOKBACK_DAYS)
    try:
        data = await fetch_indicators_only(intent)
    except Exception:
        logger.exception("fetch_indicators_only failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="資料庫讀取失敗，請稍後再試",
        )
    if not data.indicators:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的技術指標資料，請確認代號或區間",
        )
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
    summary="原始資料：僅三大法人買賣超",
    description=(
        "只查 **三大法人** 淨買賣超；**不呼叫 LLM**。`status` 為 `institutional_ready`。\n\n"
        "每筆含外資、投信、自營商與合計（單位：股，與 DB 一致）。"
    ),
    response_description="含 `institutional_data` 陣列。",
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
            detail="資料庫讀取失敗，請稍後再試",
        )
    if not data.institutional:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的法人買賣超資料，請確認代號或區間",
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
    summary="快速數據觀察（小模型，points 條列）",
    description=(
        "以 **secondary 小模型**（由後端固定，不接受請求覆寫）讀取價量／指標／法人後，產出 **3～5 條** `points` 短句，"
        "描述「特別之處」（極值、均線關係、法人轉折等）。\n\n"
        "**與 `/analyze/final` 分工**：本端點負責條列觀察；最終摘要、情緒分數、新聞整合建議以 **`/analyze/final`** 為準。\n\n"
        "LLM 失敗時 `fallback_mode=true`，改為規則化重點。"
    ),
    response_description="`points` 為字串陣列；`fallback_mode` 表是否降級。",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_quick_insights_endpoint(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    today = date.today()
    intent = ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=_LOOKBACK_DAYS),
        date_end=today,
        original_query="",
    )

    llm = _get_llm(_resolve_model_key(None, fallback_default="secondary"))

    try:
        data = await fetch_db_data(intent)
    except Exception:
        logger.exception("fetch_db_data failed in /analyze/quick-insights")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="資料庫讀取失敗，請稍後再試",
        )

    if not data.prices and not data.indicators and not data.institutional:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的資料，請確認代號是否正確",
        )

    payload = await analyze_quick_insights(llm, data)

    if payload.get("fallback_mode"):
        logger.info("analyze_quick_insights_endpoint: fallback for symbol=%s", symbol)

    return QuickInsightsResponse(
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
        points=payload["points"],
        fallback_mode=payload["fallback_mode"],
    )


@router.post(
    "/analyze/final",
    response_model=AnalyzeFinalResponse,
    summary="整合分析（大模型：資料＋新聞）",
    description=(
        "**並行**自 DB 取得價量／指標／法人（供模型內部推理），並取得新聞／RAG 摘要後，以 **primary 大模型**（由後端固定）"
        "產出單一 JSON：**摘要**、**sentiment_score**、**recommendation**（建議含全形括號理由）、**news_sources** 等。\n\n"
        "**不含** `technical_highlights`、`institutional_data`、`raw_answer`；條列數據觀察請 **`POST /analyze/quick-insights`** 的 `points`；法人表請用 **`/analyze/raw/*`** 三筆。\n\n"
        "**耗時**：LLM 推理較長，建議客戶端 **timeout ≥ 90～120 秒**。\n\n"
        "`fallback_mode=true` 表示模型失敗改走規則化輸出。"
    ),
    response_description="結構見 **AnalyzeFinalResponse**（無 `technical_highlights`、`institutional_data`、`raw_answer`）。",
    responses=_ANALYZE_RESPONSES,
)
async def analyze_final_only(req: AnalyzeSymbolsRequest):
    """並行拉取 DB 三類資料與新聞，再以大模型產出綜合 JSON。條列式數據重點請用 /analyze/quick-insights。"""
    t_wall = time.perf_counter()
    symbol = _first_symbol(req.symbols)
    today = date.today()
    intent = ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=_LOOKBACK_DAYS),
        date_end=today,
        original_query=_QUERY_TEMPLATE.format(symbol=symbol),
    )

    llm = _get_llm(_resolve_model_key(None, fallback_default="primary"))

    try:
        data, (news_chunks, rag_summary, _) = await asyncio.gather(
            fetch_db_data(intent),
            _branch_news(intent),
        )
    except Exception:
        logger.exception("fetch_db_data failed in /analyze/final")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="資料庫讀取失敗，請稍後再試",
        )

    fetch_ms = (time.perf_counter() - t_wall) * 1000
    logger.info(
        "/analyze/final fetch_db+news %.0fms symbol=%s",
        fetch_ms,
        symbol,
    )

    if not data.prices and not data.indicators and not data.institutional:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的資料，請確認代號是否正確",
        )

    t_llm = time.perf_counter()
    result = await analyze_final_integrated(
        llm,
        data,
        rag_summary or "",
        news_chunks,
    )
    llm_ms = (time.perf_counter() - t_llm) * 1000

    if result.fallback_mode:
        logger.info("analyze_final_only: fallback_mode for symbol=%s", symbol)

    total_ms = (time.perf_counter() - t_wall) * 1000
    logger.info(
        "/analyze/final llm %.0fms total %.0fms symbol=%s fallback=%s",
        llm_ms,
        total_ms,
        symbol,
        result.fallback_mode,
    )

    return _build_final_response(
        result,
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
    )


@router.post(
    "/analyze/stream",
    summary="分析流程追蹤（SSE）",
    description=(
        "回傳 `text/event-stream`，依序推送 `step_start`、`partial_data`、`step_done`、`final_report`、`completed`。"
        "若某步驟失敗，會先推送 `error`；已成功步驟資料仍保留。"
    ),
)
async def analyze_stream(req: AnalyzeSymbolsRequest):
    symbol = _first_symbol(req.symbols)
    today = date.today()
    intent = ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=_LOOKBACK_DAYS),
        date_end=today,
        original_query=_QUERY_TEMPLATE.format(symbol=symbol),
    )
    request_id = uuid.uuid4().hex
    llm_primary = _get_llm(_resolve_model_key(None, fallback_default="primary"))
    llm_secondary = _get_llm(_resolve_model_key(None, fallback_default="secondary"))

    async def _event_stream() -> AsyncIterator[str]:
        data = DBData(
            symbol=symbol,
            date_start=intent.date_start,
            date_end=intent.date_end,
            prices=[],
            indicators=[],
            institutional=[],
        )
        news_chunks: list[NormalizedNewsChunk] = []
        rag_summary = ""
        quick_payload: dict = {"points": [], "fallback_mode": True}

        # Step 1: institutional
        step_key = "institutional"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 1] {_STEP_LABELS[step_key]}..."),
        )
        try:
            inst = await fetch_institutional_only(intent)
            data.institutional = inst.institutional
            inst_rows = [r.model_dump() for r in _institutional_rows_from_dicts(data.institutional)]
            preview = inst_rows[-10:]
            latest = preview[-1] if preview else None
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
                        "latest_date": latest.get("date") if latest else None,
                        "latest_total_net": latest.get("total_net") if latest else None,
                    },
                    "preview": preview,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "done", f"[Step 1] {_STEP_LABELS[step_key]}... (Done)"),
            )
        except Exception:
            logger.exception("stream step institutional failed for symbol=%s", symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": "法人資料抓取失敗，將以其餘資料繼續分析",
                    "recoverable": True,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "error", f"[Step 1] {_STEP_LABELS[step_key]}... (Failed)"),
            )

        # Step 2: news
        step_key = "news"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 2] {_STEP_LABELS[step_key]}..."),
        )
        news_chunks, rag_summary, news_is_fallback = await _branch_news(intent)
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
            _step_payload(request_id, step_key, "done", f"[Step 2] {_STEP_LABELS[step_key]}... (Done)"),
        )

        # Step 3: cross-check
        step_key = "cross_check"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Step 3] {_STEP_LABELS[step_key]}..."),
        )
        try:
            price_data, indicator_data = await asyncio.gather(
                fetch_prices_only(intent),
                fetch_indicators_only(intent),
            )
            data.prices = price_data.prices
            data.indicators = indicator_data.indicators

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

            quick_payload = await analyze_quick_insights(llm_secondary, data)
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
                _step_payload(request_id, step_key, "done", f"[Step 3] {_STEP_LABELS[step_key]}... (Done)"),
            )
        except Exception:
            logger.exception("stream step cross_check failed for symbol=%s", symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": "股價/技術指標交叉比對失敗，將以可用資料繼續",
                    "recoverable": True,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "error", f"[Step 3] {_STEP_LABELS[step_key]}... (Failed)"),
            )

        # Step 4: final report
        step_key = "final"
        yield _sse_event(
            "step_start",
            _step_payload(request_id, step_key, "running", f"[Final] {_STEP_LABELS[step_key]}。"),
        )
        if not data.prices and not data.indicators and not data.institutional:
            message = f"查無股票代號 {symbol} 的資料，請確認代號是否正確"
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": message,
                    "recoverable": False,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "error", f"[Final] {_STEP_LABELS[step_key]}。 (Failed)"),
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": False})
            return

        try:
            result = await analyze_final_integrated(
                llm_primary,
                data,
                rag_summary or "",
                news_chunks,
            )
            final_resp = _build_final_response(
                result,
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
                        "institutional_data": [r.model_dump() for r in _institutional_rows_from_dicts(data.institutional)],
                    },
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "done", f"[Final] {_STEP_LABELS[step_key]}。 (Done)"),
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": True})
        except Exception:
            logger.exception("stream final analyze failed for symbol=%s", symbol)
            yield _sse_event(
                "error",
                {
                    "request_id": request_id,
                    "step_key": step_key,
                    "message": "最終報告生成失敗，請稍後再試",
                    "recoverable": False,
                },
            )
            yield _sse_event(
                "step_done",
                _step_payload(request_id, step_key, "error", f"[Final] {_STEP_LABELS[step_key]}。 (Failed)"),
            )
            yield _sse_event("completed", {"request_id": request_id, "ok": False})

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
