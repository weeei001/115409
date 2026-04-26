from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class CoreModeDateRange(BaseModel):
    start_date: date = Field(..., description="回測起始日期")
    end_date: date = Field(..., description="回測結束日期")


class CoreModeRollingSettings(BaseModel):
    step_days: Optional[int] = Field(None, ge=1, description="walk-forward 滑動步長（交易日）")
    min_overlap_ratio: Optional[float] = Field(None, ge=0.0, le=1.0, description="最小重疊比例")


class CoreModeHoldoutSettings(BaseModel):
    enabled: bool = Field(True, description="是否保留 final holdout")
    holdout_days: Optional[int] = Field(None, ge=20, description="holdout 交易日數")


class CoreModeRunRequest(BaseModel):
    symbol: str = Field(..., description="股票代號")
    date_range: CoreModeDateRange
    params: Optional[dict[str, Any]] = Field(None, description="8 個核心參數")
    validation_mode: Literal["rolling_walk_forward", "expanding_walk_forward"] = Field(
        "rolling_walk_forward", description="驗證模式"
    )
    rolling_settings: Optional[CoreModeRollingSettings] = None
    holdout_settings: Optional[CoreModeHoldoutSettings] = None
    run_optimization: bool = Field(True, description="是否啟用 coarse + refinement 參數搜尋")


class CoreModePresetSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60, description="preset 名稱")
    description: str = Field("", max_length=240, description="preset 說明")
    params: dict[str, Any] = Field(..., description="8 個核心參數")
    preset_id: Optional[str] = Field(None, description="若提供則更新既有 preset")


class ActivatePresetResponse(BaseModel):
    active_preset_id: str
    active_preset: Optional[dict[str, Any]] = None
    presets: list[dict[str, Any]] = Field(default_factory=list)


class ApplyActivePresetRequest(BaseModel):
    symbol: str = Field(..., description="股票代號")
    as_of_date: Optional[date] = Field(None, description="分析基準日，預設今天")


class CoreModeGenericResponse(BaseModel):
    data: dict[str, Any]
