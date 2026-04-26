from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, HTTPException, status

from schemas.advisor import AdvisorReportJobRequest, AdvisorReportJobResponse
from services.advisor import get_advisor_report_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/advisor-report", tags=["Advisor 報告 Domain API"])


@router.post(
    "/jobs",
    response_model=AdvisorReportJobResponse,
    status_code=status.HTTP_200_OK,
    summary="建立 Advisor 完整報告工作",
    description="建立背景工作，後續以 job_id 或 /advisor/{request_id}/stream 追蹤狀態。",
    responses={
        200: {
            "description": "成功建立工作",
            "content": {
                "application/json": {
                    "example": {
                        "job_id": "job-123",
                        "symbol": "2330",
                        "as_of_date": "2026-04-26",
                        "status": "queued",
                        "created_at": "2026-04-26T09:00:00Z",
                        "updated_at": "2026-04-26T09:00:00Z",
                        "rule_summary": None,
                        "news": None,
                        "full_report": None,
                        "error": None,
                    }
                }
            },
        },
        400: {"description": "請求參數錯誤"},
        500: {"description": "伺服器內部錯誤"},
    },
)
async def create_advisor_report_job(req: AdvisorReportJobRequest):
    service = get_advisor_report_service()
    try:
        job = service.create_job(symbol=req.symbol, as_of_date=req.as_of_date or date.today())
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("create advisor report job failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="建立 Advisor 報告工作失敗")
    return AdvisorReportJobResponse(**job)


@router.get(
    "/jobs/{job_id}",
    response_model=AdvisorReportJobResponse,
    status_code=status.HTTP_200_OK,
    summary="查詢 Advisor 完整報告工作",
    description="使用 job_id 查詢背景工作狀態與結果。",
    responses={
        200: {"description": "成功取得工作狀態"},
        404: {"description": "job_id 不存在"},
    },
)
async def get_advisor_report_job(job_id: str):
    service = get_advisor_report_service()
    job = service.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job_id 不存在")
    return AdvisorReportJobResponse(**job)
