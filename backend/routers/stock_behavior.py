from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from config import get_settings
from database import get_db
from schemas.stock_behavior import (
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
    StockBehaviorTextBriefRequest,
    StockBehaviorTextBriefResponse,
)
from stock_behavior.orchestrator import StockBehaviorOrchestrator
from stock_behavior.utils import PolicyViolationError, UpstreamModelError

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
    except UpstreamModelError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.to_detail(),
        ) from exc


@router.post(
    "/rag",
    response_model=StockBehaviorRagResponse,
    summary="取得股票相關 RAG 新聞回覆",
    description=(
        "依股票代號呼叫 RAG 新聞服務，取得可供 AI 分析使用的新聞來源與原始摘要。"
        "Request 只接受 `symbols` 陣列，目前後端只會使用第一個有效股票代號。"
        "若 RAG 服務不可用，可能回傳 `fallback_mode=true` 與 fallback 摘要。"
    ),
    responses={
        200: {"description": "成功取得 RAG 新聞摘要"},
        422: {"description": "股票代號或政策檢查未通過"},
        504: {"description": "RAG 蒐集逾時"},
    },
)
async def get_stock_behavior_rag(
    req: StockBehaviorRagRequest,
    db: Session = Depends(get_db),
) -> StockBehaviorRagResponse:
    orchestrator = _build_orchestrator(db)
    return await _run_stock_behavior_task(orchestrator.collect_rag_news(req))


@router.post(
    "/text-brief",
    response_model=StockBehaviorTextBriefResponse,
    summary="產生股票文字簡報",
    description=(
        "以 text-first-v2 schema 產生文字簡報。"
        "只需傳入 `symbol`；新聞由後端自行向 RAG 取得，不再接受前端帶入 `news_sources`。"
        "相同 symbol／as_of_date／設定已有成功結果時會直接回傳快取（`cached=true`），"
        "需要重新產生請帶 `force_refresh=true`。"
    ),
    responses={
        200: {"description": "成功產生文字簡報"},
        422: {"description": "請求資料或政策檢查未通過"},
        503: {"description": "上游模型服務暫時無法回應，可稍後重試"},
        504: {"description": "文字簡報產生逾時"},
    },
)
async def get_stock_behavior_text_brief(
    req: StockBehaviorTextBriefRequest,
    db: Session = Depends(get_db),
) -> StockBehaviorTextBriefResponse:
    orchestrator = _build_orchestrator(db)
    return await _run_stock_behavior_task(orchestrator.generate_text_brief(req))

