import type { CoreModeParams, CoreModeWeightStrategyKey } from './types/coreMode';

export const CORE_PARAM_KEYS: Array<keyof CoreModeParams> = [
  'breakout_lookback',
  'momentum_window',
  'state_threshold',
  'shape_threshold',
  'trend_threshold',
  'max_pullback_depth',
  'hard_stop_pct',
  'trailing_stop_pct',
];

export const WEIGHT_STRATEGY_PROFILES: Record<Exclude<CoreModeWeightStrategyKey, 'custom'>, Partial<CoreModeParams>> = {
  balanced: {
    weighted_technical_weight: 0.38,
    weighted_institutional_weight: 0.3,
    weighted_news_weight: 0.15,
    weighted_momentum_weight: 0.17,
  },
  technical_first: {
    weighted_technical_weight: 0.55,
    weighted_institutional_weight: 0.2,
    weighted_news_weight: 0.05,
    weighted_momentum_weight: 0.2,
  },
  institutional_first: {
    weighted_technical_weight: 0.25,
    weighted_institutional_weight: 0.5,
    weighted_news_weight: 0.05,
    weighted_momentum_weight: 0.2,
  },
  momentum_first: {
    weighted_technical_weight: 0.25,
    weighted_institutional_weight: 0.2,
    weighted_news_weight: 0.05,
    weighted_momentum_weight: 0.5,
  },
  technical_institutional_balance: {
    weighted_technical_weight: 0.45,
    weighted_institutional_weight: 0.35,
    weighted_news_weight: 0.05,
    weighted_momentum_weight: 0.15,
  },
  low_news: {
    weighted_technical_weight: 0.42,
    weighted_institutional_weight: 0.33,
    weighted_news_weight: 0,
    weighted_momentum_weight: 0.25,
  },
};

const WEIGHTED_KEYS: Array<keyof CoreModeParams> = [
  'weighted_technical_weight',
  'weighted_institutional_weight',
  'weighted_news_weight',
  'weighted_momentum_weight',
];

export function detectWeightStrategy(params: CoreModeParams): CoreModeWeightStrategyKey {
  for (const [strategy, profile] of Object.entries(WEIGHT_STRATEGY_PROFILES) as Array<
    [Exclude<CoreModeWeightStrategyKey, 'custom'>, Partial<CoreModeParams>]
  >) {
    const matched = WEIGHTED_KEYS.every((key) => Math.abs(Number(params[key]) - Number(profile[key])) < 0.0001);
    if (matched) return strategy;
  }
  return 'custom';
}

export function applyWeightStrategyToParams(params: CoreModeParams, strategy: CoreModeWeightStrategyKey): CoreModeParams {
  if (strategy === 'custom') return { ...params };
  return {
    ...params,
    ...WEIGHT_STRATEGY_PROFILES[strategy],
  };
}

export function applyManualWeightChange(
  params: CoreModeParams,
  key: keyof CoreModeParams,
  value: number
): { params: CoreModeParams; strategy: CoreModeWeightStrategyKey } {
  return {
    params: {
      ...params,
      [key]: value,
    },
    strategy: 'custom',
  };
}
