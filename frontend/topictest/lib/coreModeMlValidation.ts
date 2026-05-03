import type { CoreModeMlValidation, CoreModeRunResponse, TimeSeriesMLSettings } from './types/coreMode';

export interface MlValidationFormState {
  enabled: boolean;
  enable_model_training: boolean;
  enable_candidate_ranking?: boolean;
  n_splits: number;
  test_size: number;
  gap: number;
  prediction_horizon: number;
  target_mode: 'future_quality' | 'trade_return' | 'trend_label';
  model_type: 'random_forest' | 'gradient_boosting' | 'logistic_regression';
  candidate_ranking_model_type?: 'random_forest' | 'gradient_boosting' | 'logistic_regression';
  candidate_ranking_score_mode?: 'balanced_score' | 'return_score' | 'ac_score' | 'drawdown_score';
  candidate_ranking_top_n?: number;
  future_quality_threshold: number;
  max_train_size?: string;
}

export function buildMlSettingsPayload(state: MlValidationFormState): Partial<TimeSeriesMLSettings> {
  const targetMode = state.target_mode === 'future_quality' ? 'future_quality' : 'future_quality';
  const payload: Partial<TimeSeriesMLSettings> = {
    enabled: state.enabled,
    enable_model_training: state.enable_model_training,
    enable_candidate_ranking: Boolean(state.enable_candidate_ranking),
    n_splits: Math.max(2, Math.floor(state.n_splits || 2)),
    test_size: Math.max(1, Math.floor(state.test_size || 1)),
    gap: Math.max(0, Math.floor(state.gap || 0)),
    prediction_horizon: Math.max(1, Math.floor(state.prediction_horizon || 1)),
    target_mode: targetMode,
    model_type: state.model_type,
    candidate_ranking_model_type: state.candidate_ranking_model_type ?? 'random_forest',
    candidate_ranking_score_mode: state.candidate_ranking_score_mode ?? 'balanced_score',
    candidate_ranking_top_n: Math.min(20, Math.max(1, Math.floor(state.candidate_ranking_top_n || 5))),
    future_quality_threshold: Math.min(1, Math.max(0, Number(state.future_quality_threshold) || 0)),
  };

  const parsedMaxTrainSize = Number(state.max_train_size ?? '');
  if (Number.isFinite(parsedMaxTrainSize) && parsedMaxTrainSize > 0) {
    payload.max_train_size = Math.floor(parsedMaxTrainSize);
  }
  return payload;
}

export const PHASE3_DATASET_NOTICE =
  '目前僅支援 future_quality target；trade_return 與 trend_label 仍在後續階段。';

export interface NormalizedFeatureImportanceItem {
  feature: string;
  importance: number;
  importance_mean: number;
  importance_std: number;
  fold_count: number;
}

export type WarningLevel = 'info' | 'warning' | 'danger';

export interface WarningBadgeItem {
  message: string;
  level: WarningLevel;
}

export function normalizeFeatureImportanceItems(validation?: CoreModeMlValidation | null): NormalizedFeatureImportanceItem[] {
  const items = validation?.ml_model_validation?.feature_importance ?? [];
  return items.map((item) => {
    const mean = Number.isFinite(item.importance_mean) ? Number(item.importance_mean) : Number(item.importance);
    const std = Number.isFinite(item.importance_std) ? Number(item.importance_std) : 0;
    const foldCount = Number.isFinite(item.fold_count) ? Number(item.fold_count) : 1;
    return {
      feature: item.feature,
      importance: Number(item.importance),
      importance_mean: mean,
      importance_std: std,
      fold_count: foldCount,
    };
  });
}

export function collectMlValidationWarnings(validation?: CoreModeMlValidation | null): string[] {
  if (!validation) return [];
  const foldWarnings = validation.warnings ?? [];
  const datasetWarnings = validation.dataset_summary?.warnings ?? [];
  const modelWarnings = validation.ml_model_validation?.warnings ?? [];
  const rankingWarnings = validation.ml_candidate_ranking?.warnings ?? [];
  const candidateWarnings = (validation.ml_candidate_ranking?.ranked_candidates ?? []).flatMap((item) => item.warnings ?? []);
  return Array.from(new Set([...foldWarnings, ...datasetWarnings, ...modelWarnings, ...rankingWarnings, ...candidateWarnings]));
}

export function classifyWarningLevel(message: string): WarningLevel {
  if (message.includes('失敗') || message.includes('錯誤')) return 'danger';
  if (message.includes('樣本不足') || message.includes('單一類別')) return 'warning';
  if (message.includes('尚未啟用') || message.includes('不會自動套用')) return 'info';
  return 'warning';
}

export function toWarningBadgeItems(warnings: string[]): WarningBadgeItem[] {
  return warnings.map((message) => ({
    message,
    level: classifyWarningLevel(message),
  }));
}

export type AutoSearchResultItem = NonNullable<CoreModeRunResponse['auto_search_result']>['results'][number];

const AUTO_SEARCH_SOURCE_TAG_LABELS: Record<string, string> = {
  coarse_grid: '系統粗搜尋',
  local_variation: '鄰近微調',
  random_perturbation: '隨機擾動',
  weighted_profile: '權重策略',
  technical_profile: '技術權重',
  state_trend_variation: '狀態/趨勢微調',
  shape_variation: '型態微調',
  active_base: '目前啟用基準',
};

export function localizeAutoSearchSourceTag(tag: string): string {
  return AUTO_SEARCH_SOURCE_TAG_LABELS[tag] ?? tag;
}

export function localizeAutoSearchSourceTags(tags: string[]): string[] {
  return tags.map((tag) => localizeAutoSearchSourceTag(tag));
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function autoSearchDisplayDedupeKey(item: AutoSearchResultItem): string {
  return [
    item.validation_score ?? item.verified_score ?? 'null',
    item.summary.cumulative_return ?? 'null',
    item.summary.max_drawdown ?? 'null',
    item.summary.stability_score ?? 'null',
    item.summary.trade_count ?? 'null',
  ].join('|');
}

export function dedupeAutoSearchResultsForDisplay(results: AutoSearchResultItem[]): {
  results: AutoSearchResultItem[];
  mergedCount: number;
} {
  const seen = new Set<string>();
  const deduped: AutoSearchResultItem[] = [];

  for (const item of results) {
    const key = autoSearchDisplayDedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return {
    results: deduped,
    mergedCount: Math.max(0, results.length - deduped.length),
  };
}

export interface AutoSearchSummaryAlternative {
  kind: 'highest_return' | 'lowest_drawdown' | 'highest_stability';
  result: AutoSearchResultItem;
}

export interface AutoSearchRecommendationSummary {
  primary: AutoSearchResultItem | null;
  alternatives: AutoSearchSummaryAlternative[];
}

function pickHighestByMetric(
  results: AutoSearchResultItem[],
  selector: (item: AutoSearchResultItem) => number | null
): AutoSearchResultItem | null {
  let best: AutoSearchResultItem | null = null;
  let bestValue = Number.NEGATIVE_INFINITY;

  for (const item of results) {
    const value = selector(item);
    if (!isFiniteNumber(value)) continue;
    if (!best || value > bestValue) {
      best = item;
      bestValue = value;
    }
  }

  return best;
}

function pickLowestByMetric(
  results: AutoSearchResultItem[],
  selector: (item: AutoSearchResultItem) => number | null
): AutoSearchResultItem | null {
  let best: AutoSearchResultItem | null = null;
  let bestValue = Number.POSITIVE_INFINITY;

  for (const item of results) {
    const value = selector(item);
    if (!isFiniteNumber(value)) continue;
    if (!best || value < bestValue) {
      best = item;
      bestValue = value;
    }
  }

  return best;
}

export function buildAutoSearchRecommendationSummary(results: AutoSearchResultItem[]): AutoSearchRecommendationSummary {
  const primary = results[0] ?? null;
  if (!primary) {
    return {
      primary: null,
      alternatives: [],
    };
  }

  const alternatives: AutoSearchSummaryAlternative[] = [];
  const highestReturn = pickHighestByMetric(results, (item) => item.summary.cumulative_return);
  const lowestDrawdown = pickLowestByMetric(results, (item) => item.summary.max_drawdown);
  const highestStability = pickHighestByMetric(results, (item) => item.summary.stability_score);

  if (highestReturn && highestReturn.rank !== primary.rank) {
    alternatives.push({ kind: 'highest_return', result: highestReturn });
  }
  if (lowestDrawdown && lowestDrawdown.rank !== primary.rank) {
    alternatives.push({ kind: 'lowest_drawdown', result: lowestDrawdown });
  }
  if (highestStability && highestStability.rank !== primary.rank) {
    alternatives.push({ kind: 'highest_stability', result: highestStability });
  }

  return {
    primary,
    alternatives,
  };
}

export interface AutoSearchRecommendationTagStats {
  topCumulativeReturn: number | null;
  lowestDrawdown: number | null;
  topStabilityScore: number | null;
}

export function buildAutoSearchRecommendationTagStats(results: AutoSearchResultItem[]): AutoSearchRecommendationTagStats {
  const highestReturn = pickHighestByMetric(results, (item) => item.summary.cumulative_return);
  const lowestDrawdown = pickLowestByMetric(results, (item) => item.summary.max_drawdown);
  const highestStability = pickHighestByMetric(results, (item) => item.summary.stability_score);
  return {
    topCumulativeReturn: highestReturn?.summary.cumulative_return ?? null,
    lowestDrawdown: lowestDrawdown?.summary.max_drawdown ?? null,
    topStabilityScore: highestStability?.summary.stability_score ?? null,
  };
}

export function buildAutoSearchRecommendationTags(
  item: AutoSearchResultItem,
  stats: AutoSearchRecommendationTagStats,
  minTradeCount: number
): string[] {
  const tags: string[] = [];

  if (item.rank === 1) tags.push('綜合最佳');
  if (isFiniteNumber(item.summary.max_drawdown) && item.summary.max_drawdown > 0.15) tags.push('注意回撤');
  if (isFiniteNumber(item.summary.trade_count) && item.summary.trade_count < minTradeCount) tags.push('交易偏少');
  if (isFiniteNumber(item.summary.cumulative_return) && item.summary.cumulative_return === stats.topCumulativeReturn) tags.push('高報酬');
  if (isFiniteNumber(item.summary.max_drawdown) && item.summary.max_drawdown === stats.lowestDrawdown) tags.push('低回撤');
  if (isFiniteNumber(item.summary.stability_score) && item.summary.stability_score === stats.topStabilityScore) tags.push('高穩定');
  if (isFiniteNumber(item.summary.trade_count) && item.summary.trade_count >= minTradeCount) tags.push('交易充足');

  return tags.slice(0, 3);
}
