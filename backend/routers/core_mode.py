from __future__ import annotations

import logging
from datetime import date
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status

from schemas.advisor import (
    BacktestSnapshotPendingResponse,
    BacktestSnapshotReadyResponse,
    BacktestSnapshotRequest,
    CoreDecisionRequest,
    CoreDecisionResponse,
)
from schemas.core_mode import (
    ActivatePresetResponse,
    ApplyActivePresetRequest,
    CoreModePresetSaveRequest,
    CoreModeRunRequest,
)
from services.advisor import (
    get_backtest_snapshot_service,
    get_core_decision_service,
    get_market_snapshot_service,
)
from services.core_mode import CoreModeService

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Core Mode API"])

_service = CoreModeService(
    preset_store_path=Path(__file__).resolve().parents[1] / "data" / "core_mode_presets.json"
)


# Legacy API kept for core-mode lab page; mark as deprecated and point to domain API.
@router.get(
    "/api/backtest/core-mode/schema",
    summary="取得核心模式參數 schema（舊版）",
    description="舊版 API。僅供舊管理頁使用；趨勢判斷請改用 /core-mode/decision。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def get_core_mode_schema():
    return _service.get_schema()


@router.get(
    "/api/backtest/presets",
    summary="取得 core-mode preset 清單（舊版）",
    description="舊版 API。建議改用 /core-mode/presets。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def get_core_mode_presets():
    return _service.get_presets()


@router.post(
    "/api/backtest/presets",
    summary="儲存或更新 core-mode preset（舊版）",
    description="舊版 API。建議改用 /core-mode/presets（後續將提供）。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def save_core_mode_preset(req: CoreModePresetSaveRequest):
    try:
        return _service.save_preset(
            name=req.name,
            description=req.description,
            params=req.params,
            preset_id=req.preset_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("save core-mode preset failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="儲存 preset 失敗")


@router.post(
    "/api/backtest/presets/{preset_id}/activate",
    response_model=ActivatePresetResponse,
    summary="設定 active preset（舊版）",
    description="舊版 API。建議改用 /core-mode/presets/{preset_id}/activate。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def activate_core_mode_preset(preset_id: str):
    try:
        return _service.activate_preset(preset_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except Exception:
        logger.exception("activate core-mode preset failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="設定 active preset 失敗")


@router.post(
    "/api/backtest/core-mode/run",
    summary="執行 core-mode 回測（舊版）",
    description="舊版 API。此端點仍供 Core Mode 實驗頁使用。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def run_core_mode_backtest(req: CoreModeRunRequest):
    try:
        return _service.run_core_mode(req.model_dump(mode="json"))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("run core-mode backtest failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="core-mode 回測執行失敗")


@router.post(
    "/api/analysis/apply-active-preset",
    summary="套用 active preset 進行趨勢分析（舊版）",
    description="舊版 API。請改用 /core-mode/decision。",
    deprecated=True,
    status_code=status.HTTP_200_OK,
)
def apply_active_preset(req: ApplyActivePresetRequest):
    try:
        return _service.apply_active_preset(symbol=req.symbol, as_of_date=req.as_of_date)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("apply active preset failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="套用 active preset 分析失敗")


@router.get(
    "/core-mode/presets",
    summary="取得 core-mode preset 清單",
    description="Domain API：取得 preset 清單與 active preset。",
    status_code=status.HTTP_200_OK,
)
def get_core_mode_presets_domain():
    return _service.get_presets()


@router.post(
    "/core-mode/presets/{preset_id}/activate",
    response_model=ActivatePresetResponse,
    summary="啟用 core-mode preset",
    description="Domain API：切換 active preset。",
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "設定成功"},
        404: {"description": "preset_id 不存在"},
    },
)
def activate_core_mode_preset_domain(preset_id: str):
    return activate_core_mode_preset(preset_id)


@router.post(
    "/core-mode/decision",
    response_model=CoreDecisionResponse,
    summary="取得 Core Mode 核心判斷",
    description=(
        "Domain API：根據 active preset（或指定 preset）回傳 state_score、trend_score、"
        "trend_conclusion、confidence、condition_checks、signal 與 reason_points。"
    ),
    status_code=status.HTTP_200_OK,
    responses={
        200: {"description": "成功回傳核心判斷"},
        400: {"description": "請求參數錯誤"},
        500: {"description": "伺服器內部錯誤"},
    },
)
async def core_mode_decision(req: CoreDecisionRequest):
    market_service = get_market_snapshot_service()
    decision_service = get_core_decision_service()
    as_of_date = req.as_of_date or date.today()
    try:
        snapshot = await market_service.get_snapshot(symbol=req.symbol, as_of_date=as_of_date)
        decision = decision_service.build_decision(
            snapshot=snapshot,
            as_of_date=as_of_date,
            preset_id=req.preset_id,
            use_active_preset=req.use_active_preset,
        )
        return decision
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("core decision failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="core decision 失敗")


@router.post(
    "/core-mode/backtest-snapshot",
    summary="取得 Core Mode 回測快照",
    description=(
        "Domain API：優先回傳快取中的回測可信度與圖表摘要。"
        "若 cache miss，立即回傳 pending 並在背景計算，完成後可由 Advisor stream 收到 core_backtest_ready。"
    ),
    status_code=status.HTTP_200_OK,
    responses={
        200: {
            "description": "成功（可能為 ready 或 pending）",
            "content": {
                "application/json": {
                    "examples": {
                        "ready": {
                            "summary": "快取命中，立即回傳 ready",
                            "value": {
                                "status": "ready",
                                "cache_hit": True,
                                "cache_key": "2330|preset_001|2026-04-26|1y|rolling_walk_forward",
                                "symbol": "2330",
                                "preset_id": "preset_001",
                                "as_of_date": "2026-04-26",
                                "window_spec": "1y",
                                "validation_mode": "rolling_walk_forward",
                                "credibility_summary": {
                                    "ac": 0.61,
                                    "win_rate": 0.54,
                                    "max_drawdown": 0.12,
                                    "stability": 0.58,
                                    "expectancy": 0.03,
                                    "future_trend_quality": 0.57,
                                    "cumulative_return": 0.18,
                                    "trade_count": 42
                                },
                                "price_chart": {},
                                "equity_curve": [],
                                "benchmark_curve": [],
                                "drawdown_curve": [],
                                "walk_forward_summary": {},
                                "regime_summary": [],
                                "trade_preview": []
                            },
                        },
                        "pending": {
                            "summary": "尚未完成，先回傳 pending",
                            "value": {
                                "status": "pending",
                                "cache_hit": False,
                                "cache_key": "2330|preset_001|2026-04-26|1y|rolling_walk_forward",
                                "symbol": "2330",
                                "as_of_date": "2026-04-26",
                                "window_spec": "1y",
                                "validation_mode": "rolling_walk_forward"
                            },
                        },
                    }
                }
            },
        },
        400: {"description": "請求參數錯誤"},
        500: {"description": "伺服器內部錯誤"},
    },
)
async def core_mode_backtest_snapshot(req: BacktestSnapshotRequest) -> BacktestSnapshotReadyResponse | BacktestSnapshotPendingResponse | dict[str, Any]:
    service = get_backtest_snapshot_service()
    as_of_date = req.as_of_date or date.today()
    symbol = req.symbol.strip().upper()
    try:
        cached = service.get_cached_snapshot(
            symbol=symbol,
            as_of_date=as_of_date,
            preset_id=req.preset_id,
            use_active_preset=req.use_active_preset,
            window_spec=req.window_spec,
            validation_mode=req.validation_mode,
        )
        if cached:
            return cached

        cache_key, _ = service.enqueue_snapshot(
            symbol=symbol,
            as_of_date=as_of_date,
            preset_id=req.preset_id,
            use_active_preset=req.use_active_preset,
            window_spec=req.window_spec,
            validation_mode=req.validation_mode,
            rolling_settings=req.rolling_settings.model_dump(mode="json") if req.rolling_settings else None,
            holdout_settings=req.holdout_settings.model_dump(mode="json") if req.holdout_settings else None,
        )
        return BacktestSnapshotPendingResponse(
            status="pending",
            cache_hit=False,
            cache_key=cache_key,
            symbol=symbol,
            as_of_date=as_of_date.isoformat(),
            window_spec=req.window_spec,
            validation_mode=req.validation_mode,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception:
        logger.exception("core backtest snapshot failed")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="backtest snapshot 失敗")
