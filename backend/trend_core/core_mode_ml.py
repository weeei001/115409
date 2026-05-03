from __future__ import annotations

from statistics import mean, pstdev
from typing import Any

from sklearn.model_selection import TimeSeriesSplit

from .core_mode_engine import compute_future_trend_quality, run_core_mode_pipeline
from .core_mode_types import (
    CORE_MODE_BASE_PARAM_KEYS,
    SHAPE_SCORE_WEIGHT_KEYS,
    STATE_SCORE_WEIGHT_KEYS,
    TECHNICAL_WEIGHT_KEYS,
    TREND_SCORE_WEIGHT_KEYS,
    WEIGHTED_SCORE_WEIGHT_KEYS,
    CoreModeParams,
    MarketRow,
    MlDatasetSummary,
    MlCandidateRankingResult,
    MlCandidateVerifiedSummary,
    MlFeatureImportanceItem,
    MlModelAggregateMetrics,
    MlModelFoldMetric,
    MlModelValidationResult,
    MlRankedCandidate,
    TimeSeriesAggregateMetrics,
    TimeSeriesFoldMetric,
    TimeSeriesMLSettings,
    TimeSeriesValidationResult,
    clip,
    params_to_dict,
)

_LEAKY_FEATURE_KEYWORDS = ("future", "target", "label", "y_")
_UNSUPPORTED_TARGET_WARNING = {
    "trade_return": "trade_return target 尚未在目前階段啟用，請先使用 future_quality。",
    "trend_label": "trend_label target 尚未在目前階段啟用，請先使用 future_quality。",
}
_SUPPORTED_MODEL_TYPES = {"logistic_regression", "random_forest", "gradient_boosting"}


def _safe_mean(values: list[float]) -> float:
    return mean(values) if values else 0.0


def _safe_std(values: list[float]) -> float:
    return pstdev(values) if len(values) > 1 else 0.0


def _safe_ratio(numerator: float, denominator: float, fallback: float = 0.0) -> float:
    if denominator == 0:
        return fallback
    return numerator / denominator


def _empty_aggregate() -> TimeSeriesAggregateMetrics:
    return TimeSeriesAggregateMetrics(
        fold_ac_mean=0.0,
        fold_ac_std=0.0,
        fold_return_mean=0.0,
        fold_return_std=0.0,
        fold_mdd_mean=0.0,
        fold_mdd_std=0.0,
        fold_trade_count_mean=0.0,
        stability_score=0.0,
    )


def _empty_ml_model_aggregate() -> MlModelAggregateMetrics:
    return MlModelAggregateMetrics(
        accuracy_mean=0.0,
        accuracy_std=0.0,
        precision_mean=0.0,
        recall_mean=0.0,
        f1_mean=0.0,
        fold_count=0,
    )


def _empty_ml_model_validation(*, enabled: bool = False, warnings: list[str] | None = None) -> MlModelValidationResult:
    return MlModelValidationResult(
        enabled=enabled,
        warnings=warnings or [],
    )


def _empty_candidate_ranking(*, warnings: list[str] | None = None) -> MlCandidateRankingResult:
    return MlCandidateRankingResult(
        enabled=False,
        warnings=warnings or [],
    )


def _empty_dataset_summary(
    *,
    target_mode: str,
    enabled: bool,
    prediction_horizon: int,
    future_quality_threshold: float,
    target_warning: str | None = None,
    unsupported_target_mode: str | None = None,
    warnings: list[str] | None = None,
) -> MlDatasetSummary:
    return MlDatasetSummary(
        enabled=enabled,
        target_mode=target_mode,
        prediction_horizon=prediction_horizon,
        future_quality_threshold=future_quality_threshold,
        sample_count=0,
        feature_count=0,
        positive_count=0,
        negative_count=0,
        positive_rate=0.0,
        target_warning=target_warning,
        unsupported_target_mode=unsupported_target_mode,
        dropped_feature_names=[],
        feature_names=[],
        warnings=warnings or [],
    )


def _empty_validation(
    *,
    ml_settings: TimeSeriesMLSettings,
    effective_gap: int,
    warnings: list[str] | None = None,
    dataset_summary: MlDatasetSummary | None = None,
) -> TimeSeriesValidationResult:
    return TimeSeriesValidationResult(
        enabled=ml_settings.enabled,
        mode="time_series_split_rule_based",
        n_splits=ml_settings.n_splits,
        test_size=ml_settings.test_size,
        gap=ml_settings.gap,
        effective_gap=effective_gap,
        prediction_horizon=ml_settings.prediction_horizon,
        fold_metrics=[],
        aggregate_metrics=_empty_aggregate(),
        dataset_summary=dataset_summary,
        ml_model_validation=_empty_ml_model_validation(enabled=False),
        ml_candidate_ranking=_empty_candidate_ranking(),
        warnings=warnings or [],
    )


def build_disabled_time_series_validation_result(
    *,
    ml_settings: TimeSeriesMLSettings,
) -> TimeSeriesValidationResult:
    return _empty_validation(
        ml_settings=ml_settings,
        effective_gap=max(ml_settings.gap, ml_settings.prediction_horizon),
        warnings=[],
        dataset_summary=None,
    )


def make_time_series_splitter(
    *,
    sample_count: int,
    ml_settings: TimeSeriesMLSettings,
) -> tuple[TimeSeriesSplit, int, list[str]]:
    warnings: list[str] = []
    effective_gap = max(ml_settings.gap, ml_settings.prediction_horizon)
    if effective_gap != ml_settings.gap:
        warnings.append(
            f"ml_settings.gap({ml_settings.gap}) 小於 prediction_horizon({ml_settings.prediction_horizon})，"
            f"已自動調整 effective_gap={effective_gap}。"
        )

    splitter = TimeSeriesSplit(
        n_splits=ml_settings.n_splits,
        test_size=ml_settings.test_size,
        gap=effective_gap,
        max_train_size=ml_settings.max_train_size,
    )

    min_required = (ml_settings.n_splits + 1) * ml_settings.test_size + effective_gap
    if sample_count < min_required:
        warnings.append(
            f"樣本數不足以建立完整 TimeSeriesSplit fold：sample_count={sample_count}，"
            f"至少需要 {min_required}。"
        )

    return splitter, effective_gap, warnings


def summarize_time_series_validation(fold_metrics: list[TimeSeriesFoldMetric]) -> TimeSeriesAggregateMetrics:
    if not fold_metrics:
        return _empty_aggregate()

    ac_values = [item.ac for item in fold_metrics]
    ret_values = [item.cumulative_return for item in fold_metrics]
    mdd_values = [item.max_drawdown for item in fold_metrics]
    trade_values = [float(item.trade_count) for item in fold_metrics]

    ac_std = _safe_std(ac_values)
    ret_std = _safe_std(ret_values)
    mdd_std = _safe_std(mdd_values)
    stability_score = clip(
        1.0 - ((ac_std * 1.0) + (ret_std * 0.8) + (mdd_std * 0.8)),
        0.0,
        1.0,
    )

    return TimeSeriesAggregateMetrics(
        fold_ac_mean=round(_safe_mean(ac_values), 4),
        fold_ac_std=round(ac_std, 4),
        fold_return_mean=round(_safe_mean(ret_values), 4),
        fold_return_std=round(ret_std, 4),
        fold_mdd_mean=round(_safe_mean(mdd_values), 4),
        fold_mdd_std=round(mdd_std, 4),
        fold_trade_count_mean=round(_safe_mean(trade_values), 4),
        stability_score=round(stability_score, 4),
    )


def build_future_quality_target(
    *,
    future_quality_rows: list[dict[str, Any]],
    prediction_horizon: int,
    future_quality_threshold: float,
) -> tuple[list[int], list[int], list[str]]:
    labels: list[int] = []
    indices: list[int] = []

    for idx, item in enumerate(future_quality_rows):
        if not bool(item.get("available")):
            continue

        quality = float(item.get("quality", 0.0) or 0.0)
        passed = bool(item.get("passed")) or quality >= future_quality_threshold
        labels.append(1 if passed else 0)
        indices.append(idx)

    warnings: list[str] = []
    if not indices:
        warnings.append(
            f"future_quality target 無可用樣本（prediction_horizon={prediction_horizon}）。"
        )

    return labels, indices, warnings


def build_trade_return_target() -> tuple[list[int], list[int], list[str]]:
    return [], [], [_UNSUPPORTED_TARGET_WARNING["trade_return"]]


def build_trend_label_target() -> tuple[list[int], list[int], list[str]]:
    return [], [], [_UNSUPPORTED_TARGET_WARNING["trend_label"]]


def _compute_ma_score(row: MarketRow) -> float:
    ma_terms: list[float] = []
    if row.ma20:
        ma_terms.append(clip(_safe_ratio(row.close - row.ma20, row.ma20) / 0.03))
    if row.ma5 and row.ma20:
        ma_terms.append(clip(_safe_ratio(row.ma5 - row.ma20, row.ma20) / 0.03))
    if row.ma20 and row.ma60:
        ma_terms.append(clip(_safe_ratio(row.ma20 - row.ma60, row.ma60) / 0.04))
    return _safe_mean(ma_terms)


def _compute_macd_score(row: MarketRow) -> float:
    score = 0.0
    if row.macd is not None and row.macd_signal is not None:
        score += 0.6 * clip((row.macd - row.macd_signal) / 0.8)
    if row.macd_hist is not None:
        score += 0.4 * clip(row.macd_hist / 0.8)
    return score


def _build_feature_row(
    *,
    idx: int,
    rows: list[MarketRow],
    features: list[Any],
    scores: list[Any],
    params: CoreModeParams,
    warnings: list[str],
    warned_fields: set[str],
) -> dict[str, float]:
    row = rows[idx]
    feature = features[idx]
    score = scores[idx]

    ma20 = row.ma20
    ma60 = row.ma60
    ma5 = row.ma5

    if ma20 is None and "ma20" not in warned_fields:
        warnings.append("部分樣本缺少 ma20，相關特徵以 0 填補。")
        warned_fields.add("ma20")
    if ma60 is None and "ma60" not in warned_fields:
        warnings.append("部分樣本缺少 ma60，相關特徵以 0 填補。")
        warned_fields.add("ma60")
    if ma5 is None and "ma5" not in warned_fields:
        warnings.append("部分樣本缺少 ma5，相關特徵以 0 填補。")
        warned_fields.add("ma5")

    close_position_to_ma20 = _safe_ratio(row.close - (ma20 or row.close), (ma20 or row.close)) if ma20 else 0.0
    close_position_to_ma60 = _safe_ratio(row.close - (ma60 or row.close), (ma60 or row.close)) if ma60 else 0.0

    if idx >= 5 and rows[idx - 5].ma20 not in (None, 0) and ma20 is not None:
        ma20_slope = _safe_ratio(ma20 - float(rows[idx - 5].ma20), float(rows[idx - 5].ma20))
    else:
        ma20_slope = 0.0

    ma_score = _compute_ma_score(row)
    macd_score = _compute_macd_score(row)
    rsi_score = 0.0 if row.rsi14 is None else clip((row.rsi14 - 50.0) / 25.0)
    kd_score = 0.0
    if row.k_value is not None and row.d_value is not None:
        kd_score = clip((row.k_value - row.d_value) / 20.0)

    net_window = [rows[w_idx].total_net or 0.0 for w_idx in range(max(0, idx - 19), idx + 1)]
    avg_abs_net = _safe_mean([abs(v) for v in net_window]) or 1.0
    total_net_strength = clip(_safe_ratio(row.total_net or 0.0, avg_abs_net * 3.0))

    base_features: dict[str, float] = {
        "close_position_to_ma20": round(close_position_to_ma20, 6),
        "close_position_to_ma60": round(close_position_to_ma60, 6),
        "ma5_above_ma20": 1.0 if (ma5 is not None and ma20 is not None and ma5 > ma20) else 0.0,
        "ma20_above_ma60": 1.0 if (ma20 is not None and ma60 is not None and ma20 > ma60) else 0.0,
        "ma20_slope": round(ma20_slope, 6),
        "momentum_return": round(float(feature.return_window), 6),
        "trend_efficiency": round(float(feature.trend_efficiency), 6),
        "volume_ratio": round(float(feature.volume_ratio), 6),
        "breakout_strength": round(float(feature.breakout_strength), 6),
        "pullback_depth": round(float(feature.pullback_depth), 6),
        "ma_score": round(ma_score, 6),
        "macd_score": round(macd_score, 6),
        "rsi_score": round(rsi_score, 6),
        "kd_score": round(kd_score, 6),
        "technical_score": round(float(feature.technical_score), 6),
        "institutional_score": round(float(feature.institutional_score), 6),
        "total_net_strength": round(total_net_strength, 6),
        "weighted_score": round(float(feature.weighted_score), 6),
        "state_score": round(float(score.state_score), 6),
        "trend_shape_score": round(float(score.trend_shape_score), 6),
        "trend_score": round(float(score.trend_score), 6),
    }

    param_keys = (
        *CORE_MODE_BASE_PARAM_KEYS,
        *TECHNICAL_WEIGHT_KEYS,
        *WEIGHTED_SCORE_WEIGHT_KEYS,
        *STATE_SCORE_WEIGHT_KEYS,
        *TREND_SCORE_WEIGHT_KEYS,
        *SHAPE_SCORE_WEIGHT_KEYS,
    )
    params_map = params_to_dict(params)
    for key in param_keys:
        base_features[key] = round(float(params_map[key]), 6)

    return base_features


def validate_no_future_features(feature_names: list[str]) -> tuple[list[str], list[str]]:
    safe_feature_names: list[str] = []
    warnings: list[str] = []

    for name in feature_names:
        lowered = name.lower()
        if name == "future_quality" or any(keyword in lowered for keyword in _LEAKY_FEATURE_KEYWORDS):
            warnings.append(f"移除疑似未來洩漏特徵：{name}")
            continue
        safe_feature_names.append(name)

    return safe_feature_names, warnings


def drop_constant_features(
    X: list[list[float]],
    feature_names: list[str],
) -> tuple[list[list[float]], list[str], list[str], list[str]]:
    if not X or not feature_names:
        return X, feature_names, [], []

    dropped: list[str] = []
    keep_indices: list[int] = []

    for idx, name in enumerate(feature_names):
        column = [row[idx] for row in X]
        if all(value == column[0] for value in column):
            dropped.append(name)
        else:
            keep_indices.append(idx)

    if dropped and not keep_indices:
        return (
            X,
            feature_names,
            [],
            ["所有特徵皆為常數，已保留原特徵避免資料集欄位為空。"],
        )

    if not dropped:
        return X, feature_names, [], []

    reduced_X = [[row[idx] for idx in keep_indices] for row in X]
    reduced_names = [feature_names[idx] for idx in keep_indices]
    return reduced_X, reduced_names, dropped, []


def summarize_ml_dataset(
    *,
    enabled: bool,
    target_mode: str,
    prediction_horizon: int,
    future_quality_threshold: float,
    y: list[int],
    feature_names: list[str],
    dropped_feature_names: list[str],
    target_warning: str | None,
    unsupported_target_mode: str | None,
    warnings: list[str],
) -> MlDatasetSummary:
    positive_count = sum(1 for item in y if item == 1)
    sample_count = len(y)
    negative_count = sample_count - positive_count
    positive_rate = round(_safe_ratio(float(positive_count), float(sample_count)), 4) if sample_count else 0.0

    return MlDatasetSummary(
        enabled=enabled,
        target_mode=target_mode,
        prediction_horizon=prediction_horizon,
        future_quality_threshold=future_quality_threshold,
        sample_count=sample_count,
        feature_count=len(feature_names),
        positive_count=positive_count,
        negative_count=negative_count,
        positive_rate=positive_rate,
        target_warning=target_warning,
        unsupported_target_mode=unsupported_target_mode,
        dropped_feature_names=dropped_feature_names,
        feature_names=feature_names,
        warnings=warnings,
    )


def build_ml_dataset(
    *,
    rows: list[MarketRow],
    params: CoreModeParams,
    ml_settings: TimeSeriesMLSettings,
) -> dict[str, Any]:
    target_mode = ml_settings.target_mode

    if target_mode == "trade_return":
        _, _, target_warnings = build_trade_return_target()
        return {
            "X": [],
            "y": [],
            "sample_dates": [],
            "feature_names": [],
            "dropped_feature_names": [],
            "warnings": target_warnings,
            "dataset_summary": _empty_dataset_summary(
                target_mode=target_mode,
                enabled=False,
                prediction_horizon=ml_settings.prediction_horizon,
                future_quality_threshold=ml_settings.future_quality_threshold,
                target_warning=target_warnings[0] if target_warnings else None,
                unsupported_target_mode=target_mode,
                warnings=target_warnings,
            ),
        }

    if target_mode == "trend_label":
        _, _, target_warnings = build_trend_label_target()
        return {
            "X": [],
            "y": [],
            "sample_dates": [],
            "feature_names": [],
            "dropped_feature_names": [],
            "warnings": target_warnings,
            "dataset_summary": _empty_dataset_summary(
                target_mode=target_mode,
                enabled=False,
                prediction_horizon=ml_settings.prediction_horizon,
                future_quality_threshold=ml_settings.future_quality_threshold,
                target_warning=target_warnings[0] if target_warnings else None,
                unsupported_target_mode=target_mode,
                warnings=target_warnings,
            ),
        }

    if not rows:
        warnings = ["無可用行情資料，無法建立 ML dataset。"]
        return {
            "X": [],
            "y": [],
            "sample_dates": [],
            "feature_names": [],
            "dropped_feature_names": [],
            "warnings": warnings,
            "dataset_summary": _empty_dataset_summary(
                target_mode=target_mode,
                enabled=True,
                prediction_horizon=ml_settings.prediction_horizon,
                future_quality_threshold=ml_settings.future_quality_threshold,
                warnings=warnings,
            ),
        }

    pipeline = run_core_mode_pipeline(rows, params)
    features = pipeline["features"]
    scores = pipeline["scores"]

    future_quality_rows = compute_future_trend_quality(rows, horizon=ml_settings.prediction_horizon)
    labels, valid_indices, warnings = build_future_quality_target(
        future_quality_rows=future_quality_rows,
        prediction_horizon=ml_settings.prediction_horizon,
        future_quality_threshold=ml_settings.future_quality_threshold,
    )

    label_by_index = {idx: label for idx, label in zip(valid_indices, labels, strict=True)}

    feature_rows: list[dict[str, float]] = []
    y: list[int] = []
    sample_dates: list[Any] = []
    warned_fields: set[str] = set()

    for idx in valid_indices:
        if idx >= len(features) or idx >= len(scores):
            warnings.append(f"樣本 index={idx} 超出特徵或分數範圍，已跳過。")
            continue

        row_features = _build_feature_row(
            idx=idx,
            rows=rows,
            features=features,
            scores=scores,
            params=params,
            warnings=warnings,
            warned_fields=warned_fields,
        )
        feature_rows.append(row_features)
        y.append(label_by_index[idx])
        sample_dates.append(rows[idx].date)

    if not feature_rows:
        summary = summarize_ml_dataset(
            enabled=True,
            target_mode=target_mode,
            prediction_horizon=ml_settings.prediction_horizon,
            future_quality_threshold=ml_settings.future_quality_threshold,
            y=[],
            feature_names=[],
            dropped_feature_names=[],
            target_warning=None,
            unsupported_target_mode=None,
            warnings=warnings,
        )
        return {
            "X": [],
            "y": [],
            "sample_dates": [],
            "feature_names": [],
            "dropped_feature_names": [],
            "warnings": warnings,
            "dataset_summary": summary,
        }

    feature_names = list(feature_rows[0].keys())
    safe_feature_names, leakage_warnings = validate_no_future_features(feature_names)
    warnings.extend(leakage_warnings)

    feature_rows = [{name: row[name] for name in safe_feature_names} for row in feature_rows]

    X = [[row[name] for name in safe_feature_names] for row in feature_rows]
    X, safe_feature_names, dropped_constants, constant_warnings = drop_constant_features(X, safe_feature_names)
    warnings.extend(constant_warnings)

    summary = summarize_ml_dataset(
        enabled=True,
        target_mode=target_mode,
        prediction_horizon=ml_settings.prediction_horizon,
        future_quality_threshold=ml_settings.future_quality_threshold,
        y=y,
        feature_names=safe_feature_names,
        dropped_feature_names=dropped_constants,
        target_warning=None,
        unsupported_target_mode=None,
        warnings=warnings,
    )

    return {
        "X": X,
        "y": y,
        "sample_dates": sample_dates,
        "feature_names": safe_feature_names,
        "dropped_feature_names": dropped_constants,
        "warnings": warnings,
        "dataset_summary": summary,
    }


def _score_series_stats(values: list[float]) -> tuple[float, float]:
    if not values:
        return 0.0, 0.0
    return round(_safe_mean(values), 6), round(_safe_std(values), 6)


def _build_candidate_window_summary(
    *,
    rows: list[MarketRow],
    params: CoreModeParams,
) -> tuple[dict[str, float], list[str]]:
    warnings: list[str] = []
    if not rows:
        warnings.append("train window 為空，候選特徵以 0 填補。")
        return {
            "train_avg_volatility": 0.0,
            "train_avg_volume_change": 0.0,
            "train_trend_score_mean": 0.0,
            "train_trend_score_std": 0.0,
            "train_weighted_score_mean": 0.0,
            "train_weighted_score_std": 0.0,
            "train_state_score_mean": 0.0,
            "train_state_score_std": 0.0,
            "train_trend_shape_score_mean": 0.0,
            "train_trend_shape_score_std": 0.0,
            "train_institutional_score_mean": 0.0,
            "train_institutional_score_std": 0.0,
            "train_breakout_strength_mean": 0.0,
            "train_breakout_strength_std": 0.0,
        }, warnings

    pipeline = run_core_mode_pipeline(rows, params)
    features = pipeline.get("features", [])
    scores = pipeline.get("scores", [])
    if not features or not scores:
        warnings.append("train window 缺少 feature/score rows，統計特徵以 0 填補。")

    close_returns: list[float] = []
    volume_changes: list[float] = []
    for idx in range(1, len(rows)):
        prev_close = rows[idx - 1].close
        close_returns.append(_safe_ratio(rows[idx].close - prev_close, prev_close))

        prev_vol = rows[idx - 1].volume
        if prev_vol:
            volume_changes.append(_safe_ratio(rows[idx].volume - prev_vol, prev_vol))

    volatility = round(_safe_std(close_returns), 6) if close_returns else 0.0
    avg_volume_change = round(_safe_mean(volume_changes), 6) if volume_changes else 0.0

    trend_mean, trend_std = _score_series_stats([float(item.trend_score) for item in scores])
    weighted_mean, weighted_std = _score_series_stats([float(item.weighted_score) for item in features])
    state_mean, state_std = _score_series_stats([float(item.state_score) for item in scores])
    shape_mean, shape_std = _score_series_stats([float(item.trend_shape_score) for item in scores])
    inst_mean, inst_std = _score_series_stats([float(item.institutional_score) for item in features])
    breakout_mean, breakout_std = _score_series_stats([float(item.breakout_strength) for item in features])

    summary = {
        "train_avg_volatility": volatility,
        "train_avg_volume_change": avg_volume_change,
        "train_trend_score_mean": trend_mean,
        "train_trend_score_std": trend_std,
        "train_weighted_score_mean": weighted_mean,
        "train_weighted_score_std": weighted_std,
        "train_state_score_mean": state_mean,
        "train_state_score_std": state_std,
        "train_trend_shape_score_mean": shape_mean,
        "train_trend_shape_score_std": shape_std,
        "train_institutional_score_mean": inst_mean,
        "train_institutional_score_std": inst_std,
        "train_breakout_strength_mean": breakout_mean,
        "train_breakout_strength_std": breakout_std,
    }
    return summary, warnings


def _build_candidate_feature_row(
    *,
    params: CoreModeParams,
    window_summary: dict[str, float],
) -> dict[str, float]:
    feature_row: dict[str, float] = {}
    param_values = params_to_dict(params)
    for key in (
        *CORE_MODE_BASE_PARAM_KEYS,
        *TECHNICAL_WEIGHT_KEYS,
        *WEIGHTED_SCORE_WEIGHT_KEYS,
        *STATE_SCORE_WEIGHT_KEYS,
        *TREND_SCORE_WEIGHT_KEYS,
        *SHAPE_SCORE_WEIGHT_KEYS,
    ):
        feature_row[key] = round(float(param_values.get(key, 0.0) or 0.0), 6)

    feature_row.update(window_summary)
    return feature_row


def build_candidate_target(
    *,
    ac: float,
    cumulative_return: float,
    max_drawdown: float,
    trade_count: int,
    stability: float | None,
    score_mode: str,
) -> tuple[float, list[str]]:
    warnings: list[str] = []

    ac_score = clip(float(ac), 0.0, 1.0)
    return_score = clip((float(cumulative_return) - (-0.20)) / 0.80, 0.0, 1.0)
    drawdown_score = clip(1.0 - (abs(float(max_drawdown)) / 0.35), 0.0, 1.0)
    trade_count_score = clip(float(trade_count) / 30.0, 0.0, 1.0)

    if stability is None:
        stability_score = 0.5
        warnings.append("stability_score 無可用值，balanced_score 以 0.5 代替。")
    else:
        stability_score = clip(float(stability), 0.0, 1.0)

    balanced_score = (
        (0.25 * ac_score)
        + (0.25 * return_score)
        + (0.20 * stability_score)
        + (0.15 * drawdown_score)
        + (0.15 * trade_count_score)
    )

    if score_mode == "ac_score":
        return round(ac_score, 6), warnings
    if score_mode == "return_score":
        return round(return_score, 6), warnings
    if score_mode == "drawdown_score":
        return round(drawdown_score, 6), warnings
    return round(balanced_score, 6), warnings


def build_candidate_dataset(
    *,
    rows: list[MarketRow],
    candidate_params: list[CoreModeParams],
    ml_settings: TimeSeriesMLSettings,
) -> dict[str, Any]:
    warnings: list[str] = []
    if not rows:
        warnings.append("沒有可用資料，無法建立 candidate ranking dataset。")
        return {
            "candidate_count": 0,
            "feature_names": [],
            "X_train": [],
            "y_train": [],
            "X_candidate": [],
            "candidate_params": [],
            "warnings": warnings,
        }
    if not candidate_params:
        warnings.append("optimization result 不存在，無法建立 candidate pool。")
        return {
            "candidate_count": 0,
            "feature_names": [],
            "X_train": [],
            "y_train": [],
            "X_candidate": [],
            "candidate_params": [],
            "warnings": warnings,
        }

    splitter, _, split_warnings = make_time_series_splitter(sample_count=len(rows), ml_settings=ml_settings)
    warnings.extend(split_warnings)
    try:
        splits = [(list(train_idx), list(test_idx)) for train_idx, test_idx in splitter.split(list(range(len(rows))))]
    except ValueError as exc:
        warnings.append(f"TimeSeriesSplit 無法建立 folds：{exc}")
        return {
            "candidate_count": len(candidate_params),
            "feature_names": [],
            "X_train": [],
            "y_train": [],
            "X_candidate": [],
            "candidate_params": candidate_params,
            "warnings": warnings,
        }

    if not splits:
        warnings.append("TimeSeriesSplit 未產生任何 fold，無法建立 candidate ranking dataset。")
        return {
            "candidate_count": len(candidate_params),
            "feature_names": [],
            "X_train": [],
            "y_train": [],
            "X_candidate": [],
            "candidate_params": candidate_params,
            "warnings": warnings,
        }

    feature_rows_train: list[dict[str, float]] = []
    y_train: list[float] = []
    for params in candidate_params:
        for fold_index, (train_indices, test_indices) in enumerate(splits, start=1):
            if not train_indices or not test_indices:
                warnings.append(f"fold {fold_index} train/test 為空，candidate dataset 已略過。")
                continue
            if train_indices[-1] >= test_indices[0]:
                warnings.append(f"fold {fold_index} 時序不合法（train_end >= test_start），candidate dataset 已略過。")
                continue

            train_rows = rows[int(train_indices[0]) : int(train_indices[-1]) + 1]
            test_rows = rows[int(test_indices[0]) : int(test_indices[-1]) + 1]
            if not train_rows or not test_rows:
                warnings.append(f"fold {fold_index} train/test rows 為空，candidate dataset 已略過。")
                continue

            window_summary, window_warnings = _build_candidate_window_summary(rows=train_rows, params=params)
            warnings.extend(f"fold {fold_index}：{item}" for item in window_warnings)
            feature_rows_train.append(_build_candidate_feature_row(params=params, window_summary=window_summary))

            test_summary = run_core_mode_pipeline(test_rows, params)["summary"]
            target, target_warnings = build_candidate_target(
                ac=float(test_summary.ac),
                cumulative_return=float(test_summary.cumulative_return),
                max_drawdown=float(test_summary.max_drawdown),
                trade_count=int(test_summary.trade_count),
                stability=float(test_summary.stability),
                score_mode=ml_settings.candidate_ranking_score_mode,
            )
            warnings.extend(f"fold {fold_index}：{item}" for item in target_warnings)
            y_train.append(target)

    if not feature_rows_train:
        warnings.append("candidate dataset 樣本不足，無法產生訓練特徵。")
        return {
            "candidate_count": len(candidate_params),
            "feature_names": [],
            "X_train": [],
            "y_train": [],
            "X_candidate": [],
            "candidate_params": candidate_params,
            "warnings": warnings,
        }

    feature_names = list(feature_rows_train[0].keys())
    X_train = [[row.get(name, 0.0) for name in feature_names] for row in feature_rows_train]

    latest_train_indices = splits[-1][0]
    if not latest_train_indices:
        warnings.append("最新 train window 不可用，candidate 推論特徵以完整資料窗代替。")
        latest_train_rows = rows
    else:
        latest_train_rows = rows[int(latest_train_indices[0]) : int(latest_train_indices[-1]) + 1]

    feature_rows_candidate: list[dict[str, float]] = []
    for params in candidate_params:
        window_summary, window_warnings = _build_candidate_window_summary(rows=latest_train_rows, params=params)
        warnings.extend(window_warnings)
        feature_rows_candidate.append(_build_candidate_feature_row(params=params, window_summary=window_summary))

    X_candidate = [[row.get(name, 0.0) for name in feature_names] for row in feature_rows_candidate]
    return {
        "candidate_count": len(candidate_params),
        "feature_names": feature_names,
        "X_train": X_train,
        "y_train": y_train,
        "X_candidate": X_candidate,
        "candidate_params": candidate_params,
        "warnings": warnings,
    }


def summarize_candidate_ranking(
    *,
    enabled: bool,
    model_type: str,
    score_mode: str,
    top_n: int,
    candidate_count: int,
    ranked_candidates: list[MlRankedCandidate],
    warnings: list[str],
) -> MlCandidateRankingResult:
    if not enabled:
        return _empty_candidate_ranking(warnings=warnings)

    unique_warnings = list(dict.fromkeys(warnings))
    return MlCandidateRankingResult(
        enabled=True,
        model_type=model_type if model_type in _SUPPORTED_MODEL_TYPES else None,
        score_mode=score_mode if score_mode in {"balanced_score", "return_score", "ac_score", "drawdown_score"} else None,
        top_n=top_n,
        candidate_count=candidate_count,
        ranked_candidates=ranked_candidates,
        warnings=unique_warnings,
    )


def rank_candidates_with_ml(
    *,
    rows: list[MarketRow],
    candidate_params: list[CoreModeParams],
    ml_settings: TimeSeriesMLSettings,
) -> MlCandidateRankingResult:
    if not ml_settings.enable_candidate_ranking:
        return _empty_candidate_ranking()

    warnings: list[str] = []
    top_n = max(1, min(20, int(ml_settings.candidate_ranking_top_n)))
    model_type = ml_settings.candidate_ranking_model_type
    score_mode = ml_settings.candidate_ranking_score_mode
    if model_type not in _SUPPORTED_MODEL_TYPES:
        warnings.append(f"不支援的 candidate_ranking_model_type：{model_type}")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=len(candidate_params),
            ranked_candidates=[],
            warnings=warnings,
        )
    if score_mode not in {"balanced_score", "return_score", "ac_score", "drawdown_score"}:
        warnings.append(f"不支援的 candidate_ranking_score_mode：{score_mode}")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=len(candidate_params),
            ranked_candidates=[],
            warnings=warnings,
        )

    if not candidate_params:
        warnings.append("optimization result 不存在，無法執行 candidate ranking。")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=0,
            ranked_candidates=[],
            warnings=warnings,
        )

    candidate_dataset = build_candidate_dataset(
        rows=rows,
        candidate_params=candidate_params,
        ml_settings=ml_settings,
    )
    warnings.extend(candidate_dataset.get("warnings", []))

    X_train = candidate_dataset.get("X_train", [])
    y_train = candidate_dataset.get("y_train", [])
    X_candidate = candidate_dataset.get("X_candidate", [])
    candidate_count = int(candidate_dataset.get("candidate_count", 0))
    resolved_params: list[CoreModeParams] = candidate_dataset.get("candidate_params", [])

    if candidate_count < 2:
        warnings.append(f"candidate pool 太少（candidate_count={candidate_count}），無法執行有效排名。")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=candidate_count,
            ranked_candidates=[],
            warnings=warnings,
        )

    if len(X_train) < 8 or len(y_train) < 8:
        warnings.append("candidate dataset 樣本不足，無法訓練 ranking model。")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=candidate_count,
            ranked_candidates=[],
            warnings=warnings,
        )

    if len(set(y_train)) <= 1:
        warnings.append("ranking target 單一值，無法訓練 ranking model。")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=candidate_count,
            ranked_candidates=[],
            warnings=warnings,
        )

    try:
        from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
    except Exception as exc:  # pragma: no cover - environment dependent
        warnings.append(f"scikit-learn import 失敗，略過 candidate ranking：{exc}")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=candidate_count,
            ranked_candidates=[],
            warnings=warnings,
        )

    try:
        if model_type == "logistic_regression":
            threshold = _safe_mean(y_train)
            y_binary = [1 if score >= threshold else 0 for score in y_train]
            if len(set(y_binary)) < 2:
                warnings.append("ranking target 轉換後為單一類別，無法訓練 logistic_regression。")
                return summarize_candidate_ranking(
                    enabled=True,
                    model_type=model_type,
                    score_mode=score_mode,
                    top_n=top_n,
                    candidate_count=candidate_count,
                    ranked_candidates=[],
                    warnings=warnings,
                )
            model = Pipeline(
                steps=[
                    ("scaler", StandardScaler()),
                    ("model", LogisticRegression(max_iter=1000, random_state=42)),
                ]
            )
            model.fit(X_train, y_binary)
            predicted = model.predict_proba(X_candidate)
            predicted_scores = [clip(float(row[1]), 0.0, 1.0) for row in predicted]
        elif model_type == "gradient_boosting":
            model = GradientBoostingRegressor(random_state=42)
            model.fit(X_train, y_train)
            predicted_scores = [clip(float(value), 0.0, 1.0) for value in model.predict(X_candidate)]
        else:
            model = RandomForestRegressor(n_estimators=200, random_state=42)
            model.fit(X_train, y_train)
            predicted_scores = [clip(float(value), 0.0, 1.0) for value in model.predict(X_candidate)]
    except Exception as exc:
        warnings.append(f"ranking model 訓練失敗：{exc}")
        return summarize_candidate_ranking(
            enabled=True,
            model_type=model_type,
            score_mode=score_mode,
            top_n=top_n,
            candidate_count=candidate_count,
            ranked_candidates=[],
            warnings=warnings,
        )

    ranked_pairs = sorted(
        list(enumerate(predicted_scores)),
        key=lambda item: item[1],
        reverse=True,
    )
    selected_pairs = ranked_pairs[: min(top_n, len(ranked_pairs))]

    ranked_candidates: list[MlRankedCandidate] = []
    for rank, (candidate_idx, predicted_score) in enumerate(selected_pairs, start=1):
        if candidate_idx >= len(resolved_params):
            warnings.append(f"candidate index 超出範圍（idx={candidate_idx}），已略過。")
            continue

        candidate_param = resolved_params[candidate_idx]
        candidate_warnings: list[str] = []
        try:
            verified_summary = run_core_mode_pipeline(rows, candidate_param)["summary"]
            verified_score, target_warnings = build_candidate_target(
                ac=float(verified_summary.ac),
                cumulative_return=float(verified_summary.cumulative_return),
                max_drawdown=float(verified_summary.max_drawdown),
                trade_count=int(verified_summary.trade_count),
                stability=float(verified_summary.stability),
                score_mode=score_mode,
            )
            candidate_warnings.extend(target_warnings)
            ranked_candidates.append(
                MlRankedCandidate(
                    rank=rank,
                    predicted_score=round(float(predicted_score), 6),
                    verified_score=round(float(verified_score), 6),
                    verified_summary=MlCandidateVerifiedSummary(
                        ac=round(float(verified_summary.ac), 6),
                        cumulative_return=round(float(verified_summary.cumulative_return), 6),
                        max_drawdown=round(float(verified_summary.max_drawdown), 6),
                        trade_count=int(verified_summary.trade_count),
                        win_rate=round(float(verified_summary.win_rate), 6),
                    ),
                    params=params_to_dict(candidate_param),
                    warnings=candidate_warnings,
                )
            )
        except Exception as exc:
            warnings.append(f"top {rank} candidate 正式驗證失敗：{exc}")

    if not ranked_candidates:
        warnings.append("top N 無法完成正式驗證。")

    return summarize_candidate_ranking(
        enabled=True,
        model_type=model_type,
        score_mode=score_mode,
        top_n=top_n,
        candidate_count=candidate_count,
        ranked_candidates=ranked_candidates,
        warnings=warnings,
    )


def train_ml_model(
    *,
    X_train: list[list[float]],
    y_train: list[int],
    model_type: str,
) -> tuple[Any | None, list[str]]:
    warnings: list[str] = []
    if model_type not in _SUPPORTED_MODEL_TYPES:
        warnings.append(f"不支援的 model_type：{model_type}")
        return None, warnings

    if len(set(y_train)) < 2:
        warnings.append("訓練資料僅有單一類別，略過該 fold 的模型訓練。")
        return None, warnings

    try:
        from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline
        from sklearn.preprocessing import StandardScaler
    except Exception as exc:  # pragma: no cover - environment dependent
        warnings.append(f"scikit-learn import 失敗，略過模型訓練：{exc}")
        return None, warnings

    model: Any
    if model_type == "logistic_regression":
        model = Pipeline(
            steps=[
                ("scaler", StandardScaler()),
                ("model", LogisticRegression(max_iter=1000, random_state=42)),
            ]
        )
    elif model_type == "random_forest":
        model = RandomForestClassifier(n_estimators=200, random_state=42)
    else:
        model = GradientBoostingClassifier(random_state=42)

    try:
        model.fit(X_train, y_train)
    except Exception as exc:
        warnings.append(f"模型訓練失敗（{model_type}）：{exc}")
        return None, warnings

    return model, warnings


def summarize_ml_model_validation(fold_metrics: list[MlModelFoldMetric]) -> MlModelAggregateMetrics:
    if not fold_metrics:
        return _empty_ml_model_aggregate()

    acc_values = [item.accuracy for item in fold_metrics]
    precision_values = [item.precision for item in fold_metrics]
    recall_values = [item.recall for item in fold_metrics]
    f1_values = [item.f1 for item in fold_metrics]

    return MlModelAggregateMetrics(
        accuracy_mean=round(_safe_mean(acc_values), 4),
        accuracy_std=round(_safe_std(acc_values), 4),
        precision_mean=round(_safe_mean(precision_values), 4),
        recall_mean=round(_safe_mean(recall_values), 4),
        f1_mean=round(_safe_mean(f1_values), 4),
        fold_count=len(fold_metrics),
    )


def extract_feature_importance(
    *,
    model: Any,
    feature_names: list[str],
    model_type: str,
) -> tuple[list[MlFeatureImportanceItem], list[str]]:
    warnings: list[str] = []
    if not feature_names:
        warnings.append("feature_count=0，無法計算 feature importance。")
        return [], warnings

    raw_importance: list[float] | None = None
    try:
        if model_type == "logistic_regression":
            named_steps = getattr(model, "named_steps", None)
            estimator = named_steps["model"] if isinstance(named_steps, dict) and "model" in named_steps else model
            coef = getattr(estimator, "coef_", None)
            if coef is None or len(coef) == 0:
                warnings.append("LogisticRegression 無 coef_，無法產生 feature importance。")
                return [], warnings
            coef_rows = [[float(value) for value in row] for row in coef]
            if not coef_rows or not coef_rows[0]:
                warnings.append("LogisticRegression coef_ 維度異常，無法產生 feature importance。")
                return [], warnings
            if len(coef_rows) == 1:
                raw_importance = [abs(value) for value in coef_rows[0]]
            else:
                col_count = len(coef_rows[0])
                raw_importance = [
                    _safe_mean([abs(row[col_idx]) for row in coef_rows if len(row) > col_idx])
                    for col_idx in range(col_count)
                ]
        else:
            feature_importances = getattr(model, "feature_importances_", None)
            if feature_importances is None:
                warnings.append(f"{model_type} 無 feature_importances_，無法產生 feature importance。")
                return [], warnings
            raw_importance = [float(value) for value in feature_importances]
    except Exception as exc:
        warnings.append(f"計算 feature importance 失敗：{exc}")
        return [], warnings

    if raw_importance is None:
        warnings.append("無可用 feature importance。")
        return [], warnings

    if len(raw_importance) != len(feature_names):
        warnings.append(
            f"feature importance 長度不一致（importance={len(raw_importance)}，feature={len(feature_names)}），已截斷對齊。"
        )
    bound = min(len(raw_importance), len(feature_names))
    if bound <= 0:
        warnings.append("無可用特徵欄位，無法產生 feature importance。")
        return [], warnings

    ranked = sorted(
        (
            MlFeatureImportanceItem(
                feature=feature_names[idx],
                importance=round(raw_importance[idx], 6),
                importance_mean=round(raw_importance[idx], 6),
                importance_std=0.0,
                fold_count=1,
            )
            for idx in range(bound)
        ),
        key=lambda item: item.importance,
        reverse=True,
    )
    return ranked[:20], warnings


def aggregate_feature_importance_across_folds(
    *,
    fold_feature_importance: list[list[MlFeatureImportanceItem]],
    successful_fold_count: int,
) -> tuple[list[MlFeatureImportanceItem], list[str]]:
    warnings: list[str] = []
    if not fold_feature_importance:
        return [], ["未取得可用的 feature importance fold。"]

    feature_buckets: dict[str, list[float]] = {}
    for fold_items in fold_feature_importance:
        seen_features: set[str] = set()
        for item in fold_items:
            if item.feature in seen_features:
                continue
            feature_buckets.setdefault(item.feature, []).append(float(item.importance))
            seen_features.add(item.feature)

    if not feature_buckets:
        return [], ["feature importance 聚合後為空。"]

    aggregated_items = [
        MlFeatureImportanceItem(
            feature=feature,
            importance=round(_safe_mean(values), 6),
            importance_mean=round(_safe_mean(values), 6),
            importance_std=round(_safe_std(values), 6),
            fold_count=len(values),
        )
        for feature, values in feature_buckets.items()
    ]
    aggregated_items.sort(key=lambda item: item.importance_mean or item.importance, reverse=True)
    top_items = aggregated_items[:20]

    if successful_fold_count >= 2:
        min_fold_count = min((item.fold_count or 0) for item in top_items) if top_items else 0
        if min_fold_count < successful_fold_count:
            warnings.append(
                "部分 feature importance 並非來自所有成功 fold，解讀時請留意穩定性。"
            )
        sparse_items = [item.feature for item in top_items if (item.fold_count or 0) < 2]
        if sparse_items:
            warnings.append(
                f"feature importance 有 {len(sparse_items)} 個特徵僅來自少數 fold（<2）。"
            )

    return top_items, warnings


def evaluate_ml_model_with_tss(
    *,
    X: list[list[float]],
    y: list[int],
    sample_dates: list[Any],
    feature_names: list[str],
    ml_settings: TimeSeriesMLSettings,
    target_mode: str,
) -> MlModelValidationResult:
    if not ml_settings.enable_model_training:
        return _empty_ml_model_validation(enabled=False)

    warnings: list[str] = []
    model_type = ml_settings.model_type

    if model_type not in _SUPPORTED_MODEL_TYPES:
        warnings.append(f"不支援的 model_type：{model_type}")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    if not X or not y:
        warnings.append("ML dataset 為空，無法訓練 baseline 模型。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    if len(feature_names) == 0:
        warnings.append("feature_count=0，無法訓練 baseline 模型。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    if len(sample_dates) != len(y):
        warnings.append(f"sample_dates 與 y 長度不一致（sample_dates={len(sample_dates)}，y={len(y)}）。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    if len(set(y)) < 2:
        warnings.append("y 僅有單一類別，無法訓練分類模型。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    splitter, _, split_warnings = make_time_series_splitter(sample_count=len(X), ml_settings=ml_settings)
    warnings.extend(split_warnings)

    try:
        splits = list(splitter.split(X))
    except ValueError as exc:
        warnings.append(f"TimeSeriesSplit 無法建立 folds：{exc}")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    if not splits:
        warnings.append("TimeSeriesSplit 未產生任何 fold，無法訓練模型。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    try:
        from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, precision_score, recall_score
    except Exception as exc:  # pragma: no cover - environment dependent
        warnings.append(f"scikit-learn metrics import 失敗：{exc}")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    fold_metrics: list[MlModelFoldMetric] = []
    fold_feature_importance: list[list[MlFeatureImportanceItem]] = []
    skipped_folds: list[str] = []

    for fold_index, (train_indices, test_indices) in enumerate(splits, start=1):
        train_idx_list = [int(item) for item in train_indices]
        test_idx_list = [int(item) for item in test_indices]
        if not train_idx_list or not test_idx_list:
            reason = "樣本不足（train/test 為空）"
            warnings.append(f"fold {fold_index} 的 train/test 為空，已略過。")
            skipped_folds.append(f"fold {fold_index}: {reason}")
            continue

        if len(train_idx_list) < 2 or len(test_idx_list) < 2:
            reason = "樣本不足（train/test 小於 2）"
            warnings.append(f"fold {fold_index} 的 train/test 樣本不足（<2），已略過。")
            skipped_folds.append(f"fold {fold_index}: {reason}")
            continue

        if train_idx_list[-1] >= test_idx_list[0]:
            warnings.append(f"fold {fold_index} 發現 train_end >= test_start，已略過。")
            skipped_folds.append(f"fold {fold_index}: 時序錯誤（train_end >= test_start）")
            continue

        y_train = [y[idx] for idx in train_idx_list]
        y_test = [y[idx] for idx in test_idx_list]
        if len(set(y_train)) < 2:
            warnings.append(f"fold {fold_index} 的 train 僅有單一類別，已略過。")
            skipped_folds.append(f"fold {fold_index}: 單一類別（train）")
            continue
        if len(set(y_test)) < 2:
            warnings.append(f"fold {fold_index} 的 test 僅有單一類別，metrics 可能失真。")

        X_train = [X[idx] for idx in train_idx_list]
        X_test = [X[idx] for idx in test_idx_list]

        model, train_warnings = train_ml_model(X_train=X_train, y_train=y_train, model_type=model_type)
        warnings.extend(f"fold {fold_index}：{item}" for item in train_warnings)
        if model is None:
            skipped_folds.append(f"fold {fold_index}: 模型訓練失敗")
            continue

        try:
            y_pred = model.predict(X_test)
        except Exception as exc:
            warnings.append(f"fold {fold_index} 預測失敗：{exc}")
            skipped_folds.append(f"fold {fold_index}: 預測失敗")
            continue

        cm_raw = confusion_matrix(y_test, y_pred, labels=[0, 1])
        cm_list = [[int(cm_raw[0][0]), int(cm_raw[0][1])], [int(cm_raw[1][0]), int(cm_raw[1][1])]]

        fold_metrics.append(
            MlModelFoldMetric(
                fold_index=fold_index,
                train_start=sample_dates[train_idx_list[0]],
                train_end=sample_dates[train_idx_list[-1]],
                test_start=sample_dates[test_idx_list[0]],
                test_end=sample_dates[test_idx_list[-1]],
                sample_count=len(test_idx_list),
                positive_count=sum(1 for value in y_test if value == 1),
                negative_count=sum(1 for value in y_test if value == 0),
                accuracy=round(float(accuracy_score(y_test, y_pred)), 4),
                precision=round(float(precision_score(y_test, y_pred, zero_division=0)), 4),
                recall=round(float(recall_score(y_test, y_pred, zero_division=0)), 4),
                f1=round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
                confusion_matrix=cm_list,
            )
        )

        fold_importance, fi_warnings = extract_feature_importance(
            model=model,
            feature_names=feature_names,
            model_type=model_type,
        )
        warnings.extend(f"fold {fold_index}：{item}" for item in fi_warnings)
        if fold_importance:
            fold_feature_importance.append(fold_importance)

    if not fold_metrics:
        warnings.append("未取得任何有效模型 fold metrics。")
        return MlModelValidationResult(
            enabled=True,
            model_type=model_type,
            target_mode=target_mode,
            metrics=_empty_ml_model_aggregate(),
            warnings=warnings,
        )

    successful_fold_count = len(fold_metrics)
    split_fold_count = len(splits)
    if successful_fold_count < 2:
        warnings.append(f"成功模型 fold 數過少（{successful_fold_count}），驗證穩定性有限。")
    if successful_fold_count != split_fold_count:
        warnings.append(
            f"model metrics fold_count({successful_fold_count}) 與 TimeSeriesSplit fold_count({split_fold_count}) 不一致。"
        )
    if skipped_folds:
        warnings.append(f"共有 {len(skipped_folds)} 個 fold 因單一類別或樣本不足等原因被略過。")

    feature_importance: list[MlFeatureImportanceItem] = []
    if fold_feature_importance:
        feature_importance, fi_warnings = aggregate_feature_importance_across_folds(
            fold_feature_importance=fold_feature_importance,
            successful_fold_count=successful_fold_count,
        )
        warnings.extend(fi_warnings)
        if len(fold_feature_importance) < successful_fold_count:
            warnings.append(
                f"feature importance 僅來自 {len(fold_feature_importance)}/{successful_fold_count} 個成功 fold。"
            )
    else:
        warnings.append("所有成功 fold 均未能取得 feature importance。")

    return MlModelValidationResult(
        enabled=True,
        model_type=model_type,
        target_mode=target_mode,
        metrics=summarize_ml_model_validation(fold_metrics),
        fold_metrics=fold_metrics,
        feature_importance=feature_importance,
        warnings=warnings,
    )


def evaluate_rule_based_with_time_series_split(
    *,
    rows: list[MarketRow],
    params: CoreModeParams,
    ml_settings: TimeSeriesMLSettings,
    candidate_params: list[CoreModeParams] | None = None,
) -> TimeSeriesValidationResult:
    if not ml_settings.enabled:
        return build_disabled_time_series_validation_result(ml_settings=ml_settings)

    splitter, effective_gap, warnings = make_time_series_splitter(
        sample_count=len(rows),
        ml_settings=ml_settings,
    )

    ml_model_validation = _empty_ml_model_validation(enabled=False)
    ml_candidate_ranking = _empty_candidate_ranking()
    if ml_settings.enable_candidate_ranking:
        ml_candidate_ranking = rank_candidates_with_ml(
            rows=rows,
            candidate_params=candidate_params or [],
            ml_settings=ml_settings,
        )

    dataset_payload = build_ml_dataset(rows=rows, params=params, ml_settings=ml_settings)
    dataset_summary = dataset_payload["dataset_summary"]
    warnings.extend(dataset_payload.get("warnings", []))
    ml_model_validation = evaluate_ml_model_with_tss(
        X=dataset_payload.get("X", []),
        y=dataset_payload.get("y", []),
        sample_dates=dataset_payload.get("sample_dates", []),
        feature_names=dataset_payload.get("feature_names", []),
        ml_settings=ml_settings,
        target_mode=ml_settings.target_mode,
    )

    if not rows:
        warnings.append("沒有可用資料，無法進行 TimeSeriesSplit 驗證。")
        result = _empty_validation(
            ml_settings=ml_settings,
            effective_gap=effective_gap,
            warnings=warnings,
            dataset_summary=dataset_summary,
        )
        result.ml_model_validation = ml_model_validation
        result.ml_candidate_ranking = ml_candidate_ranking
        return result

    try:
        splits = list(splitter.split(list(range(len(rows)))))
    except ValueError as exc:
        warnings.append(f"TimeSeriesSplit 無法建立 folds：{exc}")
        result = _empty_validation(
            ml_settings=ml_settings,
            effective_gap=effective_gap,
            warnings=warnings,
            dataset_summary=dataset_summary,
        )
        result.ml_model_validation = ml_model_validation
        result.ml_candidate_ranking = ml_candidate_ranking
        return result

    if not splits:
        warnings.append("TimeSeriesSplit 未產生任何 fold，請調整 n_splits/test_size/gap。")
        result = _empty_validation(
            ml_settings=ml_settings,
            effective_gap=effective_gap,
            warnings=warnings,
            dataset_summary=dataset_summary,
        )
        result.ml_model_validation = ml_model_validation
        result.ml_candidate_ranking = ml_candidate_ranking
        return result

    fold_metrics: list[TimeSeriesFoldMetric] = []
    for fold_index, (train_indices, test_indices) in enumerate(splits, start=1):
        if len(train_indices) == 0 or len(test_indices) == 0:
            warnings.append(f"fold {fold_index} 的 train/test 為空，已略過。")
            continue

        train_end_idx = int(train_indices[-1])
        test_start_idx = int(test_indices[0])
        if train_end_idx >= test_start_idx:
            warnings.append(f"fold {fold_index} 發現 train_end >= test_start，已略過。")
            continue

        test_rows = rows[int(test_indices[0]) : int(test_indices[-1]) + 1]
        if len(test_rows) < 20:
            warnings.append(f"fold {fold_index} 的測試樣本少於 20，結果可能不穩定。")

        summary = run_core_mode_pipeline(test_rows, params)["summary"]
        fold_metrics.append(
            TimeSeriesFoldMetric(
                fold_index=fold_index,
                train_start=rows[int(train_indices[0])].date,
                train_end=rows[train_end_idx].date,
                test_start=rows[test_start_idx].date,
                test_end=rows[int(test_indices[-1])].date,
                gap=ml_settings.gap,
                effective_gap=effective_gap,
                ac=summary.ac,
                win_rate=summary.win_rate,
                cumulative_return=summary.cumulative_return,
                max_drawdown=summary.max_drawdown,
                trade_count=summary.trade_count,
                profit_factor=summary.profit_factor,
                expectancy=summary.expectancy,
            )
        )

    if not fold_metrics:
        warnings.append("未取得任何有效 fold metrics，請檢查資料量與設定。")

    return TimeSeriesValidationResult(
        enabled=True,
        mode="time_series_split_rule_based",
        n_splits=ml_settings.n_splits,
        test_size=ml_settings.test_size,
        gap=ml_settings.gap,
        effective_gap=effective_gap,
        prediction_horizon=ml_settings.prediction_horizon,
        fold_metrics=fold_metrics,
        aggregate_metrics=summarize_time_series_validation(fold_metrics),
        dataset_summary=dataset_summary,
        ml_model_validation=ml_model_validation,
        ml_candidate_ranking=ml_candidate_ranking,
        warnings=warnings,
    )
