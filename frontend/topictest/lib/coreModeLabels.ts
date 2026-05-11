import type { CoreModeParams } from './types/coreMode';

export const CORE_MODE_PARAM_LABELS: Record<keyof CoreModeParams, string> = {
  breakout_lookback: '突破回看天數',
  momentum_window: '動能視窗',
  state_threshold: '狀態門檻',
  shape_threshold: '型態門檻',
  trend_threshold: '綜合趨勢門檻',
  max_pullback_depth: '最大容許拉回',
  hard_stop_pct: '硬停損比例',
  trailing_stop_pct: '移動停損比例',
  technical_ma_weight: '技術分數：均線權重',
  technical_macd_weight: '技術分數：MACD 權重',
  technical_rsi_weight: '技術分數：RSI 權重',
  technical_kd_weight: '技術分數：KD 權重',
  weighted_technical_weight: '加權分數：技術權重',
  weighted_institutional_weight: '加權分數：法人權重',
  weighted_news_weight: '加權分數：新聞權重',
  weighted_momentum_weight: '加權分數：動能權重',
  state_weighted_score_weight: '狀態分數：加權分數權重',
  state_momentum_weight: '狀態分數：動能權重',
  state_institutional_weight: '狀態分數：法人權重',
  trend_state_weight: '綜合趨勢分數：狀態權重',
  trend_shape_weight: '綜合趨勢分數：型態權重',
  trend_breakout_weight: '綜合趨勢分數：突破權重',
  shape_breakout_weight: '型態分數：突破權重',
  shape_slope_weight: '型態分數：MA20 斜率權重',
  shape_efficiency_weight: '型態分數：趨勢效率權重',
  shape_pullback_weight: '型態分數：拉回健康度權重',
};

export const CORE_MODE_FEATURE_LABELS: Record<string, string> = {
  close_position_to_ma20: '收盤價相對 MA20',
  close_position_to_ma60: '收盤價相對 MA60',
  ma5_above_ma20: 'MA5 是否高於 MA20',
  ma20_above_ma60: 'MA20 是否高於 MA60',
  ma20_slope: 'MA20 斜率',
  momentum_return: '動能區間報酬',
  trend_efficiency: '趨勢效率',
  volume_ratio: '量能比',
  breakout_strength: '突破強度',
  pullback_depth: '拉回深度',
  ma_score: '均線分數',
  macd_score: 'MACD 分數',
  rsi_score: 'RSI 分數',
  kd_score: 'KD 分數',
  technical_score: '技術分數',
  institutional_score: '法人分數',
  total_net_strength: '最新法人力道',
  weighted_score: '加權分數',
  state_score: '狀態分數',
  trend_shape_score: '型態分數',
  trend_score: '綜合趨勢分數',
};

export const CORE_MODE_METRIC_LABELS: Record<string, string> = {
  validation_score: '正式驗證分數',
  verified_score: '正式驗證分數（舊相容）',
  final_holdout_score: '未知區驗證分數',
  final_holdout_cross_stock_score: '未知區多股泛用分數',
  cross_stock_score: '多股泛用分數',
  predicted_score: 'ML 預估分數',
  ranking_basis: '排序依據',
  sample_count: '樣本數',
  feature_count: '特徵數',
  positive_rate: '正樣本比例',
  importance_mean: '平均重要度',
  importance_std: '重要度標準差',
  fold_count: '有效 fold 數',
  params: '參數組合',
  feature: '特徵',
  n_splits: '切分 fold 數',
  test_size: '每 fold 測試樣本數',
  gap: '訓練/測試間隔',
  effective_gap: '實際間隔',
  prediction_horizon: '預測窗',
  target_mode: '目標類型',
  model_type: '模型類型',
  ranking_model_type: '候選排序模型',
  ranking_score_mode: '候選排序目標',
  candidate_ranking_top_n: '候選排序保留數',
  future_quality_threshold: '未來趨勢品質門檻',
  max_train_size: '最大訓練樣本數',
};

export const CORE_MODE_OPTION_LABELS: Record<string, string> = {
  future_quality: '未來趨勢品質',
  trade_return: '交易報酬',
  trend_label: '趨勢標籤',
  logistic_regression: '邏輯斯迴歸',
  random_forest: '隨機森林',
  gradient_boosting: '梯度提升',
  balanced_score: '平衡分數',
  return_score: '報酬分數',
  ac_score: 'AC 命中分數',
  drawdown_score: '回撤控制分數',
  low_drawdown_score: '低回撤分數',
  stable_score: '穩定分數',
};

export function localizeCoreModeParamKey(key: string): string {
  return CORE_MODE_PARAM_LABELS[key as keyof CoreModeParams] ?? key;
}

export function localizeCoreModeFeatureName(key: string): string {
  return CORE_MODE_FEATURE_LABELS[key] ?? localizeCoreModeParamKey(key);
}

export function localizeCoreModeMetricName(key: string): string {
  return CORE_MODE_METRIC_LABELS[key] ?? key;
}

export function localizeCoreModeOption(value: string | null | undefined): string {
  if (!value) return '--';
  return CORE_MODE_OPTION_LABELS[value] ?? value;
}

export function formatCoreModeParamRows(params: Partial<CoreModeParams> | null | undefined): Array<{
  key: string;
  label: string;
  value: number;
}> {
  if (!params) return [];
  return Object.entries(params)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]))
    .map(([key, value]) => ({
      key,
      label: localizeCoreModeParamKey(key),
      value,
    }));
}
