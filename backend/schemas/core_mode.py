from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class CoreModeDateRange(BaseModel):
    start_date: date = Field(..., description="回測起始日期")
    end_date: date = Field(..., description="回測結束日期")


class CoreModeRollingSettings(BaseModel):
    step_days: Optional[int] = Field(None, ge=1, description="walk-forward 滑動步長（交易日）")
    min_overlap_ratio: Optional[float] = Field(None, ge=0.0, le=1.0, description="最小重疊比例")


class CoreModeHoldoutSettings(BaseModel):
    enabled: bool = Field(True, description="是否保留 final holdout")
    holdout_days: Optional[int] = Field(None, ge=20, description="holdout 交易日數")


class CoreModeParamsInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    breakout_lookback: Optional[int] = Field(None, ge=10, le=90)
    momentum_window: Optional[int] = Field(None, ge=5, le=60)
    state_threshold: Optional[float] = Field(None, ge=0.05, le=0.60)
    shape_threshold: Optional[float] = Field(None, ge=0.05, le=0.60)
    trend_threshold: Optional[float] = Field(None, ge=0.05, le=0.80)
    max_pullback_depth: Optional[float] = Field(None, ge=0.03, le=0.40)
    hard_stop_pct: Optional[float] = Field(None, ge=0.01, le=0.30)
    trailing_stop_pct: Optional[float] = Field(None, ge=0.01, le=0.30)
    technical_ma_weight: Optional[float] = Field(None, ge=0.0)
    technical_macd_weight: Optional[float] = Field(None, ge=0.0)
    technical_rsi_weight: Optional[float] = Field(None, ge=0.0)
    technical_kd_weight: Optional[float] = Field(None, ge=0.0)
    weighted_technical_weight: Optional[float] = Field(None, ge=0.0)
    weighted_institutional_weight: Optional[float] = Field(None, ge=0.0)
    weighted_news_weight: Optional[float] = Field(None, ge=0.0)
    weighted_momentum_weight: Optional[float] = Field(None, ge=0.0)
    state_weighted_score_weight: Optional[float] = Field(None, ge=0.0)
    state_momentum_weight: Optional[float] = Field(None, ge=0.0)
    state_institutional_weight: Optional[float] = Field(None, ge=0.0)
    trend_state_weight: Optional[float] = Field(None, ge=0.0)
    trend_shape_weight: Optional[float] = Field(None, ge=0.0)
    trend_breakout_weight: Optional[float] = Field(None, ge=0.0)
    shape_breakout_weight: Optional[float] = Field(None, ge=0.0)
    shape_slope_weight: Optional[float] = Field(None, ge=0.0)
    shape_efficiency_weight: Optional[float] = Field(None, ge=0.0)
    shape_pullback_weight: Optional[float] = Field(None, ge=0.0)


class TimeSeriesMLSettingsInput(BaseModel):
    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    enabled: bool = Field(False, description="是否啟用 TimeSeriesSplit 規則型驗證")
    enable_model_training: bool = Field(False, description="是否啟用 baseline 模型訓練（Phase 4）")
    n_splits: Optional[int] = Field(None, ge=2, description="TimeSeriesSplit fold 數")
    test_size: Optional[int] = Field(None, ge=1, description="每個 fold 的測試樣本數")
    gap: Optional[int] = Field(None, ge=0, description="train/test 間隔")
    max_train_size: Optional[int] = Field(None, ge=1, description="每個 fold 最多訓練樣本數")
    prediction_horizon: Optional[int] = Field(None, ge=1, description="預測窗；若大於 gap 會自動提高 effective_gap")
    future_quality_threshold: Optional[float] = Field(
        None,
        ge=0.0,
        le=1.0,
        description="future_quality target 判定門檻",
    )
    target_mode: Optional[Literal["future_quality", "trade_return", "trend_label"]] = None
    model_type: Optional[Literal["random_forest", "gradient_boosting", "logistic_regression"]] = None
    scoring_mode: Optional[Literal["accuracy", "f1", "return_score", "balanced_backtest_score"]] = None
    enable_candidate_ranking: Optional[bool] = Field(
        None,
        description="是否啟用 ML 輔助 candidate ranking",
    )
    candidate_ranking_top_n: Optional[int] = Field(
        None,
        ge=1,
        le=20,
        description="ML candidate ranking 的正式回測候選數量上限",
    )
    candidate_ranking_model_type: Optional[Literal["random_forest", "gradient_boosting", "logistic_regression"]] = None
    candidate_ranking_score_mode: Optional[Literal["balanced_score", "return_score", "ac_score", "drawdown_score"]] = None


class AutoSearchSettingsInput(BaseModel):
    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    enabled: bool = Field(False, description="是否啟用自動最佳參數搜尋")
    mode: Optional[Literal["single_stock_search", "multi_stock_search"]] = None
    symbols: Optional[list[str]] = None
    top_n: Optional[int] = Field(None, ge=1, le=20)
    candidate_pool_size: Optional[int] = Field(None, ge=50, le=1000)
    ml_prefilter_top_n: Optional[int] = Field(None, ge=1, le=1000)
    final_verify_top_n: Optional[int] = Field(None, ge=1, le=1000)
    score_mode: Optional[Literal["balanced_score", "return_score", "low_drawdown_score", "stable_score"]] = None
    use_ml_prefilter: Optional[bool] = None
    use_time_series_validation: Optional[bool] = None
    use_holdout_validation: Optional[bool] = None
    require_min_trade_count: Optional[bool] = None
    min_trade_count: Optional[int] = Field(None, ge=1)
    max_runtime_level: Optional[Literal["balanced", "deep"]] = None
    adaptive_search_settings: Optional["AdaptiveSearchSettingsInput"] = None
    final_holdout_settings: Optional["FinalHoldoutSettingsInput"] = None


class FinalHoldoutSettingsInput(BaseModel):
    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    enabled: Optional[bool] = None
    mode: Optional[Literal["ratio", "days"]] = None
    train_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    validation_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    final_holdout_ratio: Optional[float] = Field(None, ge=0.0, le=1.0)
    final_holdout_days: Optional[int] = Field(None, ge=1)
    min_final_holdout_days: Optional[int] = Field(None, ge=1)


class AdaptiveSearchSettingsInput(BaseModel):
    model_config = ConfigDict(extra="ignore", protected_namespaces=())

    enabled: Optional[bool] = None
    max_iterations: Optional[int] = Field(None, ge=1, le=10)
    candidates_per_iteration: Optional[int] = Field(None, ge=50, le=1000)
    verify_top_n_per_iteration: Optional[int] = Field(None, ge=1, le=1000)
    keep_elite_n: Optional[int] = Field(None, ge=1, le=1000)
    patience: Optional[int] = Field(None, ge=1, le=5)
    min_improvement: Optional[float] = Field(None, ge=0.0, le=0.1)
    use_ml_prefilter: Optional[bool] = None
    refinement_strength: Optional[Literal["small", "medium", "large"]] = None
    stop_when_score_reaches: Optional[float] = Field(None, ge=0.0, le=1.0)


class CoreModeRunRequest(BaseModel):
    symbol: str = Field(..., description="股票代號")
    date_range: CoreModeDateRange
    params: Optional[CoreModeParamsInput] = Field(None, description="核心模式參數與權重")
    validation_mode: Literal["rolling_walk_forward", "expanding_walk_forward"] = Field(
        "rolling_walk_forward", description="驗證模式"
    )
    rolling_settings: Optional[CoreModeRollingSettings] = None
    holdout_settings: Optional[CoreModeHoldoutSettings] = None
    run_optimization: bool = Field(True, description="是否啟用 coarse + refinement 參數搜尋")
    ml_settings: Optional[TimeSeriesMLSettingsInput] = None
    auto_search_settings: Optional[AutoSearchSettingsInput] = None


class CoreModePresetSaveRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=60, description="preset 名稱")
    description: str = Field("", max_length=240, description="preset 說明")
    params: CoreModeParamsInput = Field(..., description="核心模式參數與權重")
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
