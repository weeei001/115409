from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from typing import Any, Literal, Optional

TrendConclusion = Literal["偏多", "偏空", "偏震盪", "趨勢不明"]
ConfidenceLevel = Literal["高", "中", "低"]
SignalPhase = Literal["early", "formal"]
MlTargetMode = Literal["future_quality", "trade_return", "trend_label"]
MlModelType = Literal["random_forest", "gradient_boosting", "logistic_regression"]
MlScoringMode = Literal["accuracy", "f1", "return_score", "balanced_backtest_score"]
MlCandidateRankingScoreMode = Literal["balanced_score", "return_score", "ac_score", "drawdown_score"]
MlValidationMode = Literal["time_series_split_rule_based"]
AutoSearchMode = Literal["single_stock_search", "multi_stock_search"]
AutoSearchScoreMode = Literal["balanced_score", "return_score", "low_drawdown_score", "stable_score"]
AutoSearchRuntimeLevel = Literal["balanced", "deep"]
AdaptiveRefinementStrength = Literal["small", "medium", "large"]
FinalHoldoutMode = Literal["ratio", "days"]


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
    technical_ma_weight: float = 0.40
    technical_macd_weight: float = 0.25
    technical_rsi_weight: float = 0.20
    technical_kd_weight: float = 0.15
    weighted_technical_weight: float = 0.38
    weighted_institutional_weight: float = 0.30
    weighted_news_weight: float = 0.15
    weighted_momentum_weight: float = 0.17
    state_weighted_score_weight: float = 0.55
    state_momentum_weight: float = 0.25
    state_institutional_weight: float = 0.20
    trend_state_weight: float = 0.45
    trend_shape_weight: float = 0.35
    trend_breakout_weight: float = 0.20
    shape_breakout_weight: float = 0.35
    shape_slope_weight: float = 0.25
    shape_efficiency_weight: float = 0.25
    shape_pullback_weight: float = 0.15


@dataclass(frozen=True)
class TimeSeriesMLSettings:
    enabled: bool = False
    enable_model_training: bool = False
    n_splits: int = 5
    test_size: int = 60
    gap: int = 20
    max_train_size: Optional[int] = None
    prediction_horizon: int = 20
    future_quality_threshold: float = 0.55
    target_mode: MlTargetMode = "future_quality"
    model_type: MlModelType = "random_forest"
    scoring_mode: MlScoringMode = "balanced_backtest_score"
    enable_candidate_ranking: bool = False
    candidate_ranking_top_n: int = 5
    candidate_ranking_model_type: MlModelType = "random_forest"
    candidate_ranking_score_mode: MlCandidateRankingScoreMode = "balanced_score"


@dataclass(frozen=True)
class AdaptiveSearchSettings:
    enabled: bool = False
    max_iterations: int = 5
    candidates_per_iteration: int = 300
    verify_top_n_per_iteration: int = 50
    keep_elite_n: int = 10
    patience: int = 2
    min_improvement: float = 0.01
    use_ml_prefilter: bool = True
    refinement_strength: AdaptiveRefinementStrength = "medium"
    stop_when_score_reaches: Optional[float] = None


@dataclass(frozen=True)
class FinalHoldoutSettings:
    enabled: bool = True
    mode: FinalHoldoutMode = "ratio"
    train_ratio: float = 0.60
    validation_ratio: float = 0.20
    final_holdout_ratio: float = 0.20
    final_holdout_days: Optional[int] = None
    min_final_holdout_days: int = 20


@dataclass(frozen=True)
class AutoSearchSettings:
    enabled: bool = False
    mode: AutoSearchMode = "single_stock_search"
    symbols: tuple[str, ...] = ()
    top_n: int = 10
    candidate_pool_size: int = 300
    ml_prefilter_top_n: int = 80
    final_verify_top_n: int = 30
    score_mode: AutoSearchScoreMode = "balanced_score"
    use_ml_prefilter: bool = True
    use_time_series_validation: bool = True
    use_holdout_validation: bool = True
    require_min_trade_count: bool = True
    min_trade_count: int = 10
    max_runtime_level: AutoSearchRuntimeLevel = "balanced"
    adaptive_search_settings: AdaptiveSearchSettings = field(default_factory=AdaptiveSearchSettings)
    final_holdout_settings: FinalHoldoutSettings = field(default_factory=FinalHoldoutSettings)


DEFAULT_CORE_MODE_PARAMS = CoreModeParams()
DEFAULT_TIME_SERIES_ML_SETTINGS = TimeSeriesMLSettings()
DEFAULT_AUTO_SEARCH_SETTINGS = AutoSearchSettings()

TECHNICAL_WEIGHT_KEYS = (
    "technical_ma_weight",
    "technical_macd_weight",
    "technical_rsi_weight",
    "technical_kd_weight",
)
WEIGHTED_SCORE_WEIGHT_KEYS = (
    "weighted_technical_weight",
    "weighted_institutional_weight",
    "weighted_news_weight",
    "weighted_momentum_weight",
)
STATE_SCORE_WEIGHT_KEYS = (
    "state_weighted_score_weight",
    "state_momentum_weight",
    "state_institutional_weight",
)
TREND_SCORE_WEIGHT_KEYS = (
    "trend_state_weight",
    "trend_shape_weight",
    "trend_breakout_weight",
)
SHAPE_SCORE_WEIGHT_KEYS = (
    "shape_breakout_weight",
    "shape_slope_weight",
    "shape_efficiency_weight",
    "shape_pullback_weight",
)

CORE_MODE_BASE_PARAM_KEYS = (
    "breakout_lookback",
    "momentum_window",
    "state_threshold",
    "shape_threshold",
    "trend_threshold",
    "max_pullback_depth",
    "hard_stop_pct",
    "trailing_stop_pct",
)

CORE_MODE_WEIGHT_GROUPS: dict[str, tuple[str, ...]] = {
    "technical_score": TECHNICAL_WEIGHT_KEYS,
    "weighted_score": WEIGHTED_SCORE_WEIGHT_KEYS,
    "state_score": STATE_SCORE_WEIGHT_KEYS,
    "trend_score": TREND_SCORE_WEIGHT_KEYS,
    "trend_shape_score": SHAPE_SCORE_WEIGHT_KEYS,
}

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
    "technical_ma_weight": {
        "label": "MA 權重",
        "description": "technical score 中 MA 分數的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.technical_ma_weight,
    },
    "technical_macd_weight": {
        "label": "MACD 權重",
        "description": "technical score 中 MACD 分數的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.technical_macd_weight,
    },
    "technical_rsi_weight": {
        "label": "RSI 權重",
        "description": "technical score 中 RSI 分數的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.technical_rsi_weight,
    },
    "technical_kd_weight": {
        "label": "KD 權重",
        "description": "technical score 中 KD 分數的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.technical_kd_weight,
    },
    "weighted_technical_weight": {
        "label": "技術分數權重",
        "description": "weighted score 中 technical score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.weighted_technical_weight,
    },
    "weighted_institutional_weight": {
        "label": "法人分數權重",
        "description": "weighted score 中 institutional score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.weighted_institutional_weight,
    },
    "weighted_news_weight": {
        "label": "新聞分數權重",
        "description": "weighted score 中 news score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.weighted_news_weight,
    },
    "weighted_momentum_weight": {
        "label": "動能分數權重",
        "description": "weighted score 中 momentum score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.weighted_momentum_weight,
    },
    "state_weighted_score_weight": {
        "label": "state 中 weighted 權重",
        "description": "state score 中 weighted score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.state_weighted_score_weight,
    },
    "state_momentum_weight": {
        "label": "state 中動能權重",
        "description": "state score 中 momentum score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.state_momentum_weight,
    },
    "state_institutional_weight": {
        "label": "state 中法人權重",
        "description": "state score 中 institutional score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.state_institutional_weight,
    },
    "trend_state_weight": {
        "label": "trend 中 state 權重",
        "description": "trend score 中 state score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.trend_state_weight,
    },
    "trend_shape_weight": {
        "label": "trend 中型態權重",
        "description": "trend score 中 trend shape score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.trend_shape_weight,
    },
    "trend_breakout_weight": {
        "label": "trend 中突破權重",
        "description": "trend score 中 breakout strength 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.trend_breakout_weight,
    },
    "shape_breakout_weight": {
        "label": "型態中突破權重",
        "description": "trend shape score 中 breakout strength 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.shape_breakout_weight,
    },
    "shape_slope_weight": {
        "label": "型態中斜率權重",
        "description": "trend shape score 中 MA20 slope score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.shape_slope_weight,
    },
    "shape_efficiency_weight": {
        "label": "型態中效率權重",
        "description": "trend shape score 中 trend efficiency score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.shape_efficiency_weight,
    },
    "shape_pullback_weight": {
        "label": "型態中拉回權重",
        "description": "trend shape score 中 pullback score 的權重",
        "min": 0.0,
        "max": 1.0,
        "step": 0.01,
        "default": DEFAULT_CORE_MODE_PARAMS.shape_pullback_weight,
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


@dataclass
class TimeSeriesFoldMetric:
    fold_index: int
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    gap: int
    effective_gap: int
    ac: float
    win_rate: float
    cumulative_return: float
    max_drawdown: float
    trade_count: int
    profit_factor: float
    expectancy: float


@dataclass
class TimeSeriesAggregateMetrics:
    fold_ac_mean: float
    fold_ac_std: float
    fold_return_mean: float
    fold_return_std: float
    fold_mdd_mean: float
    fold_mdd_std: float
    fold_trade_count_mean: float
    stability_score: float


@dataclass
class MlModelFoldMetric:
    fold_index: int
    train_start: date
    train_end: date
    test_start: date
    test_end: date
    sample_count: int
    positive_count: int
    negative_count: int
    accuracy: float
    precision: float
    recall: float
    f1: float
    confusion_matrix: list[list[int]] = field(default_factory=list)


@dataclass
class MlModelAggregateMetrics:
    accuracy_mean: float
    accuracy_std: float
    precision_mean: float
    recall_mean: float
    f1_mean: float
    fold_count: int


@dataclass
class MlFeatureImportanceItem:
    feature: str
    importance: float
    importance_mean: float | None = None
    importance_std: float | None = None
    fold_count: int | None = None


@dataclass
class MlModelValidationResult:
    enabled: bool
    model_type: MlModelType | None = None
    target_mode: MlTargetMode | None = None
    metrics: MlModelAggregateMetrics | None = None
    fold_metrics: list[MlModelFoldMetric] = field(default_factory=list)
    feature_importance: list[MlFeatureImportanceItem] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class MlDatasetSummary:
    enabled: bool
    target_mode: MlTargetMode
    prediction_horizon: int
    future_quality_threshold: float
    sample_count: int
    feature_count: int
    positive_count: int
    negative_count: int
    positive_rate: float
    target_warning: str | None = None
    unsupported_target_mode: MlTargetMode | None = None
    dropped_feature_names: list[str] = field(default_factory=list)
    feature_names: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class MlCandidateVerifiedSummary:
    ac: float = 0.0
    cumulative_return: float = 0.0
    max_drawdown: float = 0.0
    trade_count: int = 0
    win_rate: float = 0.0


@dataclass
class MlRankedCandidate:
    rank: int
    predicted_score: float
    verified_score: float
    verified_summary: MlCandidateVerifiedSummary
    params: dict[str, Any]
    warnings: list[str] = field(default_factory=list)


@dataclass
class MlCandidateRankingResult:
    enabled: bool
    model_type: MlModelType | None = None
    score_mode: MlCandidateRankingScoreMode | None = None
    top_n: int = 0
    candidate_count: int = 0
    ranked_candidates: list[MlRankedCandidate] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class TimeSeriesValidationResult:
    enabled: bool
    mode: MlValidationMode
    n_splits: int
    test_size: int
    gap: int
    effective_gap: int
    prediction_horizon: int
    fold_metrics: list[TimeSeriesFoldMetric] = field(default_factory=list)
    aggregate_metrics: TimeSeriesAggregateMetrics = field(
        default_factory=lambda: TimeSeriesAggregateMetrics(
            fold_ac_mean=0.0,
            fold_ac_std=0.0,
            fold_return_mean=0.0,
            fold_return_std=0.0,
            fold_mdd_mean=0.0,
            fold_mdd_std=0.0,
            fold_trade_count_mean=0.0,
            stability_score=0.0,
        )
    )
    dataset_summary: MlDatasetSummary | None = None
    ml_model_validation: MlModelValidationResult = field(default_factory=lambda: MlModelValidationResult(enabled=False))
    ml_candidate_ranking: MlCandidateRankingResult = field(default_factory=lambda: MlCandidateRankingResult(enabled=False))
    warnings: list[str] = field(default_factory=list)


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


def normalize_weights(
    raw: dict[str, Any],
    keys: tuple[str, ...],
    defaults: CoreModeParams,
) -> dict[str, float]:
    values: dict[str, float] = {}
    for key in keys:
        default_value = float(getattr(defaults, key))
        parsed = _coerce_float(raw.get(key), default_value)
        values[key] = max(0.0, parsed)

    total = sum(values.values())
    if total <= 0:
        return {key: round(float(getattr(defaults, key)), 4) for key in keys}

    return {key: round(values[key] / total, 4) for key in keys}


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

    technical_weights = normalize_weights(raw, TECHNICAL_WEIGHT_KEYS, DEFAULT_CORE_MODE_PARAMS)
    weighted_score_weights = normalize_weights(raw, WEIGHTED_SCORE_WEIGHT_KEYS, DEFAULT_CORE_MODE_PARAMS)
    state_score_weights = normalize_weights(raw, STATE_SCORE_WEIGHT_KEYS, DEFAULT_CORE_MODE_PARAMS)
    trend_score_weights = normalize_weights(raw, TREND_SCORE_WEIGHT_KEYS, DEFAULT_CORE_MODE_PARAMS)
    shape_score_weights = normalize_weights(raw, SHAPE_SCORE_WEIGHT_KEYS, DEFAULT_CORE_MODE_PARAMS)

    return CoreModeParams(
        breakout_lookback=_norm_int("breakout_lookback"),
        momentum_window=_norm_int("momentum_window"),
        state_threshold=_norm_float("state_threshold"),
        shape_threshold=_norm_float("shape_threshold"),
        trend_threshold=_norm_float("trend_threshold"),
        max_pullback_depth=_norm_float("max_pullback_depth"),
        hard_stop_pct=_norm_float("hard_stop_pct"),
        trailing_stop_pct=_norm_float("trailing_stop_pct"),
        technical_ma_weight=technical_weights["technical_ma_weight"],
        technical_macd_weight=technical_weights["technical_macd_weight"],
        technical_rsi_weight=technical_weights["technical_rsi_weight"],
        technical_kd_weight=technical_weights["technical_kd_weight"],
        weighted_technical_weight=weighted_score_weights["weighted_technical_weight"],
        weighted_institutional_weight=weighted_score_weights["weighted_institutional_weight"],
        weighted_news_weight=weighted_score_weights["weighted_news_weight"],
        weighted_momentum_weight=weighted_score_weights["weighted_momentum_weight"],
        state_weighted_score_weight=state_score_weights["state_weighted_score_weight"],
        state_momentum_weight=state_score_weights["state_momentum_weight"],
        state_institutional_weight=state_score_weights["state_institutional_weight"],
        trend_state_weight=trend_score_weights["trend_state_weight"],
        trend_shape_weight=trend_score_weights["trend_shape_weight"],
        trend_breakout_weight=trend_score_weights["trend_breakout_weight"],
        shape_breakout_weight=shape_score_weights["shape_breakout_weight"],
        shape_slope_weight=shape_score_weights["shape_slope_weight"],
        shape_efficiency_weight=shape_score_weights["shape_efficiency_weight"],
        shape_pullback_weight=shape_score_weights["shape_pullback_weight"],
    )


def normalize_time_series_ml_settings(raw: Optional[dict[str, Any]]) -> TimeSeriesMLSettings:
    raw = raw or {}

    def _bounded_int(key: str, default: int, minimum: int) -> int:
        value = _coerce_int(raw.get(key), default)
        return max(minimum, value)

    def _bounded_float(key: str, default: float, minimum: float, maximum: float) -> float:
        value = _coerce_float(raw.get(key), default)
        return round(max(minimum, min(maximum, value)), 4)

    enabled = bool(raw.get("enabled", DEFAULT_TIME_SERIES_ML_SETTINGS.enabled))
    enable_model_training = bool(
        raw.get("enable_model_training", DEFAULT_TIME_SERIES_ML_SETTINGS.enable_model_training)
    )
    max_train_size_raw = raw.get("max_train_size")
    max_train_size = None
    if max_train_size_raw is not None:
        parsed = _coerce_int(max_train_size_raw, DEFAULT_TIME_SERIES_ML_SETTINGS.max_train_size or 0)
        max_train_size = max(1, parsed) if parsed > 0 else None

    target_mode = raw.get("target_mode") or DEFAULT_TIME_SERIES_ML_SETTINGS.target_mode
    if target_mode not in {"future_quality", "trade_return", "trend_label"}:
        target_mode = DEFAULT_TIME_SERIES_ML_SETTINGS.target_mode

    model_type = raw.get("model_type") or DEFAULT_TIME_SERIES_ML_SETTINGS.model_type
    if model_type not in {"random_forest", "gradient_boosting", "logistic_regression"}:
        model_type = DEFAULT_TIME_SERIES_ML_SETTINGS.model_type

    scoring_mode = raw.get("scoring_mode") or DEFAULT_TIME_SERIES_ML_SETTINGS.scoring_mode
    if scoring_mode not in {"accuracy", "f1", "return_score", "balanced_backtest_score"}:
        scoring_mode = DEFAULT_TIME_SERIES_ML_SETTINGS.scoring_mode

    enable_candidate_ranking = bool(
        raw.get("enable_candidate_ranking", DEFAULT_TIME_SERIES_ML_SETTINGS.enable_candidate_ranking)
    )
    candidate_ranking_top_n = _bounded_int(
        "candidate_ranking_top_n",
        DEFAULT_TIME_SERIES_ML_SETTINGS.candidate_ranking_top_n,
        1,
    )
    candidate_ranking_top_n = min(20, candidate_ranking_top_n)

    candidate_ranking_model_type = (
        raw.get("candidate_ranking_model_type") or DEFAULT_TIME_SERIES_ML_SETTINGS.candidate_ranking_model_type
    )
    if candidate_ranking_model_type not in {"random_forest", "gradient_boosting", "logistic_regression"}:
        candidate_ranking_model_type = DEFAULT_TIME_SERIES_ML_SETTINGS.candidate_ranking_model_type

    candidate_ranking_score_mode = (
        raw.get("candidate_ranking_score_mode") or DEFAULT_TIME_SERIES_ML_SETTINGS.candidate_ranking_score_mode
    )
    if candidate_ranking_score_mode not in {"balanced_score", "return_score", "ac_score", "drawdown_score"}:
        candidate_ranking_score_mode = DEFAULT_TIME_SERIES_ML_SETTINGS.candidate_ranking_score_mode

    return TimeSeriesMLSettings(
        enabled=enabled,
        enable_model_training=enable_model_training,
        n_splits=_bounded_int("n_splits", DEFAULT_TIME_SERIES_ML_SETTINGS.n_splits, 2),
        test_size=_bounded_int("test_size", DEFAULT_TIME_SERIES_ML_SETTINGS.test_size, 1),
        gap=_bounded_int("gap", DEFAULT_TIME_SERIES_ML_SETTINGS.gap, 0),
        max_train_size=max_train_size,
        prediction_horizon=_bounded_int(
            "prediction_horizon", DEFAULT_TIME_SERIES_ML_SETTINGS.prediction_horizon, 1
        ),
        future_quality_threshold=_bounded_float(
            "future_quality_threshold",
            DEFAULT_TIME_SERIES_ML_SETTINGS.future_quality_threshold,
            0.0,
            1.0,
        ),
        target_mode=target_mode,
        model_type=model_type,
        scoring_mode=scoring_mode,
        enable_candidate_ranking=enable_candidate_ranking,
        candidate_ranking_top_n=candidate_ranking_top_n,
        candidate_ranking_model_type=candidate_ranking_model_type,
        candidate_ranking_score_mode=candidate_ranking_score_mode,
    )


def normalize_auto_search_settings(raw: Optional[dict[str, Any]]) -> AutoSearchSettings:
    raw = raw or {}

    enabled = bool(raw.get("enabled", DEFAULT_AUTO_SEARCH_SETTINGS.enabled))
    mode = raw.get("mode") or DEFAULT_AUTO_SEARCH_SETTINGS.mode
    if mode not in {"single_stock_search", "multi_stock_search"}:
        mode = DEFAULT_AUTO_SEARCH_SETTINGS.mode

    raw_symbols = raw.get("symbols") or []
    symbols: list[str] = []
    if isinstance(raw_symbols, list):
        for item in raw_symbols:
            if item is None:
                continue
            symbol = str(item).strip().upper()
            if symbol:
                symbols.append(symbol)
    deduped_symbols = tuple(dict.fromkeys(symbols))

    top_n = max(1, min(20, _coerce_int(raw.get("top_n"), DEFAULT_AUTO_SEARCH_SETTINGS.top_n)))
    candidate_pool_size = max(
        50,
        min(1000, _coerce_int(raw.get("candidate_pool_size"), DEFAULT_AUTO_SEARCH_SETTINGS.candidate_pool_size)),
    )
    ml_prefilter_top_n = max(
        1,
        _coerce_int(raw.get("ml_prefilter_top_n"), DEFAULT_AUTO_SEARCH_SETTINGS.ml_prefilter_top_n),
    )
    ml_prefilter_top_n = min(ml_prefilter_top_n, candidate_pool_size)
    final_verify_top_n = max(
        1,
        _coerce_int(raw.get("final_verify_top_n"), DEFAULT_AUTO_SEARCH_SETTINGS.final_verify_top_n),
    )
    final_verify_top_n = min(final_verify_top_n, ml_prefilter_top_n)

    score_mode = raw.get("score_mode") or DEFAULT_AUTO_SEARCH_SETTINGS.score_mode
    if score_mode not in {"balanced_score", "return_score", "low_drawdown_score", "stable_score"}:
        score_mode = DEFAULT_AUTO_SEARCH_SETTINGS.score_mode

    max_runtime_level = raw.get("max_runtime_level") or DEFAULT_AUTO_SEARCH_SETTINGS.max_runtime_level
    if max_runtime_level not in {"balanced", "deep"}:
        max_runtime_level = DEFAULT_AUTO_SEARCH_SETTINGS.max_runtime_level

    min_trade_count = max(1, _coerce_int(raw.get("min_trade_count"), DEFAULT_AUTO_SEARCH_SETTINGS.min_trade_count))
    raw_adaptive = raw.get("adaptive_search_settings") or raw.get("adaptive") or {}
    if not isinstance(raw_adaptive, dict):
        raw_adaptive = {}

    max_iterations = max(
        1,
        min(
            10,
            _coerce_int(raw_adaptive.get("max_iterations"), DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.max_iterations),
        ),
    )
    candidates_per_iteration = max(
        50,
        min(
            1000,
            _coerce_int(
                raw_adaptive.get("candidates_per_iteration"),
                DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.candidates_per_iteration,
            ),
        ),
    )
    verify_top_n_per_iteration = max(
        1,
        _coerce_int(
            raw_adaptive.get("verify_top_n_per_iteration"),
            DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.verify_top_n_per_iteration,
        ),
    )
    verify_top_n_per_iteration = min(verify_top_n_per_iteration, candidates_per_iteration)

    keep_elite_n = max(
        1,
        _coerce_int(raw_adaptive.get("keep_elite_n"), DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.keep_elite_n),
    )
    keep_elite_n = min(keep_elite_n, verify_top_n_per_iteration)
    patience = max(1, min(5, _coerce_int(raw_adaptive.get("patience"), DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.patience)))
    min_improvement = clip(
        _coerce_float(
            raw_adaptive.get("min_improvement"),
            DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.min_improvement,
        ),
        0.0,
        0.1,
    )
    refinement_strength = raw_adaptive.get("refinement_strength") or DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.refinement_strength
    if refinement_strength not in {"small", "medium", "large"}:
        refinement_strength = DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.refinement_strength
    stop_when_score_reaches_raw = raw_adaptive.get("stop_when_score_reaches")
    stop_when_score_reaches = None
    if stop_when_score_reaches_raw is not None:
        stop_when_score_reaches = clip(_coerce_float(stop_when_score_reaches_raw, 1.0), 0.0, 1.0)

    raw_final_holdout = raw.get("final_holdout_settings") or {}
    if not isinstance(raw_final_holdout, dict):
        raw_final_holdout = {}

    final_holdout_mode = raw_final_holdout.get("mode") or DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.mode
    if final_holdout_mode not in {"ratio", "days"}:
        final_holdout_mode = DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.mode

    def _bounded_ratio(raw_value: Any, default: float) -> float:
        value = _coerce_float(raw_value, default)
        return round(clip(value, 0.0, 1.0), 6)

    final_holdout_days_raw = raw_final_holdout.get("final_holdout_days")
    final_holdout_days = None
    if final_holdout_days_raw is not None:
        parsed_days = _coerce_int(
            final_holdout_days_raw,
            DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.final_holdout_days or 0,
        )
        final_holdout_days = parsed_days if parsed_days > 0 else None

    return AutoSearchSettings(
        enabled=enabled,
        mode=mode,
        symbols=deduped_symbols,
        top_n=top_n,
        candidate_pool_size=candidate_pool_size,
        ml_prefilter_top_n=ml_prefilter_top_n,
        final_verify_top_n=final_verify_top_n,
        score_mode=score_mode,
        use_ml_prefilter=bool(raw.get("use_ml_prefilter", DEFAULT_AUTO_SEARCH_SETTINGS.use_ml_prefilter)),
        use_time_series_validation=bool(
            raw.get("use_time_series_validation", DEFAULT_AUTO_SEARCH_SETTINGS.use_time_series_validation)
        ),
        use_holdout_validation=bool(raw.get("use_holdout_validation", DEFAULT_AUTO_SEARCH_SETTINGS.use_holdout_validation)),
        require_min_trade_count=bool(
            raw.get("require_min_trade_count", DEFAULT_AUTO_SEARCH_SETTINGS.require_min_trade_count)
        ),
        min_trade_count=min_trade_count,
        max_runtime_level=max_runtime_level,
        adaptive_search_settings=AdaptiveSearchSettings(
            enabled=bool(raw_adaptive.get("enabled", DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.enabled)),
            max_iterations=max_iterations,
            candidates_per_iteration=candidates_per_iteration,
            verify_top_n_per_iteration=verify_top_n_per_iteration,
            keep_elite_n=keep_elite_n,
            patience=patience,
            min_improvement=round(float(min_improvement), 6),
            use_ml_prefilter=bool(
                raw_adaptive.get("use_ml_prefilter", DEFAULT_AUTO_SEARCH_SETTINGS.adaptive_search_settings.use_ml_prefilter)
            ),
            refinement_strength=refinement_strength,
            stop_when_score_reaches=round(float(stop_when_score_reaches), 6)
            if stop_when_score_reaches is not None
            else None,
        ),
        final_holdout_settings=FinalHoldoutSettings(
            enabled=bool(raw_final_holdout.get("enabled", DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.enabled)),
            mode=final_holdout_mode,
            train_ratio=_bounded_ratio(
                raw_final_holdout.get("train_ratio"),
                DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.train_ratio,
            ),
            validation_ratio=_bounded_ratio(
                raw_final_holdout.get("validation_ratio"),
                DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.validation_ratio,
            ),
            final_holdout_ratio=_bounded_ratio(
                raw_final_holdout.get("final_holdout_ratio"),
                DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.final_holdout_ratio,
            ),
            final_holdout_days=final_holdout_days,
            min_final_holdout_days=max(
                1,
                _coerce_int(
                    raw_final_holdout.get("min_final_holdout_days"),
                    DEFAULT_AUTO_SEARCH_SETTINGS.final_holdout_settings.min_final_holdout_days,
                ),
            ),
        ),
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
        "technical_ma_weight": params.technical_ma_weight,
        "technical_macd_weight": params.technical_macd_weight,
        "technical_rsi_weight": params.technical_rsi_weight,
        "technical_kd_weight": params.technical_kd_weight,
        "weighted_technical_weight": params.weighted_technical_weight,
        "weighted_institutional_weight": params.weighted_institutional_weight,
        "weighted_news_weight": params.weighted_news_weight,
        "weighted_momentum_weight": params.weighted_momentum_weight,
        "state_weighted_score_weight": params.state_weighted_score_weight,
        "state_momentum_weight": params.state_momentum_weight,
        "state_institutional_weight": params.state_institutional_weight,
        "trend_state_weight": params.trend_state_weight,
        "trend_shape_weight": params.trend_shape_weight,
        "trend_breakout_weight": params.trend_breakout_weight,
        "shape_breakout_weight": params.shape_breakout_weight,
        "shape_slope_weight": params.shape_slope_weight,
        "shape_efficiency_weight": params.shape_efficiency_weight,
        "shape_pullback_weight": params.shape_pullback_weight,
    }
