from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from schemas.stock_behavior import (
    StockBehaviorAiResponse,
    StockBehaviorAiRequest,
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
)
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from stock_behavior.utils import PolicyViolationError

router = APIRouter(prefix="/analyze/stock-behavior", tags=["AI 分析"])
STOCK_BEHAVIOR_TIMEOUT_SECONDS = 1200
ResponseT = TypeVar("ResponseT")


def _policy_error_detail(exc: PolicyViolationError) -> dict:
    return exc.to_detail()


def _build_orchestrator(db: Session) -> StockBehaviorOrchestrator:
    return StockBehaviorOrchestrator(db=db, settings=get_settings())


async def _run_stock_behavior_task(task: Awaitable[ResponseT]) -> ResponseT:
    try:
        return await asyncio.wait_for(task, timeout=STOCK_BEHAVIOR_TIMEOUT_SECONDS)
    except asyncio.TimeoutError:
        raise HTTPException(status_code=status.HTTP_504_GATEWAY_TIMEOUT, detail="分析逾時，請稍後重試") from None
    except PolicyViolationError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=_policy_error_detail(exc)) from exc


@router.post(
    "/rag",
    response_model=StockBehaviorRagResponse,
    summary="取得股票相關 RAG 新聞回覆",
    description=(
        "Request 只接受 `symbols` 陣列，目前後端只會使用第一個有效股票代號。"
        "Response 直接回傳 `news_sources`、`fallback_mode`、`raw_answer`。"
    ),
)
async def get_stock_behavior_rag(
    req: StockBehaviorRagRequest,
    db: Session = Depends(get_db),
) -> StockBehaviorRagResponse:
    orchestrator = _build_orchestrator(db)
    return await _run_stock_behavior_task(orchestrator.collect_rag_news(req))


@router.post(
    "/ai",
    response_model=StockBehaviorAiResponse,
    summary="產生股票 AI 建議分析",
    description=(
        "Request 只接受 `symbol`、`news_sources`、`fallback_mode`、`raw_answer`。"
        "通常可直接把 `/analyze/stock-behavior/rag` 的 response 欄位帶入。"
    ),
)
async def get_stock_behavior_ai(
    req: StockBehaviorAiRequest,
    db: Session = Depends(get_db),
) -> StockBehaviorAiResponse:
    orchestrator = _build_orchestrator(db)
    return await _run_stock_behavior_task(orchestrator.generate_llm_analysis(req))
