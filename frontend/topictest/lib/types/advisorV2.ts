import type { CoreModePriceChart } from './coreMode';

export interface AdvisorOverviewRequest {
  symbol: string;
  as_of_date?: string;
  preset_id?: string;
  use_active_preset?: boolean;
  window_spec?: string;
  validation_mode?: 'rolling_walk_forward' | 'expanding_walk_forward';
  rolling_settings?: {
    step_days?: number;
    min_overlap_ratio?: number;
  };
  holdout_settings?: {
    enabled?: boolean;
    holdout_days?: number;
  };
}

export interface AdvisorOverviewResponse {
  request_id: string;
  job_id: string;
  advisor_report_status: string;
  symbol: string;
  as_of_date: string;
  active_preset: {
    id: string;
    name: string;
    description: string;
    params: Record<string, number>;
  } | null;
  trend_conclusion: string;
  confidence_level: string;
  condition_checks: Array<{
    key: string;
    label: string;
    passed: boolean;
    status?: string;
    value?: number | string | boolean | null;
    threshold?: number | string | boolean | null;
  }>;
  reason_points: string[];
  rule_summary: string[];
  technical_snapshot: {
    date?: string | null;
    ma5?: number | null;
    ma20?: number | null;
    ma60?: number | null;
    rsi14?: number | null;
    macd_hist?: number | null;
  };
  institutional_snapshot: {
    date?: string | null;
    foreign_net?: number | null;
    trust_net?: number | null;
    dealer_net?: number | null;
    total_net?: number | null;
  };
  technical_history?: Array<{
    date?: string | null;
    ma5?: number | null;
    ma20?: number | null;
    ma60?: number | null;
    rsi14?: number | null;
    macd_hist?: number | null;
  }>;
  institutional_history?: Array<{
    date?: string | null;
    foreign_net?: number | null;
    trust_net?: number | null;
    dealer_net?: number | null;
    total_net?: number | null;
  }>;
  price_chart: CoreModePriceChart;
  credibility_summary: CredibilitySummary | null;
  backtest_snapshot_status: 'ready' | 'pending';
  advisor_report_job: {
    job_id: string;
    status: string;
  };
}

export interface CredibilitySummary {
  ac: number;
  win_rate: number;
  max_drawdown: number;
  stability: number;
  expectancy: number;
  future_trend_quality: number;
  cumulative_return: number;
  trade_count: number;
}

export interface AdvisorBacktestSnapshot {
  status: 'ready' | 'pending';
  cache_hit: boolean;
  cache_key: string;
  symbol: string;
  preset_id: string;
  as_of_date: string;
  window_spec: string;
  validation_mode: string;
  credibility_summary: CredibilitySummary;
  price_chart: CoreModePriceChart;
  equity_curve: Array<{ date: string; equity: number }>;
  benchmark_curve: Array<{ date: string; equity: number }>;
  drawdown_curve: Array<{ date: string; drawdown: number }>;
  walk_forward_summary: {
    aggregate: Record<string, number>;
    holdout: Record<string, number>;
    fold_count: number;
  };
  regime_summary: Array<Record<string, unknown>>;
  trade_preview: Array<Record<string, unknown>>;
}

export interface AdvisorNewsPayload {
  count: number;
  fallback_mode: boolean;
  preview: Array<{
    id: string;
    title: string;
    timestamp: string;
    url?: string | null;
  }>;
}

export interface AdvisorFullReport {
  symbol: string;
  as_of_date: string;
  trend_conclusion: string;
  confidence_level: string;
  rule_summary: string[];
  final_summary: string;
  recommendation_basis: string[];
  risk_points: string[];
  source_highlights: Array<{
    title: string;
    summary: string;
    url?: string | null;
  }>;
  news_fallback_mode: boolean;
  llm_fallback_mode: boolean;
  status: string;
}

export type AdvisorStreamEventName =
  | 'core_backtest_ready'
  | 'advisor_full_report_ready'
  | 'news_ready'
  | 'failed'
  | 'completed'
  | 'keepalive';

export interface AdvisorStreamEvent {
  event: AdvisorStreamEventName;
  data: Record<string, unknown>;
}

