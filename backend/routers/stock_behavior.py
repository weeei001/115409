from __future__ import annotations

import asyncio
from collections.abc import Awaitable
from typing import TypeVar

import json

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from config import get_settings
from crud.llm_response import get_llm_response, list_llm_responses
from database import get_db
from models.llm_response import LLM_RESPONSE_KIND_TEXT_BRIEF
from schemas.stock_behavior import (
    StockBehaviorRagRequest,
    StockBehaviorRagResponse,
    StockBehaviorTextBriefRequest,
    StockBehaviorTextBriefResponse,
    TextBriefHistoryItem,
    TextBriefHistoryResponse,
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


def _history_status(row) -> str:
    """狀態存在 response_json 裡；解析失敗時退回 is_fallback 判斷，不讓整列消失。"""
    if row.response_json:
        try:
            stored = json.loads(row.response_json)
        except ValueError:
            return "unknown"
        value = stored.get("status")
        if isinstance(value, str):
            return value
    return "unavailable" if row.is_fallback else "unknown"


@router.get(
    "/text-brief/history",
    response_model=TextBriefHistoryResponse,
    summary="列出最近幾次文字簡報的執行紀錄",
    description=(
        "依 `llm_responses` 由新到舊列出，含失敗與 fallback 的那幾次。"
        "只回摘要欄位；完整回應與當時送進模型的 payload 請用 `/text-brief/history/{id}`。"
    ),
)
def list_stock_behavior_text_brief_history(
    symbol: str | None = Query(default=None, description="只看單一檔，省略＝全部"),
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
) -> TextBriefHistoryResponse:
    rows = list_llm_responses(
        db,
        kind=LLM_RESPONSE_KIND_TEXT_BRIEF,
        symbol=symbol.strip().upper() if symbol else None,
        limit=limit,
    )
    return TextBriefHistoryResponse(
        items=[
            TextBriefHistoryItem(
                id=row.id,
                symbol=row.symbol,
                as_of_date=row.as_of_date.isoformat(),
                model_name=row.model_name,
                status=_history_status(row),
                is_fallback=bool(row.is_fallback),
                news_count=row.news_count,
                latency_ms=row.latency_ms,
                created_at=row.created_at.isoformat() if row.created_at else None,
                summary=row.summary,
                prompt_version=row.prompt_version,
                config_hash=(row.config_hash or "")[:12] or None,
                has_payload=bool(row.prompt_json),
            )
            for row in rows
        ]
    )


@router.get(
    "/text-brief/history/{response_id}",
    response_model=StockBehaviorTextBriefResponse,
    summary="重播某一次的文字簡報",
    description=(
        "回傳當時存下來的完整回應，並附上那一次送進模型的 task packet（取自稽核用的 "
        "`prompt_json`），所以 DEMO 的三個分頁都能直接看歷史結果。"
    ),
    responses={404: {"description": "找不到這筆紀錄，或它沒有可重播的回應"}},
)
def get_stock_behavior_text_brief_history_item(
    response_id: int,
    db: Session = Depends(get_db),
) -> StockBehaviorTextBriefResponse:
    row = get_llm_response(db, response_id=response_id, kind=LLM_RESPONSE_KIND_TEXT_BRIEF)
    if row is None or not row.response_json:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這筆執行紀錄")
    try:
        response = StockBehaviorTextBriefResponse.model_validate(json.loads(row.response_json))
    except (ValueError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="這筆紀錄的回應無法解析"
        ) from None
    response.cached = True
    if row.prompt_json:
        try:
            response.task_packet = json.loads(row.prompt_json)
        except ValueError:
            response.task_packet = None
    return response
