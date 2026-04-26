from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Optional

TrendConclusion = Literal["偏多", "偏空", "偏震盪", "趨勢不明"]
ConfidenceLevel = Literal["高", "中", "低"]
SignalPhase = Literal["early", "formal"]


@dataclass(frozen=True)
class CoreModeParams:
    breakout_lookback: int = 30
    momentum_window: int = 20
    state_threshold: float = 0.15
    shape_threshold: float = 0.15
    trend_threshold: float = 0.18
    max_pullback_depth: float = 0.12
    hard_stop_pct: float = 0.08
    trailing_stop_pct: float = 0.10


DEFAULT_CORE_MODE_PARAMS = CoreModeParams()

CORE_MODE_PARAM_SCHEMA: dict[str, dict[str, Any]] = {
    "breakout_lookback": {
        "label": "突破回看天數",
        "description": "判定是否突破前高時使用的回看天數",
        "min": 10,
        "max": 90,
        "step": 1,
        "default": DEFAULT_CORE_MODE_PARAMS.breakout_lookback,
    },
    "momentum_window": {
        "label": "動能視窗",
        "description": "量價動能與效率計算視窗長度",
        "min": 5,
        "max": 60,
        "step": 1,
        "default": DEFAULT_CORE_MODE_PARAMS.momentum_window,
    },
    "state_threshold": {
        "label": "狀態門檻",
        "description": "state score 達標門檻",
        "min": 0.05,
        "max": 0.60,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.state_threshold,
    },
    "shape_threshold": {
        "label": "型態門檻",
        "description": "trend shape score 達標門檻",
        "min": 0.05,
        "max": 0.60,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.shape_threshold,
    },
    "trend_threshold": {
        "label": "綜合趨勢門檻",
        "description": "trend score 達標門檻",
        "min": 0.05,
        "max": 0.80,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.trend_threshold,
    },
    "max_pullback_depth": {
        "label": "最大容許拉回",
        "description": "趨勢中可接受的拉回深度",
        "min": 0.03,
        "max": 0.40,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.max_pullback_depth,
    },
    "hard_stop_pct": {
        "label": "硬停損",
        "description": "單筆交易硬停損比例",
        "min": 0.01,
        "max": 0.30,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.hard_stop_pct,
    },
    "trailing_stop_pct": {
        "label": "移動停損",
        "description": "追蹤停損比例",
        "min": 0.01,
        "max": 0.30,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.trailing_stop_pct,
    },
}


@dataclass
class MarketRow:
    date: date
    open: float
    high: float
    low: float
    close: float
    volume: float
    ma5: Optional[float] = None
    ma20: Optional[float] = None
    ma60: Optional[float] = None
    rsi14: Optional[float] = None
    k_value: Optional[float] = None
    d_value: Optional[float] = None
    macd: Optional[float] = None
    macd_signal: Optional[float] = None
    macd_hist: Optional[float] = None
    total_net: Optional[float] = None
    news_score: float = 0.0


@dataclass
class FeatureRow:
    date: date
    close: float
    breakout_line: float
    breakout_strength: float
    return_window: float
    volume_ratio: float
    trend_efficiency: float
    pullback_depth: float
    technical_score: float
    institutional_score: float
    momentum_score: float
    news_score: float
    weighted_score: float


@dataclass
class ScoreRow:
    date: date
    state_score: float
    trend_shape_score: float
    trend_score: float
    breakout_pass: bool
    pullback_ok: bool
    acceptable_shape: bool


@dataclass
class SignalRow:
    date: date
    trend_conclusion: TrendConclusion
    confidence_level: ConfidenceLevel
    early_signal: Optional[str]
    formal_signal: Optional[str]
    is_trend_candidate: bool
    reason_points: list[str] = field(default_factory=list)


@dataclass
class TradeRecord:
    entry_signal_date: date
    entry_date: date
    exit_signal_date: date
    exit_date: date
    entry_price: float
    exit_price: float
    return_pct: float
    holding_days: int
    mfe: float
    mae: float
    entry_reason: str
    exit_reason: str


@dataclass
class BacktestSummary:
    ac: float
    win_rate: float
    expectancy: float
    profit_factor: float
    cumulative_return: float
    max_drawdown: float
    trade_count: int
    avg_mfe: float
    avg_mae: float
    future_trend_quality: float
    stability: float


@dataclass
class RegimeBucketSummary:
    regime: str
    sample_count: int
    candidate_count: int
    ac: float
    win_rate: float
    future_trend_quality: float


@dataclass
class WalkForwardFoldSummary:
    fold_id: str
    overlap_ratio: float
    train_start: date
    train_end: date
    validation_start: date
    validation_end: date
    test_start: date
    test_end: date
    validation_metrics: BacktestSummary
    test_metrics: BacktestSummary


def clip(value: float, low: float = -1.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def _coerce_float(value: Any, default: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return default
    if parsed != parsed:  # NaN
        return default
    return parsed


def _coerce_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_core_mode_params(raw: Optional[dict[str, Any]]) -> CoreModeParams:
    raw = raw or {}

    def _norm_int(key: str) -> int:
        cfg = CORE_MODE_PARAM_SCHEMA[key]
        value = _coerce_int(raw.get(key), int(cfg["default"]))
        return max(int(cfg["min"]), min(int(cfg["max"]), value))

    def _norm_float(key: str) -> float:
        cfg = CORE_MODE_PARAM_SCHEMA[key]
        value = _coerce_float(raw.get(key), float(cfg["default"]))
        return round(max(float(cfg["min"]), min(float(cfg["max"]), value)), 4)

    return CoreModeParams(
        breakout_lookback=_norm_int("breakout_lookback"),
        momentum_window=_norm_int("momentum_window"),
        state_threshold=_norm_float("state_threshold"),
        shape_threshold=_norm_float("shape_threshold"),
        trend_threshold=_norm_float("trend_threshold"),
        max_pullback_depth=_norm_float("max_pullback_depth"),
        hard_stop_pct=_norm_float("hard_stop_pct"),
        trailing_stop_pct=_norm_float("trailing_stop_pct"),
    )


def params_to_dict(params: CoreModeParams) -> dict[str, Any]:
    return {
        "breakout_lookback": params.breakout_lookback,
        "momentum_window": params.momentum_window,
        "state_threshold": params.state_threshold,
        "shape_threshold": params.shape_threshold,
        "trend_threshold": params.trend_threshold,
        "max_pullback_depth": params.max_pullback_depth,
        "hard_stop_pct": params.hard_stop_pct,
        "trailing_stop_pct": params.trailing_stop_pct,
    }
