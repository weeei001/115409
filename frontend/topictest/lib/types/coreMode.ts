export interface CoreModeParamSchemaItem {
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

export interface CoreModeParams {
  breakout_lookback: number;
  momentum_window: number;
  state_threshold: number;
  shape_threshold: number;
  trend_threshold: number;
  max_pullback_depth: number;
  hard_stop_pct: number;
  trailing_stop_pct: number;
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
  reasoning: Record<string, unknown>;
  technical_snapshot: Record<string, number | string | null>;
  institutional_snapshot: Record<string, number | string | null>;
  price_chart: CoreModePriceChart;
}
