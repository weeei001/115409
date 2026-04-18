from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, status

from routers.chat import _make_pipeline
from schemas.backtest import BacktestRunRequest, BacktestRunResult
from services.backtest import BacktestRunStore, BacktestService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/backtest", tags=["Backtest"])

_run_store = BacktestRunStore()
_backtest_service = BacktestService(pipeline=_make_pipeline())


@router.post("/run", response_model=BacktestRunResult, summary="Run direction backtest")
async def run_backtest(req: BacktestRunRequest):
    try:
        result = await _backtest_service.run(req)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("backtest run failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Backtest run failed")

    _run_store.set(result)
    return result


@router.get("/{run_id}", response_model=BacktestRunResult, summary="Get backtest result by run id")
def get_backtest_result(run_id: str):
    found = _run_store.get(run_id)
    if found is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backtest run id not found")
    return found
