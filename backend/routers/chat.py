import logging
from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, status

from agent.analyzer import analyze
from agent.data_fetcher import fetch_all
from agent.llm_client import LLMClient
from agent.schemas import ParsedIntent
from config import get_settings
from schemas.chat import (
    ChatRequest,
    ChatResponse,
    InstitutionalRow,
    NewsSourceItem,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["AI 分析"])

_llm_client: LLMClient | None = None


def _get_llm() -> LLMClient:
    global _llm_client
    if _llm_client is None:
        _llm_client = LLMClient(get_settings())
    return _llm_client


def _build_response(
    result,
    *,
    symbol: str = "",
    date_start: str = "",
    date_end: str = "",
    focus: str = "general",
    raw_answer: str = "",
) -> ChatResponse:
    inst_rows = [
        InstitutionalRow(
            date=row.get("date", ""),
            foreign_net=row.get("foreign_net", 0),
            trust_net=row.get("trust_net", 0),
            dealer_net=row.get("dealer_net", 0),
            total_net=row.get("total_net", 0),
        )
        for row in result.institutional_data
    ]

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

    if not raw_answer:
        raw_parts = [result.summary]
        if result.technical_highlights:
            raw_parts.append("【技術面】" + "；".join(result.technical_highlights))
        if result.recommendation:
            raw_parts.append(f"【建議】{result.recommendation}")
        if result.recommendation_basis:
            raw_parts.append("【依據】" + "；".join(result.recommendation_basis))
        raw_answer = "\n\n".join(p for p in raw_parts if p)

    return ChatResponse(
        symbol=symbol,
        date_start=date_start,
        date_end=date_end,
        focus=focus,
        summary=result.summary,
        sentiment_score=result.sentiment_score,
        technical_highlights=result.technical_highlights,
        institutional_data=inst_rows,
        recommendation=result.recommendation,
        recommendation_basis=result.recommendation_basis,
        news_sources=news_items,
        fallback_mode=result.fallback_mode,
        raw_answer=raw_answer,
    )


_QUERY_TEMPLATE = "請以專業投資顧問的角度，針對 {symbol} 提供技術面、籌碼面的綜合分析與操作建議。"
_LOOKBACK_DAYS = 30


@router.post("/analyze", response_model=ChatResponse, summary="AI 股票分析")
async def analyze_stock(req: ChatRequest):
    symbols = [s.strip().upper() for s in req.symbols if s.strip()]
    if not symbols:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="請提供股票代號（如 2330）",
        )
    symbol = symbols[0]

    today = date.today()
    intent = ParsedIntent(
        symbols=[symbol],
        date_start=today - timedelta(days=_LOOKBACK_DAYS),
        date_end=today,
        focus="general",
        original_query=_QUERY_TEMPLATE.format(symbol=symbol),
    )

    llm = _get_llm()

    try:
        data = await fetch_all(intent)
    except Exception:
        logger.exception("Unexpected error in fetch_all")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="資料取得過程發生錯誤，請稍後再試",
        )

    if not data.prices and not data.indicators and not data.institutional:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"查無股票代號 {symbol} 的資料，請確認代號是否正確",
        )

    intent_meta = dict(
        symbol=symbol,
        date_start=intent.date_start.isoformat(),
        date_end=intent.date_end.isoformat(),
        focus=intent.focus,
    )

    try:
        result = await analyze(llm, data, intent.focus, intent.original_query)
    except Exception:
        logger.exception("Unexpected error in analyze")
        return ChatResponse(
            **intent_meta,
            summary="",
            raw_answer="分析過程發生非預期錯誤，請稍後再試。",
            fallback_mode=True,
        )

    return _build_response(result, **intent_meta)
