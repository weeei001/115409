from __future__ import annotations

from datetime import date
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from schemas.core_mode import CoreModeHoldoutSettings, CoreModeRollingSettings


class ConditionCheckItem(BaseModel):
    key: str = Field(..., description="規則檢查鍵值")
    label: str = Field(..., description="規則檢查顯示名稱")
    passed: bool = Field(..., description="是否通過")
    status: Optional[str] = Field(default=None, description="檢查狀態文字")
    value: Optional[float | str | bool] = Field(default=None, description="實際數值")
    threshold: Optional[float | str | bool] = Field(default=None, description="門檻值")


class CoreDecisionRequest(BaseModel):
    symbol: str = Field(..., description="台股股票代號（例如 2330）", examples=["2330"])
    as_of_date: Optional[date] = Field(None, description="分析基準日（YYYY-MM-DD）")
    preset_id: Optional[str] = Field(None, description="指定 preset ID；未提供時可使用 active preset")
    use_active_preset: bool = Field(True, description="是否使用 active preset")


class BacktestSnapshotRequest(BaseModel):
    symbol: str = Field(..., description="台股股票代號（例如 2330）", examples=["2330"])
    as_of_date: Optional[date] = Field(None, description="分析基準日（YYYY-MM-DD）")
    preset_id: Optional[str] = Field(None, description="指定 preset ID；未提供時可使用 active preset")
    use_active_preset: bool = Field(True, description="是否使用 active preset")
    window_spec: str = Field("1y", description="回測視窗，例如 1y / 6m / 180d")
    validation_mode: Literal["rolling_walk_forward", "expanding_walk_forward"] = Field(
        "rolling_walk_forward",
        description="驗證模式",
    )
    rolling_settings: Optional[CoreModeRollingSettings] = Field(default=None, description="rolling walk-forward 設定")
    holdout_settings: Optional[CoreModeHoldoutSettings] = Field(default=None, description="holdout 設定")


class AdvisorOverviewRequest(BacktestSnapshotRequest):
    pass


class PresetSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    params: dict[str, Any] = Field(default_factory=dict)


class TechnicalSnapshot(BaseModel):
    date: Optional[str] = None
    ma5: Optional[float] = None
    ma20: Optional[float] = None
    ma60: Optional[float] = None
    rsi14: Optional[float] = None
    macd_hist: Optional[float] = None


class InstitutionalSnapshot(BaseModel):
    date: Optional[str] = None
    foreign_net: Optional[float] = None
    trust_net: Optional[float] = None
    dealer_net: Optional[float] = None
    total_net: Optional[float] = None


class CredibilitySummary(BaseModel):
    ac: float = Field(0.0, description="準確率（0~1）")
    win_rate: float = Field(0.0, description="勝率（0~1）")
    max_drawdown: float = Field(0.0, description="最大回撤（0~1）")
    stability: float = Field(0.0, description="穩定度（0~1）")
    expectancy: float = Field(0.0, description="期望值")
    future_trend_quality: float = Field(0.0, description="未來趨勢品質分數")
    cumulative_return: float = Field(0.0, description="累積報酬（0~1）")
    trade_count: int = Field(0, description="交易筆數")


class AdvisorReportJobRef(BaseModel):
    job_id: str = Field(..., description="完整報告背景工作 ID")
    status: str = Field(..., description="工作狀態")


class AdvisorOverviewResponse(BaseModel):
    request_id: str = Field(..., description="Experience API 流程請求 ID")
    job_id: str = Field(..., description="完整報告背景工作 ID")
    advisor_report_status: str = Field(..., description="完整報告目前狀態")
    symbol: str = Field(..., description="股票代號")
    as_of_date: str = Field(..., description="分析基準日（YYYY-MM-DD）")
    active_preset: Optional[PresetSummary] = Field(default=None, description="目前使用的 preset")
    trend_conclusion: str = Field(..., description="核心趨勢結論")
    confidence_level: str = Field(..., description="核心信心等級")
    condition_checks: list[ConditionCheckItem] = Field(default_factory=list, description="規則檢查結果")
    reason_points: list[str] = Field(default_factory=list, description="核心理由點")
    rule_summary: list[str] = Field(default_factory=list, description="規則模板摘要（不經 LLM）")
    technical_snapshot: TechnicalSnapshot = Field(default_factory=TechnicalSnapshot, description="技術面快照")
    institutional_snapshot: InstitutionalSnapshot = Field(default_factory=InstitutionalSnapshot, description="籌碼面快照")
    technical_history: list[dict[str, Any]] = Field(default_factory=list, description="技術歷史資料（最多近 30 筆）")
    institutional_history: list[dict[str, Any]] = Field(default_factory=list, description="籌碼歷史資料（最多近 30 筆）")
    price_chart: dict[str, Any] = Field(default_factory=dict, description="主圖資料（K 線、均線、標記）")
    credibility_summary: Optional[CredibilitySummary] = Field(default=None, description="若有快取命中，回傳回測可信度摘要")
    backtest_snapshot_status: Literal["ready", "pending"] = Field(..., description="回測快照狀態")
    advisor_report_job: AdvisorReportJobRef = Field(..., description="完整報告背景工作資訊")


class CoreDecisionResponse(BaseModel):
    symbol: str
    as_of_date: str
    active_preset: Optional[PresetSummary] = None
    preset_id: Optional[str] = None
    state_score: float
    trend_shape_score: float
    trend_score: float
    weighted_score: float
    trend_conclusion: str
    confidence_level: str
    condition_checks: list[ConditionCheckItem] = Field(default_factory=list)
    early_signal_status: Optional[str] = None
    formal_signal_status: Optional[str] = None
    reason_points: list[str] = Field(default_factory=list)
    risk_notes: list[str] = Field(default_factory=list)
    action_suggestion: Optional[str] = None
    conclusion_summary: Optional[str] = None
    reasoning: dict[str, Any] = Field(default_factory=dict)
    technical_snapshot: TechnicalSnapshot = Field(default_factory=TechnicalSnapshot)
    institutional_snapshot: InstitutionalSnapshot = Field(default_factory=InstitutionalSnapshot)
    price_chart: dict[str, Any] = Field(default_factory=dict)


class BacktestSnapshotPendingResponse(BaseModel):
    status: Literal["pending"] = "pending"
    cache_hit: bool = False
    cache_key: str
    symbol: str
    as_of_date: str
    window_spec: str
    validation_mode: str


class BacktestSnapshotReadyResponse(BaseModel):
    status: Literal["ready"] = "ready"
    cache_hit: bool
    cache_key: str
    symbol: str
    preset_id: str
    as_of_date: str
    window_spec: str
    validation_mode: str
    credibility_summary: CredibilitySummary
    price_chart: dict[str, Any] = Field(default_factory=dict)
    equity_curve: list[dict[str, Any]] = Field(default_factory=list)
    benchmark_curve: list[dict[str, Any]] = Field(default_factory=list)
    drawdown_curve: list[dict[str, Any]] = Field(default_factory=list)
    walk_forward_summary: dict[str, Any] = Field(default_factory=dict)
    regime_summary: list[dict[str, Any]] = Field(default_factory=list)
    trade_preview: list[dict[str, Any]] = Field(default_factory=list)


class AdvisorReportJobRequest(BaseModel):
    symbol: str = Field(..., description="台股股票代號（例如 2330）", examples=["2330"])
    as_of_date: Optional[date] = Field(None, description="分析基準日（YYYY-MM-DD）")


class AdvisorReportJobResponse(BaseModel):
    job_id: str = Field(..., description="完整報告工作 ID")
    symbol: str = Field(..., description="股票代號")
    as_of_date: str = Field(..., description="分析基準日")
    status: str = Field(..., description="工作狀態")
    created_at: str = Field(..., description="建立時間（UTC ISO 格式）")
    updated_at: str = Field(..., description="更新時間（UTC ISO 格式）")
    rule_summary: Optional[list[str]] = Field(default=None, description="規則模板摘要")
    news: Optional[dict[str, Any]] = Field(default=None, description="新聞/RAG 整理結果")
    full_report: Optional[dict[str, Any]] = Field(default=None, description="完整 AI 報告結果")
    error: Optional[str] = Field(default=None, description="失敗訊息")
