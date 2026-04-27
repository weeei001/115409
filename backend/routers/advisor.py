from __future__ import annotations

import json
import logging
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse

from schemas.advisor import AdvisorOverviewRequest, AdvisorOverviewResponse
from services.advisor import get_advisor_orchestrator, get_runtime_store

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/advisor", tags=["Advisor 體驗 API"])


def _sse_event(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@router.post(
    "/overview",
    response_model=AdvisorOverviewResponse,
    status_code=status.HTTP_200_OK,
    summary="取得 Advisor 首屏摘要",
    description=(
        "回傳 Advisor 首屏所需的核心資料，包含 market snapshot、active preset、core decision、"
        "規則模板摘要、主圖與回測可信度快取。此端點不等待 LLM、不等待新聞/RAG。"
    ),
    responses={
        200: {
            "description": "成功取得首屏資料",
            "content": {
                "application/json": {
                    "example": {
                        "request_id": "a8ec4d4f9c7d4a9e80be09b7e6f3852f",
                        "job_id": "f6f5815ef3e64f9e8e9f7f4dbf0d0f35",
                        "advisor_report_status": "queued",
                        "symbol": "2330",
                        "as_of_date": "2026-04-26",
                        "trend_conclusion": "偏多",
                        "confidence_level": "中高",
                        "condition_checks": [],
                        "reason_points": ["均線結構維持多頭", "動能未破壞"],
                        "rule_summary": [
                            "2330 截至 2026-04-26 的核心判斷為「偏多」，信心等級為「中高」，條件檢查通過 4/6。",
                            "主要依據：均線結構維持多頭；動能未破壞",
                            "技術與籌碼快照：RSI14 62.4、MACD 柱體 0.0412、三大法人合計 +12,300。"
                        ],
                        "technical_snapshot": {},
                        "institutional_snapshot": {},
                        "technical_history": [],
                        "institutional_history": [],
                        "price_chart": {"candles": [], "volume": [], "overlays": {}, "markers": []},
                        "credibility_summary": None,
                        "backtest_snapshot_status": "pending",
                        "advisor_report_job": {"job_id": "f6f5815ef3e64f9e8e9f7f4dbf0d0f35", "status": "queued"}
                    }
                }
            },
        },
        400: {"description": "請求參數錯誤"},
        500: {"description": "伺服器內部錯誤"},
    },
)
async def advisor_overview(req: AdvisorOverviewRequest):
    orchestrator = get_advisor_orchestrator()
    try:
        return await orchestrator.overview(req)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("advisor overview failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="advisor overview 失敗")


@router.get(
    "/{request_id}/stream",
    status_code=status.HTTP_200_OK,
    summary="訂閱 Advisor 漸進事件串流",
    description=(
        "以 SSE 方式回傳背景任務事件。可能事件："
        "advisor_full_report_ready、news_ready、core_backtest_ready、failed、completed。"
    ),
    responses={
        200: {
            "description": "SSE 事件串流",
            "content": {
                "text/event-stream": {
                    "example": (
                        "event: news_ready\n"
                        "data: {\"request_id\":\"req-1\",\"job_id\":\"job-1\",\"news\":{\"count\":2}}\n\n"
                        "event: advisor_full_report_ready\n"
                        "data: {\"request_id\":\"req-1\",\"job_id\":\"job-1\",\"full_report\":{\"final_summary\":\"...\"}}\n\n"
                        "event: completed\n"
                        "data: {\"request_id\":\"req-1\",\"ok\":true}\n\n"
                    )
                }
            },
        },
        404: {"description": "request_id 不存在"},
    },
)
async def advisor_stream(request_id: str):
    runtime = get_runtime_store()
    if not runtime.has_request(request_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="request_id 不存在")

    async def _event_stream() -> AsyncIterator[str]:
        async for item in runtime.stream_request_events(request_id):
            yield _sse_event(str(item.get("event") or "message"), dict(item.get("data") or {}))

    return StreamingResponse(
        _event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
