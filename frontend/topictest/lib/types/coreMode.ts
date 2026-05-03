export interface CoreModeParamSchemaItem {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export type CoreModeWeightStrategyKey =
  | 'balanced'
  | 'technical_first'
  | 'institutional_first'
  | 'momentum_first'
  | 'technical_institutional_balance'
  | 'low_news'
  | 'custom';

export interface CoreModeParams {
  breakout_lookback: number;
  momentum_window: number;
  state_threshold: number;
  shape_threshold: number;
  trend_threshold: number;
  max_pullback_depth: number;
  hard_stop_pct: number;
  trailing_stop_pct: number;
  technical_ma_weight: number;
  technical_macd_weight: number;
  technical_rsi_weight: number;
  technical_kd_weight: number;
  weighted_technical_weight: number;
  weighted_institutional_weight: number;
  weighted_news_weight: number;
  weighted_momentum_weight: number;
  state_weighted_score_weight: number;
  state_momentum_weight: number;
  state_institutional_weight: number;
  trend_state_weight: number;
  trend_shape_weight: number;
  trend_breakout_weight: number;
  shape_breakout_weight: number;
  shape_slope_weight: number;
  shape_efficiency_weight: number;
  shape_pullback_weight: number;
}

export interface TimeSeriesMLSettings {
  enabled: boolean;
  enable_model_training?: boolean;
  n_splits?: number;
  test_size?: number;
  gap?: number;
  max_train_size?: number | null;
  prediction_horizon?: number;
  future_quality_threshold?: number;
  target_mode?: 'future_quality' | 'trade_return' | 'trend_label';
  model_type?: 'random_forest' | 'gradient_boosting' | 'logistic_regression';
  scoring_mode?: 'accuracy' | 'f1' | 'return_score' | 'balanced_backtest_score';
  enable_candidate_ranking?: boolean;
  candidate_ranking_top_n?: number;
  candidate_ranking_model_type?: 'random_forest' | 'gradient_boosting' | 'logistic_regression';
  candidate_ranking_score_mode?: 'balanced_score' | 'return_score' | 'ac_score' | 'drawdown_score';
}

export interface AutoSearchSettings {
  enabled: boolean;
  mode?: 'single_stock_search' | 'multi_stock_search';
  symbols?: string[];
  top_n?: number;
  candidate_pool_size?: number;
  ml_prefilter_top_n?: number;
  final_verify_top_n?: number;
  score_mode?: 'balanced_score' | 'return_score' | 'low_drawdown_score' | 'stable_score';
  use_ml_prefilter?: boolean;
  use_time_series_validation?: boolean;
  use_holdout_validation?: boolean;
  require_min_trade_count?: boolean;
  min_trade_count?: number;
  max_runtime_level?: 'balanced' | 'deep';
  adaptive_search_settings?: {
    enabled?: boolean;
    max_iterations?: number;
    candidates_per_iteration?: number;
    verify_top_n_per_iteration?: number;
    keep_elite_n?: number;
    patience?: number;
    min_improvement?: number;
    use_ml_prefilter?: boolean;
    refinement_strength?: 'small' | 'medium' | 'large';
    stop_when_score_reaches?: number | null;
  };
  final_holdout_settings?: {
    enabled?: boolean;
    mode?: 'ratio' | 'days';
    train_ratio?: number;
    validation_ratio?: number;
    final_holdout_ratio?: number;
    final_holdout_days?: number | null;
    min_final_holdout_days?: number;
  };
}

export interface CoreModeMlValidation {
  enabled: boolean;
  mode?: 'time_series_split_rule_based';
  n_splits?: number;
  test_size?: number;
  gap?: number;
  effective_gap?: number;
  prediction_horizon?: number;
  fold_metrics?: Array<{
    fold_index: number;
    train_start: string;
    train_end: string;
    test_start: string;
    test_end: string;
    gap: number;
    effective_gap: number;
    ac: number;
    win_rate: number;
    cumulative_return: number;
    max_drawdown: number;
    trade_count: number;
    profit_factor: number;
    expectancy: number;
  }>;
  aggregate_metrics?: {
    fold_ac_mean: number;
    fold_ac_std: number;
    fold_return_mean: number;
    fold_return_std: number;
    fold_mdd_mean: number;
    fold_mdd_std: number;
    fold_trade_count_mean: number;
    stability_score: number;
  };
  dataset_summary?: {
    enabled: boolean;
    target_mode: 'future_quality' | 'trade_return' | 'trend_label';
    prediction_horizon: number;
    future_quality_threshold: number;
    target_warning: string | null;
    unsupported_target_mode: 'future_quality' | 'trade_return' | 'trend_label' | null;
    sample_count: number;
    feature_count: number;
    positive_count: number;
    negative_count: number;
    positive_rate: number;
    dropped_feature_names: string[];
    feature_names: string[];
    warnings: string[];
  } | null;
  ml_model_validation?: {
    enabled: boolean;
    model_type?: 'random_forest' | 'gradient_boosting' | 'logistic_regression' | null;
    target_mode?: 'future_quality' | 'trade_return' | 'trend_label' | null;
    metrics?: {
      accuracy_mean: number;
      accuracy_std: number;
      precision_mean: number;
      recall_mean: number;
      f1_mean: number;
      fold_count: number;
    } | null;
    fold_metrics?: Array<{
      fold_index: number;
      train_start: string;
      train_end: string;
      test_start: string;
      test_end: string;
      sample_count: number;
      positive_count: number;
      negative_count: number;
      accuracy: number;
      precision: number;
      recall: number;
      f1: number;
      confusion_matrix: number[][];
    }>;
    feature_importance?: Array<{
      feature: string;
      importance: number;
      importance_mean?: number;
      importance_std?: number;
      fold_count?: number;
    }>;
    warnings: string[];
  };
  ml_candidate_ranking?: {
    enabled: boolean;
    model_type?: 'random_forest' | 'gradient_boosting' | 'logistic_regression' | null;
    score_mode?: 'balanced_score' | 'return_score' | 'ac_score' | 'drawdown_score' | null;
    top_n: number;
    candidate_count: number;
    ranked_candidates: Array<{
      rank: number;
      predicted_score: number;
      verified_score: number;
      verified_summary: {
        ac: number;
        cumulative_return: number;
        max_drawdown: number;
        trade_count: number;
        win_rate: number;
      };
      params: Partial<CoreModeParams>;
      warnings: string[];
    }>;
    warnings: string[];
  };
  warnings: string[];
}

export interface CoreModePreset {
  id: string;
  name: string;
  description: string;
  category?: string;
  params: CoreModeParams;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface CoreModeSchemaResponse {
  mode: string;
  title: string;
  description: string;
  params: Record<keyof CoreModeParams, CoreModeParamSchemaItem>;
  weight_groups?: Record<string, string[]>;
  default_params: CoreModeParams;
  default_active_policy: string;
  active_preset?: CoreModePreset | null;
}

export interface CoreModePresetsResponse {
  active_preset_id: string;
  active_preset: CoreModePreset | null;
  presets: CoreModePreset[];
}

export interface CoreModeDateRange {
  start_date: string;
  end_date: string;
}

export interface CoreModeRollingSettings {
  step_days?: number;
  min_overlap_ratio?: number;
}

export interface CoreModeHoldoutSettings {
  enabled?: boolean;
  holdout_days?: number;
}

export interface CoreModeRunRequest {
  symbol: string;
  date_range: CoreModeDateRange;
  params?: Partial<CoreModeParams>;
  validation_mode?: 'rolling_walk_forward' | 'expanding_walk_forward';
  rolling_settings?: CoreModeRollingSettings;
  holdout_settings?: CoreModeHoldoutSettings;
  run_optimization?: boolean;
  ml_settings?: Partial<TimeSeriesMLSettings>;
  auto_search_settings?: Partial<AutoSearchSettings>;
}

export interface CoreModeChartCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface CoreModeChartPoint {
  time: string;
  value: number | null;
}

export interface CoreModePriceChart {
  candles: CoreModeChartCandle[];
  volume: Array<{ time: string; value: number; color: string }>;
  overlays: {
    MA20: CoreModeChartPoint[];
    MA60: CoreModeChartPoint[];
  };
  markers: Array<{
    time: string;
    position: 'aboveBar' | 'belowBar';
    shape: string;
    color: string;
    text: string;
    type: string;
  }>;
}

export interface CoreModeEquityPoint {
  date: string;
  equity: number;
}

export interface CoreModeScoreChart {
  series: Array<{
    id: string;
    name: string;
    data: Array<{ time: string; value: number }>;
  }>;
}

export interface CoreModeBacktestSummary {
  ac: number;
  win_rate: number;
  expectancy: number;
  profit_factor: number;
  cumulative_return: number;
  max_drawdown: number;
  trade_count: number;
  future_trend_quality: number;
  stability: number;
  used_params: CoreModeParams;
  trend_conclusion: string;
  confidence_level: string;
  signal_status: {
    early_signal: string | null;
    formal_signal: string | null;
  };
  conclusion_summary?: string;
  action_suggestion?: '買進' | '觀望' | '減碼' | '風險高' | string;
  reason_points?: string[];
  key_risks?: string[];
  condition_checks?: Array<{
    key: string;
    label: string;
    passed: boolean;
    status?: string;
    value: number | boolean | string | null;
    threshold: number | boolean | string | null;
  }>;
  early_signal_status?: string | null;
  formal_signal_status?: string | null;
  suggested_horizon?: string;
  reasoning: {
    trend_conclusion: string;
    confidence_level: string;
    checks: Array<{
      key: string;
      label: string;
      passed: boolean;
      value: number | boolean;
      threshold: number | boolean;
    }>;
    reason_points: string[];
  };
}

export interface CoreModeTradeRecord {
  entry_signal_date: string;
  entry_date: string;
  exit_signal_date: string;
  exit_date: string;
  entry_price: number;
  exit_price: number;
  return_pct: number;
  holding_days: number;
  mfe: number;
  mae: number;
  entry_reason: string;
  exit_reason: string;
}

export interface CoreModeWalkForwardFold {
  fold_id: string;
  overlap_ratio: number;
  train_start: string;
  train_end: string;
  validation_start: string;
  validation_end: string;
  test_start: string;
  test_end: string;
  validation_metrics: Record<string, number>;
  test_metrics: Record<string, number>;
}

export interface CoreModeWalkForward {
  folds: CoreModeWalkForwardFold[];
  aggregate: Record<string, number>;
  holdout: Record<string, number>;
}

export interface CoreModeRegimeBreakdownItem {
  regime: string;
  sample_count: number;
  candidate_count: number;
  ac: number;
  win_rate: number;
  future_trend_quality: number;
}

export interface CoreModeCandidate {
  params: CoreModeParams;
  profile?: string;
  selection_reason?: string;
  summary: {
    ac: number;
    win_rate: number;
    expectancy: number;
    profit_factor: number;
    cumulative_return: number;
    max_drawdown: number;
    trade_count: number;
    avg_mfe: number;
    avg_mae: number;
    future_trend_quality: number;
    stability: number;
  };
  holdout: {
    ac: number;
    win_rate: number;
    expectancy: number;
    profit_factor: number;
    cumulative_return: number;
    max_drawdown: number;
    trade_count: number;
    avg_mfe: number;
    avg_mae: number;
    future_trend_quality: number;
    stability: number;
  };
  return_objective: number;
  stable_objective: number;
  balanced_objective: number;
  walk_forward?: Array<{
    fold_id: string;
    overlap_ratio: number;
    train_start: string;
    train_end: string;
    validation_start: string;
    validation_end: string;
    test_start: string;
    test_end: string;
    validation_metrics: Record<string, number>;
    test_metrics: Record<string, number>;
  }>;
}

export interface CoreModeRunResponse {
  meta: {
    symbol: string;
    date_range: CoreModeDateRange;
    as_of_date: string;
    sample_count: number;
    validation_mode: string;
    rolling_settings?: CoreModeRollingSettings;
    holdout_settings?: CoreModeHoldoutSettings;
    ac_definition: string;
    tail_execution_policy?: string;
    tail_position_excluded?: boolean;
  };
  warnings?: string[];
  summary: CoreModeBacktestSummary;
  price_chart: CoreModePriceChart;
  score_chart: CoreModeScoreChart;
  trades: CoreModeTradeRecord[];
  equity_curve: CoreModeEquityPoint[];
  walk_forward: CoreModeWalkForward;
  regime_breakdown: CoreModeRegimeBreakdownItem[];
  comparison_candidates: CoreModeCandidate[];
  coarse_stage_candidates: CoreModeCandidate[];
  optimization: {
    best_return_params: CoreModeCandidate;
    best_stable_params: CoreModeCandidate;
    best_balanced_params: CoreModeCandidate;
    coarse_count: number;
    refined_count: number;
    search_space: Record<string, any>;
    validation_design: Record<string, any>;
  };
  ml_validation?: CoreModeMlValidation;
  auto_search_result?: {
    enabled: boolean;
    mode?: 'single_stock_search' | 'multi_stock_search';
    symbols?: string[];
    top_n?: number;
    candidate_count?: number;
    evaluated_candidate_count?: number;
    final_verified_count?: number;
    ranking_basis?: 'verified_score' | 'cross_stock_score';
    split_summary?: {
      train_start: string | null;
      train_end: string | null;
      validation_start: string | null;
      validation_end: string | null;
      final_holdout_start: string | null;
      final_holdout_end: string | null;
      train_count: number;
      validation_count: number;
      final_holdout_count: number;
      warnings: string[];
    };
    results: Array<{
      rank: number;
      predicted_score: number | null;
      validation_score?: number | null;
      verified_score: number | null;
      cross_stock_score: number | null;
      final_holdout_score?: number | null;
      final_holdout_cross_stock_score?: number | null;
      final_holdout_summary?: Record<string, unknown> | null;
      final_holdout_symbol_results?: Array<Record<string, unknown>>;
      params: Partial<CoreModeParams>;
      source_tags: string[];
      summary: {
        ac: number | null;
        cumulative_return: number | null;
        max_drawdown: number | null;
        trade_count: number | null;
        stability_score: number | null;
        holdout_score: number | null;
      };
      symbol_results: Array<{
        symbol: string;
        success: boolean;
        validation_score?: number | null;
        verified_score: number | null;
        ac: number | null;
        cumulative_return: number | null;
        max_drawdown: number | null;
        trade_count: number | null;
        stability_score: number | null;
        final_holdout_score?: number | null;
        warnings: string[];
      }>;
      warnings: string[];
    }>;
    warnings: string[];
    adaptive_trace?: {
      enabled: boolean;
      stop_reason?: 'max_iterations' | 'patience' | 'score_target_reached' | null;
      best_score_progression: number[];
      iterations: Array<{
        iteration: number;
        candidate_count: number;
        verified_count: number;
        best_score: number;
        improvement: number | null;
        elite_count: number;
        warnings: string[];
      }>;
    };
  };
  active_preset: CoreModePreset | null;
}

export interface CoreModePresetSaveRequest {
  name: string;
  description: string;
  params: CoreModeParams;
  preset_id?: string;
}

export interface CoreModeDecisionRequest {
  symbol: string;
  as_of_date?: string;
  preset_id?: string;
  use_active_preset?: boolean;
}

export interface CoreModeDecisionResponse {
  symbol: string;
  as_of_date: string;
  active_preset: CoreModePreset | null;
  preset_id?: string | null;
  state_score: number;
  trend_shape_score: number;
  trend_score: number;
  weighted_score: number;
  trend_conclusion: string;
  confidence_level: string;
  conclusion_summary?: string;
  condition_checks?: Array<{
    key: string;
    label: string;
    passed: boolean;
    status?: string;
    value: number | boolean | string | null;
    threshold: number | boolean | string | null;
  }>;
  early_signal_status?: string | null;
  formal_signal_status?: string | null;
  reason_points: string[];
  action_suggestion?: string;
  risk_notes?: string[];
  warnings?: string[];
  reasoning: Record<string, unknown>;
  technical_snapshot: Record<string, number | string | null>;
  institutional_snapshot: Record<string, number | string | null>;
  price_chart: CoreModePriceChart;
}
