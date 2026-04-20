from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field

BacktestMode = Literal["hybrid", "score_only", "llm_full"]
WalkForwardFrequency = Literal["quarterly", "monthly"]


class BacktestRunRequest(BaseModel):
    symbol: str = Field(..., description="Stock symbol, e.g. 2330")
    start_date: date = Field(..., description="Backtest start date")
    end_date: date = Field(..., description="Backtest end date")
    horizon: int = Field(20, ge=1, le=120, description="Prediction horizon in trading days")
    lookback_days: int = Field(30, ge=5, le=365, description="Feature lookback window in calendar days")
    mode: BacktestMode = Field("hybrid", description="Backtest mode")
    llm_sample_size: int = Field(20, ge=0, le=500, description="Sample size for hybrid mode")
    walk_forward: WalkForwardFrequency = Field("quarterly", description="Walk-forward segment frequency")


class BacktestMetrics(BaseModel):
    sample_count: int = 0
    correct_count: int = 0
    accuracy: float = 0.0
    precision_buy: float = 0.0
    recall_buy: float = 0.0
    f1_buy: float = 0.0
    tp: int = 0
    fp: int = 0
    fn: int = 0
    tn: int = 0
    coverage: float = 1.0


class BacktestSegmentResult(BaseModel):
    segment_id: str
    start_date: date
    end_date: date
    metrics: BacktestMetrics


class LLMConsistencyResult(BaseModel):
    sampled_count: int = 0
    compared_count: int = 0
    matched_count: int = 0
    consistency_rate: float = 0.0
    llm_coverage: float = 0.0


class BacktestRunResult(BaseModel):
    run_id: str
    status: Literal["completed", "running", "failed"] = "completed"
    config: BacktestRunRequest
    started_at: datetime
    finished_at: Optional[datetime] = None
    overall: BacktestMetrics
    segments: list[BacktestSegmentResult] = Field(default_factory=list)
    llm_consistency: Optional[LLMConsistencyResult] = None
    notes: list[str] = Field(default_factory=list)
