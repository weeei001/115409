import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import { BarChart3, Loader2, Settings2, TrendingUp } from 'lucide-react';
import type { EChartsOption } from 'echarts';

import { SubpageHeader } from '../components/SubpageHeader';
import { CoreModePriceChart } from '../components/core-mode/CoreModePriceChart';
import { CoreModeEChartPanel } from '../components/core-mode/CoreModeEChartPanel';
import { VirtualTradeTable } from '../components/core-mode/VirtualTradeTable';
import {
  activateCoreModePreset,
  fetchCoreModeDecision,
  fetchCoreModePresets,
  fetchCoreModeSchema,
  runCoreModeBacktest,
  saveCoreModePreset,
} from '../lib/api/coreMode';
import {
  buildAutoSearchRecommendationSummary,
  buildAutoSearchRecommendationTagStats,
  buildAutoSearchRecommendationTags,
  buildMlSettingsPayload,
  collectMlValidationWarnings,
  dedupeAutoSearchResultsForDisplay,
  localizeAutoSearchSourceTags,
  normalizeFeatureImportanceItems,
  PHASE3_DATASET_NOTICE,
  toWarningBadgeItems,
  type WarningLevel,
} from '../lib/coreModeMlValidation';
import {
  formatCoreModeParamRows,
  localizeCoreModeFeatureName,
  localizeCoreModeMetricName,
  localizeCoreModeOption,
} from '../lib/coreModeLabels';
import type {
  CoreModeDecisionResponse,
  CoreModeParams,
  CoreModePreset,
  CoreModeRunResponse,
} from '../lib/types/coreMode';

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function formatPct(unit: number): string {
  return `${(unit * 100).toFixed(2)}%`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : '--';
}

function formatNullableNumber(value: number | null | undefined): string {
  return value == null ? '--' : formatNumber(value);
}

function CoreModeParamTable({ params }: { params: Partial<CoreModeParams> | null | undefined }) {
  const rows = formatCoreModeParamRows(params);
  if (!rows.length) {
    return <span className="text-[var(--color-text-muted)]">無參數資料</span>;
  }

  return (
    <div className="grid min-w-[260px] grid-cols-1 gap-1 text-[11px]">
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid grid-cols-[minmax(120px,1fr)_auto] gap-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1"
        >
          <span>
            <span className="font-semibold text-[var(--color-text-primary)]">{row.label}</span>
            <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">({row.key})</span>
          </span>
          <span className="font-mono tabular-nums">{formatNumber(row.value)}</span>
        </div>
      ))}
    </div>
  );
}

function parseIsoDateValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatOrderedDateRange(start: string | null | undefined, end: string | null | undefined): string {
  if (!start && !end) return '-- ~ --';
  if (!start) return `-- ~ ${end ?? '--'}`;
  if (!end) return `${start} ~ --`;

  const startValue = parseIsoDateValue(start);
  const endValue = parseIsoDateValue(end);
  if (startValue == null || endValue == null) return `${start} ~ ${end}`;
  if (startValue <= endValue) return `${start} ~ ${end}`;
  return `${end} ~ ${start}`;
}

function cloneParams(params: CoreModeParams): CoreModeParams {
  return { ...params };
}

function patchParams(base: CoreModeParams, partial: Partial<CoreModeParams>): CoreModeParams {
  const next: CoreModeParams = { ...base };
  for (const [key, value] of Object.entries(partial) as Array<[keyof CoreModeParams, number | undefined]>) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return next;
}

type TrendTone = 'bull' | 'bear' | 'sideways' | 'unclear';
type CoreModeTabKey = 'auto_search' | 'formal_backtest' | 'ml_details';
type AutoSearchQuality = 'standard' | 'precise' | 'deep';

const AUTO_SEARCH_QUALITY_PRESETS: Record<
  AutoSearchQuality,
  { label: string; candidate_pool_size: number; ml_prefilter_top_n: number; final_verify_top_n: number }
> = {
  standard: { label: '標準', candidate_pool_size: 150, ml_prefilter_top_n: 40, final_verify_top_n: 15 },
  precise: { label: '精準', candidate_pool_size: 300, ml_prefilter_top_n: 80, final_verify_top_n: 30 },
  deep: { label: '深度', candidate_pool_size: 800, ml_prefilter_top_n: 200, final_verify_top_n: 60 },
};

function clampAutoSearchValue(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

interface LoadedAutoSearchParamsMeta {
  rank: number;
  validation_score: number | null;
  verified_score: number | null;
  cross_stock_score: number | null;
  final_holdout_score: number | null;
  final_holdout_cross_stock_score: number | null;
  source_tags: string[];
  loaded_at: string;
}

interface ViewedAutoSearchParamsState {
  rank: number;
  params: Partial<CoreModeParams>;
}

function resolveTrendTone(conclusion?: string | null): TrendTone {
  if (!conclusion) return 'unclear';
  if (conclusion.includes('偏多')) return 'bull';
  if (conclusion.includes('偏空')) return 'bear';
  if (conclusion.includes('偏震盪')) return 'sideways';
  return 'unclear';
}

function toneClassByTrend(tone: TrendTone): string {
  if (tone === 'bull') return 'border-up/30 bg-up-muted';
  if (tone === 'bear') return 'border-down/30 bg-down-muted';
  if (tone === 'sideways') return 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-900/15';
  return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
}

function confidenceClass(confidence: string | null | undefined): string {
  if (!confidence) return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
  if (confidence.includes('高')) return 'border-up/35 bg-up-muted';
  if (confidence.includes('中')) return 'border-amber-300/60 bg-amber-50/70 dark:bg-amber-900/15';
  if (confidence.includes('低')) return 'border-down/35 bg-down-muted';
  return 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]';
}

function buildConclusionSentence(conclusion: string, confidence: string): string {
  if (conclusion === '偏多') return `目前結構偏多，整體屬於${confidence}信心；建議優先觀察量能是否持續擴張。`;
  if (conclusion === '偏空') return `目前結構偏空，整體屬於${confidence}信心；建議先等待趨勢分數修復再評估。`;
  if (conclusion === '偏震盪') return `目前在區間震盪，整體屬於${confidence}信心；建議等待突破或拉回品質改善。`;
  return `目前趨勢不明，整體屬於${confidence}信心；建議先觀察關鍵條件是否轉為一致。`;
}

function recommendationBadge(action: string | undefined): { label: string; className: string } {
  if (!action) return { label: '持平', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
  if (action.includes('買')) return { label: '買入', className: 'bg-rose-50 text-rose-700 border border-rose-200' };
  if (action.includes('減碼') || action.includes('風險') || action.includes('賣')) {
    return { label: '賣出', className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' };
  }
  return { label: '持平', className: 'bg-amber-50 text-amber-700 border border-amber-200' };
}

function normalizeCoreReason(text: string): string {
  if (text.includes('型態分數') && text.includes('未通過')) return '目前突破力道不足，趨勢還沒有明確延續。';
  if (text.includes('綜合趨勢分數') && text.includes('未通過')) return '訊號信心偏低，價格可能仍在盤整區間。';
  if (text.includes('有效趨勢訊號不足')) return '尚未出現明確買盤確認，建議先觀察。';
  if (text.includes('突破結構')) return '尚未形成明確突破，建議等待訊號更完整。';
  return text;
}

function warningToneClass(level: WarningLevel): string {
  if (level === 'danger') return 'border-up/30 bg-up-muted text-up';
  if (level === 'info') return 'border-sky-300/60 bg-sky-50/70 text-sky-900';
  return 'border-amber-300/60 bg-amber-50/70 text-amber-900';
}

function recommendationTagClass(tag: string): string {
  if (tag === '綜合最佳') return 'border-sky-300/60 bg-sky-50 text-sky-900';
  if (tag === '注意回撤' || tag === '交易偏少') return 'border-amber-300/60 bg-amber-50 text-amber-900';
  return 'border-emerald-300/60 bg-emerald-50 text-emerald-900';
}

export default function CoreModePage() {
  const [params, setParams] = useState<CoreModeParams | null>(null);
  const [presets, setPresets] = useState<CoreModePreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string>('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');

  const [symbol, setSymbol] = useState('2330');
  const [startDate, setStartDate] = useState(isoDaysAgo(800));
  const [endDate, setEndDate] = useState(isoDaysAgo(0));

  const [runLoading, setRunLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<CoreModeRunResponse | null>(null);
  const [mlValidationEnabled, setMlValidationEnabled] = useState(true);
  const [mlEnableModelTraining, setMlEnableModelTraining] = useState(true);
  const [mlEnableCandidateRanking, setMlEnableCandidateRanking] = useState(true);
  const [mlSplits, setMlSplits] = useState(5);
  const [mlTestSize, setMlTestSize] = useState(60);
  const [mlGap, setMlGap] = useState(20);
  const [mlPredictionHorizon, setMlPredictionHorizon] = useState(20);
  const [mlTargetMode, setMlTargetMode] = useState<'future_quality' | 'trade_return' | 'trend_label'>('future_quality');
  const [mlModelType, setMlModelType] = useState<'random_forest' | 'gradient_boosting' | 'logistic_regression'>(
    'random_forest'
  );
  const [mlCandidateRankingModelType, setMlCandidateRankingModelType] = useState<
    'random_forest' | 'gradient_boosting' | 'logistic_regression'
  >('random_forest');
  const [mlCandidateRankingScoreMode, setMlCandidateRankingScoreMode] = useState<
    'balanced_score' | 'return_score' | 'ac_score' | 'drawdown_score'
  >('balanced_score');
  const [mlCandidateRankingTopN, setMlCandidateRankingTopN] = useState(5);
  const [mlFutureQualityThreshold, setMlFutureQualityThreshold] = useState(0.55);
  const [mlMaxTrainSize, setMlMaxTrainSize] = useState<string>('');
  const [autoSearchMode, setAutoSearchMode] = useState<'single_stock_search' | 'multi_stock_search'>('single_stock_search');
  const [autoSearchSymbols, setAutoSearchSymbols] = useState('2330');
  const [autoSearchTopN, setAutoSearchTopN] = useState(10);
  const [autoSearchQuality, setAutoSearchQuality] = useState<AutoSearchQuality>('precise');
  const [autoSearchCandidatePoolSize, setAutoSearchCandidatePoolSize] = useState(300);
  const [autoSearchMlPrefilterTopN, setAutoSearchMlPrefilterTopN] = useState(80);
  const [autoSearchFinalVerifyTopN, setAutoSearchFinalVerifyTopN] = useState(30);
  const [autoSearchQualityClampMessage, setAutoSearchQualityClampMessage] = useState('');
  const [autoSearchScoreMode, setAutoSearchScoreMode] = useState<
    'balanced_score' | 'return_score' | 'low_drawdown_score' | 'stable_score'
  >('balanced_score');
  const [autoSearchUseMlPrefilter, setAutoSearchUseMlPrefilter] = useState(true);
  const [autoSearchUseTimeSeriesValidation, setAutoSearchUseTimeSeriesValidation] = useState(true);
  const [autoSearchUseHoldoutValidation, setAutoSearchUseHoldoutValidation] = useState(true);
  const [autoSearchRequireMinTradeCount, setAutoSearchRequireMinTradeCount] = useState(true);
  const [autoSearchMinTradeCount, setAutoSearchMinTradeCount] = useState(10);
  const [autoSearchRuntimeLevel, setAutoSearchRuntimeLevel] = useState<'balanced' | 'deep'>('balanced');
  const [autoSearchAdaptiveEnabled, setAutoSearchAdaptiveEnabled] = useState(true);
  const [autoSearchAdaptiveMaxIterations, setAutoSearchAdaptiveMaxIterations] = useState(5);
  const [autoSearchAdaptiveCandidatesPerIteration, setAutoSearchAdaptiveCandidatesPerIteration] = useState(300);
  const [autoSearchAdaptiveVerifyTopNPerIteration, setAutoSearchAdaptiveVerifyTopNPerIteration] = useState(50);
  const [autoSearchAdaptiveKeepEliteN, setAutoSearchAdaptiveKeepEliteN] = useState(10);
  const [autoSearchAdaptivePatience, setAutoSearchAdaptivePatience] = useState(2);
  const [autoSearchAdaptiveMinImprovement, setAutoSearchAdaptiveMinImprovement] = useState(0.01);
  const [autoSearchAdaptiveRefinementStrength, setAutoSearchAdaptiveRefinementStrength] = useState<'small' | 'medium' | 'large'>('medium');
  const [autoSearchFinalHoldoutEnabled, setAutoSearchFinalHoldoutEnabled] = useState(true);
  const [autoSearchFinalHoldoutMode, setAutoSearchFinalHoldoutMode] = useState<'ratio' | 'days'>('ratio');
  const [autoSearchTrainRatio, setAutoSearchTrainRatio] = useState(0.6);
  const [autoSearchValidationRatio, setAutoSearchValidationRatio] = useState(0.2);
  const [autoSearchFinalHoldoutRatio, setAutoSearchFinalHoldoutRatio] = useState(0.2);
  const [autoSearchFinalHoldoutDays, setAutoSearchFinalHoldoutDays] = useState<string>('');
  const [autoSearchMinFinalHoldoutDays, setAutoSearchMinFinalHoldoutDays] = useState(20);
  const [activeTab, setActiveTab] = useState<CoreModeTabKey>('auto_search');
  const [selectedAutoSearchResult, setSelectedAutoSearchResult] = useState<LoadedAutoSearchParamsMeta | null>(null);
  const [viewedAutoSearchParams, setViewedAutoSearchParams] = useState<ViewedAutoSearchParamsState | null>(null);
  const [loadedAutoSearchParamsPendingValidation, setLoadedAutoSearchParamsPendingValidation] = useState(false);
  const [isBacktestResultStale, setIsBacktestResultStale] = useState(false);
  const [loadedAutoSearchParamsMeta, setLoadedAutoSearchParamsMeta] = useState<LoadedAutoSearchParamsMeta | null>(null);
  const [showMlSettingsPanel, setShowMlSettingsPanel] = useState(false);
  const [showMlResultDetail, setShowMlResultDetail] = useState(false);

  const [savingPreset, setSavingPreset] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDescription, setPresetDescription] = useState('');
  const [presetMessage, setPresetMessage] = useState<string>('');
  const [currentParamsSource, setCurrentParamsSource] = useState<{ type: 'manual' | 'preset' | 'auto_search'; label: string }>({
    type: 'manual',
    label: '手動設定',
  });

  const [analysisSymbol, setAnalysisSymbol] = useState('2330');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<CoreModeDecisionResponse | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([fetchCoreModeSchema(), fetchCoreModePresets()])
      .then(([schemaRes, presetRes]) => {
        if (!mounted) return;
        setParams(cloneParams(schemaRes.default_params));
        setPresets(presetRes.presets);
        setActivePresetId(presetRes.active_preset_id);
        setSelectedPresetId(presetRes.active_preset_id);
      })
      .catch((error) => {
        if (!mounted) return;
        setRunError(error instanceof Error ? error.message : '載入核心模式設定失敗');
      });

    return () => {
      mounted = false;
    };
  }, []);

  const selectedPreset = useMemo(
    () => presets.find((item) => item.id === selectedPresetId) ?? null,
    [presets, selectedPresetId]
  );

  const activePreset = useMemo(() => presets.find((item) => item.id === activePresetId) ?? null, [presets, activePresetId]);

  const clearLoadedAutoSearchValidationState = () => {
    setLoadedAutoSearchParamsPendingValidation(false);
    setLoadedAutoSearchParamsMeta(null);
    setSelectedAutoSearchResult(null);
  };

  const applyAutoSearchQualityPreset = (quality: AutoSearchQuality) => {
    const preset = AUTO_SEARCH_QUALITY_PRESETS[quality];
    const nextCandidatePoolSize = clampAutoSearchValue(preset.candidate_pool_size, 50, 1000);
    const nextMlPrefilterTopN = clampAutoSearchValue(preset.ml_prefilter_top_n, 1, 1000);
    const nextFinalVerifyTopN = clampAutoSearchValue(preset.final_verify_top_n, 1, 1000);

    setAutoSearchQuality(quality);
    setAutoSearchCandidatePoolSize(nextCandidatePoolSize);
    setAutoSearchMlPrefilterTopN(nextMlPrefilterTopN);
    setAutoSearchFinalVerifyTopN(nextFinalVerifyTopN);

    if (
      nextCandidatePoolSize !== preset.candidate_pool_size ||
      nextMlPrefilterTopN !== preset.ml_prefilter_top_n ||
      nextFinalVerifyTopN !== preset.final_verify_top_n
    ) {
      setAutoSearchQualityClampMessage('搜尋品質預設值超出目前可用範圍，已自動套用可用上限/下限。');
      return;
    }

    setAutoSearchQualityClampMessage('');
  };

  const handleLoadPreset = () => {
    if (!selectedPreset) return;
    setParams(cloneParams(selectedPreset.params));
    clearLoadedAutoSearchValidationState();
    setIsBacktestResultStale(true);
    setCurrentParamsSource({ type: 'preset', label: `preset：${selectedPreset.name}` });
    setPresetMessage(`已載入參數組合：${selectedPreset.name}（僅載入到表單，未變更啟用 preset）`);
  };

  const handleLoadAutoSearchParams = (
    partial: Partial<CoreModeParams>,
    meta: Pick<
      LoadedAutoSearchParamsMeta,
      | 'rank'
      | 'validation_score'
      | 'verified_score'
      | 'cross_stock_score'
      | 'final_holdout_score'
      | 'final_holdout_cross_stock_score'
      | 'source_tags'
    >
  ) => {
    if (!params) return;
    const next = patchParams(params, partial);
    setParams(next);
    const loadedMeta: LoadedAutoSearchParamsMeta = {
      ...meta,
      loaded_at: new Date().toISOString(),
    };
    setSelectedAutoSearchResult(loadedMeta);
    setLoadedAutoSearchParamsMeta(loadedMeta);
    setLoadedAutoSearchParamsPendingValidation(true);
    setIsBacktestResultStale(true);
    setCurrentParamsSource({ type: 'auto_search', label: `auto search rank ${meta.rank}` });
    setPresetMessage('已載入自動搜尋參數，請重新執行回測確認後再手動儲存或啟用。');
    setActiveTab('formal_backtest');
  };

  const handleActivatePreset = async () => {
    if (!selectedPresetId) return;
    if (loadedAutoSearchParamsPendingValidation || isBacktestResultStale) {
      const shouldContinue = window.confirm('目前參數尚未重新回測確認，不建議直接儲存或啟用。仍要繼續嗎？');
      if (!shouldContinue) return;
    }
    try {
      const data = await activateCoreModePreset(selectedPresetId);
      setPresets(data.presets);
      setActivePresetId(data.active_preset_id);
      setSelectedPresetId(data.active_preset_id);
      setPresetMessage('已設定啟用參數組合');
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : '設定啟用參數組合失敗');
    }
  };

  const handleSavePreset = async () => {
    if (!params) return;
    const name = presetName.trim();
    if (!name) {
      setPresetMessage('請先輸入參數組合名稱');
      return;
    }
    if (loadedAutoSearchParamsPendingValidation || isBacktestResultStale) {
      const shouldContinue = window.confirm('目前參數尚未重新回測確認，不建議直接儲存或啟用。仍要繼續嗎？');
      if (!shouldContinue) return;
    }

    setSavingPreset(true);
    setPresetMessage('');
    try {
      const data = await saveCoreModePreset({
        name,
        description: presetDescription.trim(),
        params,
      });
      setPresets(data.presets);
      setActivePresetId(data.active_preset_id);
      setSelectedPresetId(data.active_preset_id);
      setPresetName('');
      setPresetDescription('');
      setPresetMessage('參數組合已儲存');
    } catch (error) {
      setPresetMessage(error instanceof Error ? error.message : '儲存參數組合失敗');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleRunBacktest = async (mode: 'auto_search' | 'formal_backtest') => {
    if (!params) return;
    setRunLoading(true);
    setRunError(null);

    try {
      const normalizedAutoSearchSymbols = autoSearchSymbols
        .split(',')
        .map((item) => item.trim().toUpperCase())
        .filter(Boolean);
      const requestSymbol = mode === 'auto_search' ? normalizedAutoSearchSymbols[0] ?? symbol.trim().toUpperCase() : symbol.trim().toUpperCase();

      const mlSettings = buildMlSettingsPayload({
        enabled: mlValidationEnabled,
        enable_model_training: mlEnableModelTraining,
        enable_candidate_ranking: mlEnableCandidateRanking,
        n_splits: mlSplits,
        test_size: mlTestSize,
        gap: mlGap,
        prediction_horizon: mlPredictionHorizon,
        target_mode: mlTargetMode,
        model_type: mlModelType,
        candidate_ranking_model_type: mlCandidateRankingModelType,
        candidate_ranking_score_mode: mlCandidateRankingScoreMode,
        candidate_ranking_top_n: mlCandidateRankingTopN,
        future_quality_threshold: mlFutureQualityThreshold,
        max_train_size: mlMaxTrainSize,
      });

      const data = await runCoreModeBacktest({
        symbol: requestSymbol,
        date_range: {
          start_date: startDate,
          end_date: endDate,
        },
        params,
        validation_mode: 'rolling_walk_forward',
        run_optimization: true,
        ml_settings: mlSettings,
        auto_search_settings: {
          enabled: mode === 'auto_search',
          mode: autoSearchMode,
          symbols: normalizedAutoSearchSymbols,
          top_n: autoSearchTopN,
          candidate_pool_size: autoSearchCandidatePoolSize,
          ml_prefilter_top_n: autoSearchMlPrefilterTopN,
          final_verify_top_n: autoSearchFinalVerifyTopN,
          score_mode: autoSearchScoreMode,
          use_ml_prefilter: autoSearchUseMlPrefilter,
          use_time_series_validation: autoSearchUseTimeSeriesValidation,
          use_holdout_validation: autoSearchUseHoldoutValidation,
          require_min_trade_count: autoSearchRequireMinTradeCount,
          min_trade_count: autoSearchMinTradeCount,
          max_runtime_level: autoSearchRuntimeLevel,
          adaptive_search_settings: {
            enabled: autoSearchAdaptiveEnabled,
            max_iterations: autoSearchAdaptiveMaxIterations,
            candidates_per_iteration: autoSearchAdaptiveCandidatesPerIteration,
            verify_top_n_per_iteration: autoSearchAdaptiveVerifyTopNPerIteration,
            keep_elite_n: autoSearchAdaptiveKeepEliteN,
            patience: autoSearchAdaptivePatience,
            min_improvement: autoSearchAdaptiveMinImprovement,
            use_ml_prefilter: autoSearchUseMlPrefilter,
            refinement_strength: autoSearchAdaptiveRefinementStrength,
          },
          final_holdout_settings: {
            enabled: autoSearchFinalHoldoutEnabled,
            mode: autoSearchFinalHoldoutMode,
            train_ratio: autoSearchTrainRatio,
            validation_ratio: autoSearchValidationRatio,
            final_holdout_ratio: autoSearchFinalHoldoutRatio,
            final_holdout_days:
              autoSearchFinalHoldoutMode === 'days'
                ? (() => {
                    const parsed = Number(autoSearchFinalHoldoutDays);
                    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
                  })()
                : null,
            min_final_holdout_days: Math.max(1, Math.floor(autoSearchMinFinalHoldoutDays || 1)),
          },
        },
      });
      setRunResult(data);
      setParams(cloneParams(data.summary.used_params));
      setCurrentParamsSource((prev) => (prev.type === 'auto_search' ? prev : { type: 'manual', label: '手動設定' }));
      if (mode === 'formal_backtest' && (loadedAutoSearchParamsPendingValidation || isBacktestResultStale)) {
        setLoadedAutoSearchParamsPendingValidation(false);
        setIsBacktestResultStale(false);
        setPresetMessage('此組參數已完成重新回測確認。');
      }

      const presetData = await fetchCoreModePresets();
      setPresets(presetData.presets);
      setActivePresetId(presetData.active_preset_id);
      setSelectedPresetId(presetData.active_preset_id);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : '回測執行失敗');
      setRunResult(null);
    } finally {
      setRunLoading(false);
    }
  };

  const handleApplyActivePreset = async () => {
    setAnalysisLoading(true);
    setAnalysisError(null);
    try {
      const data = await fetchCoreModeDecision({ symbol: analysisSymbol.trim().toUpperCase() });
      setAnalysisResult(data);
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : '核心趨勢分析失敗');
      setAnalysisResult(null);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const candidateScatterOption = useMemo<EChartsOption>(() => {
    if (!runResult) return {};
    const list = runResult.comparison_candidates;
    return {
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const data = params.data as [number, number, number, string];
          return `${data[3]}<br/>準確度：${(data[0] * 100).toFixed(2)}%<br/>最大回撤：${(data[1] * 100).toFixed(2)}%<br/>平衡目標：${data[2].toFixed(3)}`;
        },
      },
      grid: { left: 56, right: 20, top: 20, bottom: 40 },
      xAxis: {
        type: 'value',
        name: '準確度',
        axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` },
      },
      yAxis: {
        type: 'value',
        name: '最大回撤',
        axisLabel: { formatter: (value: number) => `${(value * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'scatter',
          symbolSize: 12,
          data: list.map((item, index) => [
            item.summary.ac,
            item.summary.max_drawdown,
            item.balanced_objective,
            `候選 ${index + 1}`,
          ]),
          itemStyle: { color: '#ea580c' },
        },
      ],
    };
  }, [runResult]);
  const trendTone = useMemo(() => resolveTrendTone(runResult?.summary.trend_conclusion), [runResult]);
  const highlightedReasons = useMemo(
    () => runResult?.summary.reasoning.reason_points.slice(0, 3) ?? [],
    [runResult]
  );
  const mlWarnings = useMemo(
    () => collectMlValidationWarnings(runResult?.ml_validation ?? null),
    [runResult]
  );
  const normalizedFeatureImportance = useMemo(
    () => normalizeFeatureImportanceItems(runResult?.ml_validation ?? null),
    [runResult]
  );
  const runWarningBadges = useMemo(
    () => toWarningBadgeItems(runResult?.warnings ?? []),
    [runResult]
  );
  const mlWarningBadges = useMemo(
    () => toWarningBadgeItems(mlWarnings),
    [mlWarnings]
  );
  const autoSearchRawResults = runResult?.auto_search_result?.results ?? [];
  const autoSearchDisplayData = useMemo(
    () => dedupeAutoSearchResultsForDisplay(autoSearchRawResults),
    [autoSearchRawResults]
  );
  const autoSearchResults = autoSearchDisplayData.results;
  const autoSearchMergedCount = autoSearchDisplayData.mergedCount;
  const autoSearchRecommendationSummary = useMemo(
    () => buildAutoSearchRecommendationSummary(autoSearchResults),
    [autoSearchResults]
  );
  const autoSearchRecommendationTagStats = useMemo(
    () => buildAutoSearchRecommendationTagStats(autoSearchResults),
    [autoSearchResults]
  );
  const isMultiStockMode = autoSearchMode === 'multi_stock_search';
  const autoSearchQualitySummaryText =
    autoSearchQuality === 'standard'
      ? '標準：較快，適合初步搜尋'
      : autoSearchQuality === 'precise'
      ? '精準：較平衡，建議預設'
      : '深度：較慢，但搜尋更完整';
  const finalHoldoutSummaryText = `Train ${(autoSearchTrainRatio * 100).toFixed(0)}% / Validation ${(autoSearchValidationRatio * 100).toFixed(
    0
  )}% / Final Holdout ${(autoSearchFinalHoldoutRatio * 100).toFixed(0)}%`;
  const adaptiveSearchSummaryText = `自適應搜尋：${autoSearchAdaptiveMaxIterations} 輪，每輪 ${autoSearchAdaptiveCandidatesPerIteration} 組候選，驗證前 ${autoSearchAdaptiveVerifyTopNPerIteration} 組。`;
  const hasPendingAutoSearchValidation = loadedAutoSearchParamsPendingValidation;
  const shouldHideBacktestResult = loadedAutoSearchParamsPendingValidation || isBacktestResultStale;
  const currentBacktestSourceLabel =
    currentParamsSource.type === 'auto_search' && loadedAutoSearchParamsMeta
      ? `Auto Search Rank ${loadedAutoSearchParamsMeta.rank}`
      : currentParamsSource.type === 'preset'
      ? currentParamsSource.label.replace(/^preset：/, 'Preset：')
      : '手動設定';

  return (
    <div className="min-h-screen text-[var(--color-text-primary)]">
      <Head>
        <title>核心模式參數實驗室｜股海明燈</title>
        <meta
          name="description"
          content="台股趨勢分析核心模式：自動搜尋最佳參數、正式回測確認、技術驗證細節與啟用參數組合套用。"
        />
      </Head>

      <SubpageHeader
        icon={Settings2}
        title="回測核心模式參數實驗室"
        subtitle="自動搜尋參數＋正式回測確認＋技術驗證細節"
      />

      <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="bento-cell p-2">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
            {[
              { key: 'auto_search' as const, label: '自動找最佳參數' },
              { key: 'formal_backtest' as const, label: '正式回測確認' },
              { key: 'ml_details' as const, label: '技術驗證細節' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                className={`rounded-lg px-3 py-2 text-sm font-semibold ${
                  activeTab === tab.key
                    ? 'bg-[var(--color-brand)] text-white'
                    : 'border border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </section>

        {runError ? <p className="rounded-lg border border-up/25 bg-up-muted px-3 py-2 text-sm text-up">{runError}</p> : null}
        {presetMessage ? <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{presetMessage}</p> : null}

        {activeTab === 'auto_search' ? (
          <>
            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">自動找最佳參數</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                系統會自動搜尋參數組，不會自動套用，也不會覆蓋 active preset。
              </p>

              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">模式</span>
                  <select
                    value={autoSearchMode}
                    onChange={(e) => setAutoSearchMode(e.target.value as 'single_stock_search' | 'multi_stock_search')}
                    className="ui-input"
                  >
                    <option value="single_stock_search">單股最佳參數</option>
                    <option value="multi_stock_search">多股泛用參數</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">股票代號</span>
                  <input
                    value={autoSearchSymbols}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAutoSearchSymbols(value);
                      const firstSymbol = value
                        .split(',')
                        .map((item) => item.trim().toUpperCase())
                        .filter(Boolean)[0];
                      if (firstSymbol) {
                        setSymbol(firstSymbol);
                      }
                    }}
                    className="ui-input"
                    placeholder={isMultiStockMode ? '例如 2330,2317,2454' : '例如 2330'}
                  />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">回測期間（開始）</span>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="ui-input" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">回測期間（結束）</span>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="ui-input" />
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">搜尋目標</span>
                  <select
                    value={autoSearchScoreMode}
                    onChange={(e) => setAutoSearchScoreMode(e.target.value as 'balanced_score' | 'return_score' | 'low_drawdown_score' | 'stable_score')}
                    className="ui-input"
                  >
                    <option value="balanced_score">平衡型</option>
                    <option value="return_score">高報酬</option>
                    <option value="low_drawdown_score">低回撤</option>
                    <option value="stable_score">高穩定</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">搜尋品質</span>
                  <select value={autoSearchQuality} onChange={(e) => applyAutoSearchQualityPreset(e.target.value as AutoSearchQuality)} className="ui-input">
                    <option value="standard">標準</option>
                    <option value="precise">精準</option>
                    <option value="deep">深度</option>
                  </select>
                </label>
                <label className="text-sm">
                  <span className="mb-1 block text-xs text-[var(--color-text-muted)]">輸出 Top N</span>
                  <input type="number" min={1} max={20} value={autoSearchTopN} onChange={(e) => setAutoSearchTopN(Number(e.target.value))} className="ui-input" />
                </label>
              </div>
              {autoSearchQualityClampMessage ? <p className="mt-2 text-xs text-amber-700">{autoSearchQualityClampMessage}</p> : null}

              <p className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
                一般使用者不需要手動調整參數；系統會依據勾選的驗證方式與搜尋品質自動設定細節。
              </p>
              <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
                搜尋品質說明：{autoSearchQualitySummaryText}
              </p>
              <p className="mt-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
                Final Holdout 分割（預設 60/20/20）：{finalHoldoutSummaryText}
              </p>

              <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchUseMlPrefilter}
                      onChange={(e) => setAutoSearchUseMlPrefilter(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    使用 ML 預篩
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    先用 ML 從候選參數中篩出較有潛力的組合，最後排名仍以正式驗證分數為準。
                  </span>
                </label>
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchUseTimeSeriesValidation}
                      onChange={(e) => setAutoSearchUseTimeSeriesValidation(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    使用 TimeSeriesSplit 穩定性驗證
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    用多個時間切片檢查參數穩定度，避免只在單一區間有效。
                  </span>
                </label>
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchUseHoldoutValidation}
                      onChange={(e) => setAutoSearchUseHoldoutValidation(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    使用 Holdout 驗證
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    額外保留部分區間檢查參數表現，降低過度擬合風險。
                  </span>
                </label>
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchRequireMinTradeCount}
                      onChange={(e) => setAutoSearchRequireMinTradeCount(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    強制最低交易次數
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    避免只交易少數幾次卻看起來分數很高。
                  </span>
                </label>
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchAdaptiveEnabled}
                      onChange={(e) => setAutoSearchAdaptiveEnabled(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    啟用自適應搜尋
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    會多輪逼近較佳參數區域，通常更精準但需要更久。
                  </span>
                </label>
                <label className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-3 text-sm">
                  <span className="inline-flex items-center gap-2 font-semibold">
                    <input
                      type="checkbox"
                      checked={autoSearchFinalHoldoutEnabled}
                      onChange={(e) => setAutoSearchFinalHoldoutEnabled(e.target.checked)}
                      className="accent-[var(--color-brand)]"
                    />
                    啟用 Final Holdout 未知區驗證
                  </span>
                  <span className="mt-2 block text-xs text-[var(--color-text-muted)]">
                    最後一段資料不參與選參數，只在 Top N 確定後做上帝視角驗證。
                  </span>
                </label>
              </div>

              <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
                <p className="font-semibold">進階搜尋摘要（唯讀）</p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  ML 預篩只用來縮小候選範圍，最終仍以正式驗證分數排名。
                </p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  Final Holdout 是最後未知區驗證，不參與正式驗證分數排名。
                </p>
                <p className="mt-1 text-[var(--color-text-muted)]">
                  自適應搜尋會多輪逼近最佳參數，可能需要較長時間。
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--color-text-muted)]">
                  <li>搜尋品質：{AUTO_SEARCH_QUALITY_PRESETS[autoSearchQuality].label}</li>
                  <li>ML 預篩：{autoSearchUseMlPrefilter ? '啟用' : '停用'}</li>
                  <li>TimeSeriesSplit 穩定性驗證：{autoSearchUseTimeSeriesValidation ? '啟用' : '停用'}</li>
                  <li>Holdout 驗證：{autoSearchUseHoldoutValidation ? '啟用' : '停用'}</li>
                  <li>最低交易次數：{autoSearchRequireMinTradeCount ? `啟用（${autoSearchMinTradeCount}）` : '停用'}</li>
                  <li>自適應搜尋：{autoSearchAdaptiveEnabled ? `啟用（${adaptiveSearchSummaryText}）` : '停用'}</li>
                  <li>Final Holdout：{autoSearchFinalHoldoutEnabled ? `啟用（${finalHoldoutSummaryText}）` : '停用'}</li>
                </ul>
              </div>

              {isMultiStockMode ? (
                <p className="mt-3 rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                  多股泛用搜尋會以多股泛用分數作為最終排序依據，避免只靠單一股票暴賺撐高分數。
                </p>
              ) : null}
              {isMultiStockMode ? (
                <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                  目前 ML 預篩可能以主要股票作為排序參考，多股泛用結果仍以多股泛用分數作為最終排序依據。
                </p>
              ) : null}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => handleRunBacktest('auto_search')}
                  disabled={runLoading || !params}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {runLoading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                  開始自動搜尋最佳參數
                </button>
              </div>
            </section>

            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">Top N 搜尋結果</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                正式驗證分數用於選參排序；未知區驗證分數僅用於觀察，不直接改變排序。
              </p>
              {runResult?.auto_search_result?.ranking_basis ? (
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                  {localizeCoreModeMetricName('ranking_basis')}：{runResult.auto_search_result.ranking_basis}
                </p>
              ) : null}
              {autoSearchResults.length ? (
                <>
                  {runResult?.auto_search_result?.split_summary ? (
                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
                      <p>
                        train：{runResult.auto_search_result.split_summary.train_start ?? '--'} ~ {runResult.auto_search_result.split_summary.train_end ?? '--'}（
                        {runResult.auto_search_result.split_summary.train_count}）
                      </p>
                      <p>
                        validation：{runResult.auto_search_result.split_summary.validation_start ?? '--'} ~{' '}
                        {runResult.auto_search_result.split_summary.validation_end ?? '--'}（
                        {runResult.auto_search_result.split_summary.validation_count}）
                      </p>
                      <p>
                        final holdout：{runResult.auto_search_result.split_summary.final_holdout_start ?? '--'} ~{' '}
                        {runResult.auto_search_result.split_summary.final_holdout_end ?? '--'}（
                        {runResult.auto_search_result.split_summary.final_holdout_count}）
                      </p>
                      {(runResult.auto_search_result.split_summary.warnings ?? []).length ? (
                        <p className="mt-1 text-amber-700">
                          {(runResult.auto_search_result.split_summary.warnings ?? []).join(' | ')}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                  {runResult?.auto_search_result?.adaptive_trace?.enabled ? (
                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
                      <p className="font-semibold">adaptive_trace summary</p>
                      <p className="mt-1 text-[var(--color-text-muted)]">
                        停止原因：{runResult.auto_search_result.adaptive_trace.stop_reason ?? '--'}
                      </p>
                      <p className="mt-1 break-all text-[var(--color-text-muted)]">
                        最佳分數進展：
                        {(runResult.auto_search_result.adaptive_trace.best_score_progression ?? [])
                          .map((item) => formatNumber(item))
                          .join(' -> ') || '--'}
                      </p>
                      <div className="mt-2 overflow-x-auto">
                        <table className="min-w-full text-left text-[11px]">
                          <thead>
                            <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                              <th className="px-2 py-1">輪次</th>
                              <th className="px-2 py-1">最佳分數</th>
                              <th className="px-2 py-1">改善幅度</th>
                              <th className="px-2 py-1">驗證組數</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(runResult.auto_search_result.adaptive_trace.iterations ?? []).map((item) => (
                              <tr key={`adaptive-iteration-${item.iteration}`} className="border-b border-[var(--color-border)]/50">
                                <td className="px-2 py-1">{item.iteration}</td>
                                <td className="px-2 py-1">{formatNumber(item.best_score)}</td>
                                <td className="px-2 py-1">{item.improvement == null ? '--' : formatNumber(item.improvement)}</td>
                                <td className="px-2 py-1">{item.verified_count}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
                  <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                    <p className="text-sm font-semibold">搜尋結果推薦摘要</p>
                    {autoSearchRecommendationSummary.primary ? (
                      <div className="mt-2 rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2 text-xs">
                        <p className="font-semibold">首選 Rank {autoSearchRecommendationSummary.primary.rank}：綜合驗證分數最高。</p>
                        <p className="mt-1 text-[var(--color-text-muted)]">
                          正式驗證分數{' '}
                          {autoSearchRecommendationSummary.primary.validation_score == null
                            ? '--'
                            : formatNumber(autoSearchRecommendationSummary.primary.validation_score)}{' '}
                          ｜ 累積報酬{' '}
                          {autoSearchRecommendationSummary.primary.summary.cumulative_return == null
                            ? '--'
                            : formatPct(autoSearchRecommendationSummary.primary.summary.cumulative_return)}{' '}
                          ｜ 最大回撤{' '}
                          {autoSearchRecommendationSummary.primary.summary.max_drawdown == null
                            ? '--'
                            : formatPct(autoSearchRecommendationSummary.primary.summary.max_drawdown)}{' '}
                          ｜ 穩定度{' '}
                          {autoSearchRecommendationSummary.primary.summary.stability_score == null
                            ? '--'
                            : formatNumber(autoSearchRecommendationSummary.primary.summary.stability_score)}{' '}
                          ｜ 交易次數 {autoSearchRecommendationSummary.primary.summary.trade_count ?? '--'}
                        </p>
                      </div>
                    ) : null}

                    {autoSearchRecommendationSummary.alternatives.length ? (
                      <div className="mt-2 space-y-1 text-xs">
                        {autoSearchRecommendationSummary.alternatives.map((alternative, index) => (
                          <p key={`auto-search-alt-${alternative.kind}-${alternative.result.rank}-${index}`}>
                            {alternative.kind === 'highest_return'
                              ? `Rank ${alternative.result.rank}：報酬最高，累積報酬 ${
                                  alternative.result.summary.cumulative_return == null
                                    ? '--'
                                    : formatPct(alternative.result.summary.cumulative_return)
                                }`
                              : alternative.kind === 'lowest_drawdown'
                                ? `Rank ${alternative.result.rank}：回撤較低，最大回撤 ${
                                    alternative.result.summary.max_drawdown == null
                                      ? '--'
                                      : formatPct(alternative.result.summary.max_drawdown)
                                  }`
                                : `Rank ${alternative.result.rank}：穩定度最高，stability_score ${
                                    alternative.result.summary.stability_score == null
                                      ? '--'
                                      : formatNumber(alternative.result.summary.stability_score)
                                  }`}
                          </p>
                        ))}
                      </div>
                    ) : null}

                    {autoSearchMergedCount > 0 ? (
                      <p className="mt-2 text-xs text-[var(--color-text-muted)]">已合併 {autoSearchMergedCount} 筆結果相同的候選參數。</p>
                    ) : null}
                    <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                      下一步提示：建議先用首選參數重新回測，切換到「正式回測確認」重新回測，再決定是否儲存或設為啟用。
                    </p>
                  </div>

                  <div className="mt-3 overflow-x-auto">
                    <table className="min-w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                          <th className="px-2 py-2">排名</th>
                          <th className="px-2 py-2">來源</th>
                          <th className="px-2 py-2">ML預估</th>
                          <th className="px-2 py-2">正式驗證分數</th>
                          {runResult?.auto_search_result?.mode === 'multi_stock_search' ? (
                            <th className="px-2 py-2">多股泛用分數</th>
                          ) : null}
                          <th className="px-2 py-2">未知區驗證分數</th>
                          {runResult?.auto_search_result?.mode === 'multi_stock_search' ? (
                            <th className="px-2 py-2">未知區多股泛用分數</th>
                          ) : null}
                          <th className="px-2 py-2">未知區摘要</th>
                          <th className="px-2 py-2">累積報酬</th>
                          <th className="px-2 py-2">最大回撤</th>
                          <th className="px-2 py-2">穩定度</th>
                          <th className="px-2 py-2">交易次數</th>
                          <th className="px-2 py-2">推薦標籤</th>
                          <th className="px-2 py-2">提醒</th>
                          <th className="px-2 py-2">操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {autoSearchResults.map((item) => {
                          const recommendationTags = buildAutoSearchRecommendationTags(
                            item,
                            autoSearchRecommendationTagStats,
                            autoSearchMinTradeCount
                          );
                          return (
                            <tr key={`auto-search-${item.rank}`} className="border-b border-[var(--color-border)]/60 align-top">
                              <td className="px-2 py-2">{item.rank}</td>
                              <td className="px-2 py-2">{localizeAutoSearchSourceTags(item.source_tags ?? []).join('、') || '--'}</td>
                              <td className="px-2 py-2">{item.predicted_score == null ? '--' : formatNumber(item.predicted_score)}</td>
                              <td className="px-2 py-2">{item.validation_score == null ? '--' : formatNumber(item.validation_score)}</td>
                              {runResult?.auto_search_result?.mode === 'multi_stock_search' ? (
                                <td className="px-2 py-2">{item.cross_stock_score == null ? '--' : formatNumber(item.cross_stock_score)}</td>
                              ) : null}
                              <td className="px-2 py-2">{item.final_holdout_score == null ? '--' : formatNumber(item.final_holdout_score)}</td>
                              {runResult?.auto_search_result?.mode === 'multi_stock_search' ? (
                                <td className="px-2 py-2">
                                  {item.final_holdout_cross_stock_score == null ? '--' : formatNumber(item.final_holdout_cross_stock_score)}
                                </td>
                              ) : null}
                              <td className="px-2 py-2">
                                {item.final_holdout_summary ? (
                                  <details>
                                    <summary className="cursor-pointer text-[11px]">查看</summary>
                                    <pre className="mt-1 max-w-[280px] overflow-x-auto whitespace-pre-wrap text-[10px]">
                                      {JSON.stringify(item.final_holdout_summary, null, 2)}
                                    </pre>
                                  </details>
                                ) : (
                                  '--'
                                )}
                              </td>
                              <td className="px-2 py-2">{item.summary.cumulative_return == null ? '--' : formatPct(item.summary.cumulative_return)}</td>
                              <td className="px-2 py-2">{item.summary.max_drawdown == null ? '--' : formatPct(item.summary.max_drawdown)}</td>
                              <td className="px-2 py-2">{item.summary.stability_score == null ? '--' : formatNumber(item.summary.stability_score)}</td>
                              <td className="px-2 py-2">{item.summary.trade_count ?? '--'}</td>
                              <td className="px-2 py-2">
                                {recommendationTags.length ? (
                                  <div className="flex flex-wrap gap-1">
                                    {recommendationTags.map((tag) => (
                                      <span
                                        key={`${item.rank}-${tag}`}
                                        className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${recommendationTagClass(tag)}`}
                                      >
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                ) : (
                                  '--'
                                )}
                              </td>
                              <td className="px-2 py-2">{(item.warnings ?? []).join(' | ') || '--'}</td>
                              <td className="px-2 py-2">
                                <div className="flex flex-col gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setViewedAutoSearchParams({ rank: item.rank, params: item.params })}
                                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                                  >
                                    查看參數
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleLoadAutoSearchParams(item.params, {
                                        rank: item.rank,
                                        validation_score: item.validation_score ?? null,
                                        verified_score: item.verified_score ?? null,
                                        cross_stock_score: item.cross_stock_score ?? null,
                                        final_holdout_score: item.final_holdout_score ?? null,
                                        final_holdout_cross_stock_score: item.final_holdout_cross_stock_score ?? null,
                                        source_tags: item.source_tags ?? [],
                                      })
                                    }
                                    aria-label={item.rank === 1 ? '用首選重新回測（載入到表單）' : '用此參數重新回測（載入到表單）'}
                                    className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                                  >
                                    {item.rank === 1 ? '用首選重新回測' : '用此參數重新回測'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : (
                <p className="mt-3 text-sm text-[var(--color-text-muted)]">目前無可用 auto search 結果。</p>
              )}

              {viewedAutoSearchParams ? (
                <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-[var(--color-text-muted)]">rank {viewedAutoSearchParams.rank} 參數</p>
                    <button
                      type="button"
                      onClick={() => setViewedAutoSearchParams(null)}
                      className="rounded border border-[var(--color-border)] px-2 py-1 text-xs"
                    >
                      關閉
                    </button>
                  </div>
                  <div className="overflow-x-auto rounded border border-[var(--color-border)] bg-[var(--color-bg)] p-2">
                    <CoreModeParamTable params={viewedAutoSearchParams.params} />
                  </div>
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {activeTab === 'formal_backtest' ? (
          <>
            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">目前回測參數</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">這是目前準備拿來正式回測確認的參數。</p>
              <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
                <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm lg:col-span-2">
                  <p className="text-xs text-[var(--color-text-muted)]">目前參數來源</p>
                  <p className="mt-1 font-semibold">{currentBacktestSourceLabel}</p>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-[var(--color-text-muted)] sm:grid-cols-2">
                    <p>
                      正式驗證分數：{formatNullableNumber(loadedAutoSearchParamsMeta?.validation_score)}
                    </p>
                    {loadedAutoSearchParamsMeta?.cross_stock_score != null ? (
                      <p>多股泛用分數：{formatNumber(loadedAutoSearchParamsMeta.cross_stock_score)}</p>
                    ) : null}
                    <p>
                      未知區驗證分數：{formatNullableNumber(loadedAutoSearchParamsMeta?.final_holdout_score)}
                    </p>
                    {loadedAutoSearchParamsMeta?.final_holdout_cross_stock_score != null ? (
                      <p>未知區多股泛用分數：{formatNumber(loadedAutoSearchParamsMeta.final_holdout_cross_stock_score)}</p>
                    ) : null}
                    <p className="sm:col-span-2">載入時間：{loadedAutoSearchParamsMeta?.loaded_at ?? '--'}</p>
                  </div>
                </article>
                <article className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-sm">
                  <p className="text-xs text-[var(--color-text-muted)]">驗證狀態</p>
                  {shouldHideBacktestResult ? (
                    <p className="mt-1 inline-flex rounded-full border border-amber-300/60 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                      已載入自動搜尋參數，尚未重新回測
                    </p>
                  ) : (
                    <p className="mt-1 inline-flex rounded-full border border-emerald-300/60 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-900">
                      已重新回測確認
                    </p>
                  )}
                </article>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => handleRunBacktest('formal_backtest')}
                  disabled={runLoading || !params}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {runLoading ? <Loader2 size={14} className="animate-spin" /> : <BarChart3 size={14} />}
                  重新執行正式回測
                </button>
              </div>
            </section>

            <section className="bento-cell p-4 sm:p-5">
              <h3 className="text-sm font-semibold">儲存目前回測參數</h3>
              {shouldHideBacktestResult ? (
                <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                  目前參數尚未重新回測確認，不建議直接儲存或啟用。
                </p>
              ) : null}
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-4">
                <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="新參數組合名稱" className="ui-input" />
                <input value={presetDescription} onChange={(e) => setPresetDescription(e.target.value)} placeholder="說明，可選" className="ui-input md:col-span-2" />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  disabled={savingPreset}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-white shadow-md shadow-brand/25 transition hover:brightness-[1.03] disabled:opacity-60"
                  style={{ background: 'var(--brand-gradient)' }}
                >
                  {savingPreset ? '儲存中...' : '儲存目前參數'}
                </button>
              </div>
            </section>

            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">回測結果</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">顯示目前參數重新執行正式回測後的結果。</p>
            </section>

            {runResult && !shouldHideBacktestResult ? (
              <>
                <section className={`bento-cell p-4 sm:p-5 ${toneClassByTrend(trendTone)}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs font-semibold">
                      趨勢判斷：{runResult.summary.trend_conclusion}
                    </span>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${confidenceClass(runResult.summary.confidence_level)}`}>
                      信心：{runResult.summary.confidence_level}
                    </span>
                    {selectedAutoSearchResult ? (
                      <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-bg-card)] px-3 py-1 text-xs">
                        auto search rank {selectedAutoSearchResult.rank}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm">{buildConclusionSentence(runResult.summary.trend_conclusion, runResult.summary.confidence_level)}</p>
                </section>

                {runWarningBadges.length ? (
                  <section className="bento-cell p-4 text-sm">
                    <h2 className="text-base font-bold">warnings</h2>
                    <ul className="mt-2 space-y-2">
                      {runWarningBadges.map((item, idx) => (
                        <li key={`${item.message}-${idx}`} className={`rounded-lg border px-3 py-2 ${warningToneClass(item.level)}`}>
                          {item.message}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                <section className="bento-cell p-4 sm:p-5">
                  <h2 className="text-base font-bold">回測 summary</h2>
                  <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">AC</p><p className="text-lg font-semibold">{formatPct(runResult.summary.ac)}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">cumulative_return</p><p className="text-lg font-semibold">{formatPct(runResult.summary.cumulative_return)}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">max_drawdown</p><p className="text-lg font-semibold">{formatPct(runResult.summary.max_drawdown)}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">stability_score</p><p className="text-lg font-semibold">{formatPct(runResult.summary.stability)}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">win_rate</p><p className="text-lg font-semibold">{formatPct(runResult.summary.win_rate)}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">trade_count</p><p className="text-lg font-semibold">{runResult.summary.trade_count}</p></div>
                    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2.5"><p className="text-[11px] text-[var(--color-text-muted)]">profit_factor</p><p className="text-lg font-semibold">{formatNumber(runResult.summary.profit_factor)}</p></div>
                  </div>
                </section>
                <CoreModePriceChart data={runResult.price_chart} />
                <VirtualTradeTable trades={runResult.trades} />
              </>
            ) : shouldHideBacktestResult ? (
              <section className="bento-cell border-dashed p-6 text-center sm:p-8">
                <TrendingUp className="mx-auto mb-3 text-[var(--color-text-muted)]" size={28} />
                <h2 className="text-lg font-bold">尚未重新回測</h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">
                  目前已載入新的參數，但尚未根據這組參數重新計算回測結果。請先點擊「重新執行正式回測」，完成後才會顯示歷史回測交易軌跡與交易明細。
                </p>
              </section>
            ) : (
              <section className="bento-cell border-dashed p-6 text-center sm:p-8">
                <TrendingUp className="mx-auto mb-3 text-[var(--color-text-muted)]" size={28} />
                <h2 className="text-lg font-bold">尚未有正式回測結果</h2>
                <p className="mt-2 text-sm text-[var(--color-text-muted)]">請先執行「重新執行正式回測」。</p>
              </section>
            )}

            <section className="bento-cell p-4 sm:p-5">
              <details>
                <summary className="cursor-pointer text-sm font-semibold">已儲存參數組管理</summary>
                <p className="mt-2 text-xs text-[var(--color-text-muted)]">這裡管理已儲存的 preset，與目前 Auto Search 載入的參數可能不同。</p>
                {shouldHideBacktestResult ? (
                  <p className="mt-2 rounded-lg border border-amber-300/60 bg-amber-50/70 px-3 py-2 text-xs text-amber-900">
                    目前參數尚未重新回測確認，不建議直接儲存或啟用。
                  </p>
                ) : null}
                <div className="mt-3 space-y-2">
                  <select value={selectedPresetId} onChange={(e) => setSelectedPresetId(e.target.value)} className="ui-input">
                    {presets.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={handleLoadPreset} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium">
                      載入到表單（不啟用）
                    </button>
                    <button type="button" onClick={handleActivatePreset} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm font-medium">
                      設為 Advisor 啟用參數
                    </button>
                  </div>
                  <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-xs">
                    目前啟用 preset：{activePreset?.name ?? '尚未設定'}
                  </div>
                  <p className="text-xs text-[var(--color-text-muted)]">若要變更「目前啟用 preset」，請點「設為 Advisor 啟用參數」。</p>
                </div>
              </details>
            </section>
          </>
        ) : null}

        {activeTab === 'ml_details' ? (
          <>
            <section className="bento-cell p-4 sm:p-5">
              <h2 className="text-base font-bold">技術驗證細節</h2>
              <p className="mt-1 text-xs text-[var(--color-text-muted)]">此區塊是技術驗證細節，不是最終買賣建議。</p>
              <button type="button" onClick={() => setShowMlSettingsPanel((prev) => !prev)} className="mt-3 rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                {showMlSettingsPanel ? '收合 ML 設定' : '展開 ML 設定'}
              </button>

              {showMlSettingsPanel ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm">
                      <input type="checkbox" checked={mlValidationEnabled} onChange={(e) => setMlValidationEnabled(e.target.checked)} className="accent-[var(--color-brand)]" />
                      啟用 ML 驗證
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm">
                      <input type="checkbox" checked={mlEnableModelTraining} onChange={(e) => setMlEnableModelTraining(e.target.checked)} className="accent-[var(--color-brand)]" />
                      啟用模型訓練
                    </label>
                    <label className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] px-3 py-2 text-sm">
                      <input type="checkbox" checked={mlEnableCandidateRanking} onChange={(e) => setMlEnableCandidateRanking(e.target.checked)} className="accent-[var(--color-brand)]" />
                      啟用 ML candidate ranking
                    </label>
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">切分 fold 數</span><input type="number" min={2} step={1} value={mlSplits} onChange={(e) => setMlSplits(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">每 fold 測試樣本數</span><input type="number" min={1} step={1} value={mlTestSize} onChange={(e) => setMlTestSize(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">訓練/測試間隔</span><input type="number" min={0} step={1} value={mlGap} onChange={(e) => setMlGap(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">預測窗</span><input type="number" min={1} step={1} value={mlPredictionHorizon} onChange={(e) => setMlPredictionHorizon(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-[var(--color-text-muted)]">目標類型</span>
                      <select value={mlTargetMode} onChange={(e) => setMlTargetMode(e.target.value as 'future_quality' | 'trade_return' | 'trend_label')} className="ui-input">
                        <option value="future_quality">{localizeCoreModeOption('future_quality')}（可用）</option>
                        <option value="trade_return" disabled>{localizeCoreModeOption('trade_return')}（尚未啟用）</option>
                        <option value="trend_label" disabled>{localizeCoreModeOption('trend_label')}（尚未啟用）</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-[var(--color-text-muted)]">模型類型</span>
                      <select value={mlModelType} onChange={(e) => setMlModelType(e.target.value as 'random_forest' | 'gradient_boosting' | 'logistic_regression')} className="ui-input">
                        <option value="logistic_regression">{localizeCoreModeOption('logistic_regression')}</option>
                        <option value="random_forest">{localizeCoreModeOption('random_forest')}</option>
                        <option value="gradient_boosting">{localizeCoreModeOption('gradient_boosting')}</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-[var(--color-text-muted)]">候選排序模型</span>
                      <select value={mlCandidateRankingModelType} onChange={(e) => setMlCandidateRankingModelType(e.target.value as 'random_forest' | 'gradient_boosting' | 'logistic_regression')} className="ui-input">
                        <option value="random_forest">{localizeCoreModeOption('random_forest')}</option>
                        <option value="gradient_boosting">{localizeCoreModeOption('gradient_boosting')}</option>
                        <option value="logistic_regression">{localizeCoreModeOption('logistic_regression')}</option>
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block text-xs text-[var(--color-text-muted)]">候選排序目標</span>
                      <select value={mlCandidateRankingScoreMode} onChange={(e) => setMlCandidateRankingScoreMode(e.target.value as 'balanced_score' | 'return_score' | 'ac_score' | 'drawdown_score')} className="ui-input">
                        <option value="balanced_score">{localizeCoreModeOption('balanced_score')}</option>
                        <option value="return_score">{localizeCoreModeOption('return_score')}</option>
                        <option value="ac_score">{localizeCoreModeOption('ac_score')}</option>
                        <option value="drawdown_score">{localizeCoreModeOption('drawdown_score')}</option>
                      </select>
                    </label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">候選排序保留數</span><input type="number" min={1} max={20} step={1} value={mlCandidateRankingTopN} onChange={(e) => setMlCandidateRankingTopN(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">未來趨勢品質門檻</span><input type="number" min={0} max={1} step={0.01} value={mlFutureQualityThreshold} onChange={(e) => setMlFutureQualityThreshold(Number(e.target.value))} className="ui-input" /></label>
                    <label className="text-sm"><span className="mb-1 block text-xs text-[var(--color-text-muted)]">最大訓練樣本數</span><input type="number" min={1} step={1} value={mlMaxTrainSize} onChange={(e) => setMlMaxTrainSize(e.target.value)} className="ui-input" placeholder="留空 = 不限制" /></label>
                  </div>
                </>
              ) : null}
            </section>

            <section className="bento-cell p-4 sm:p-5">
              <button type="button" onClick={() => setShowMlResultDetail((prev) => !prev)} className="rounded-lg border border-[var(--color-border)] px-3 py-2 text-sm">
                {showMlResultDetail ? '收合驗證結果表格' : '展開驗證結果表格'}
              </button>
              {showMlResultDetail ? (
                runResult ? (
                  <>
                    <p className="mt-3 text-xs text-[var(--color-text-muted)]">時間序列切分 / 資料集摘要 / 模型驗證 / 候選參數排序</p>
                    <p className="mt-1 text-xs font-semibold text-amber-700">{PHASE3_DATASET_NOTICE}</p>
                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 text-xs">
                      啟用：{runResult.ml_validation?.enabled ? '是' : '否'} ｜ 模式：{runResult.ml_validation?.mode ?? '--'} ｜ 切分 fold 數：
                      {runResult.ml_validation?.n_splits ?? '--'} ｜ 每 fold 測試樣本數：{runResult.ml_validation?.test_size ?? '--'} ｜ 訓練/測試間隔：
                      {runResult.ml_validation?.gap ?? '--'} ｜ 實際間隔：{runResult.ml_validation?.effective_gap ?? '--'}
                    </div>
                    {runResult.ml_validation?.dataset_summary ? (
                      <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                        <h3 className="text-sm font-semibold">ML 資料集摘要</h3>
                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                          樣本數={runResult.ml_validation.dataset_summary.sample_count} ｜ 特徵數=
                          {runResult.ml_validation.dataset_summary.feature_count} ｜ 正樣本比例=
                          {formatPct(runResult.ml_validation.dataset_summary.positive_rate)}
                        </p>
                      </div>
                    ) : null}

                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <h3 className="text-sm font-semibold">三段式資料切分 / Final Holdout 未知區</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        TimeSeriesSplit 是多個 fold 的穩定性驗證；Final Holdout 是最後完全保留的未知區，只在 Top N 確定後才用於最終驗證。兩者不同。
                      </p>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        排名依據為正式驗證分數；未知區驗證分數僅作為觀察，不會回流影響排名。
                      </p>
                      {runResult.auto_search_result?.split_summary ? (
                        <div className="mt-2 space-y-2 text-xs">
                          <div>
                            <p className="font-semibold">訓練區</p>
                            <p>{formatOrderedDateRange(runResult.auto_search_result.split_summary.train_start, runResult.auto_search_result.split_summary.train_end)}</p>
                            <p>筆數：{runResult.auto_search_result.split_summary.train_count}</p>
                            <p className="text-[var(--color-text-muted)]">用途：產生候選參數 / ML 預篩</p>
                          </div>
                          <div>
                            <p className="font-semibold">驗證區</p>
                            <p>
                              {formatOrderedDateRange(
                                runResult.auto_search_result.split_summary.validation_start,
                                runResult.auto_search_result.split_summary.validation_end
                              )}
                            </p>
                            <p>筆數：{runResult.auto_search_result.split_summary.validation_count}</p>
                            <p className="text-[var(--color-text-muted)]">用途：選出 Top N / 正式驗證分數排名依據</p>
                          </div>
                          <div>
                            <p className="font-semibold">未知區驗證</p>
                            <p>
                              {formatOrderedDateRange(
                                runResult.auto_search_result.split_summary.final_holdout_start,
                                runResult.auto_search_result.split_summary.final_holdout_end
                              )}
                            </p>
                            <p>筆數：{runResult.auto_search_result.split_summary.final_holdout_count}</p>
                            <p className="text-[var(--color-text-muted)]">用途：最後未知區驗證，不參與排名</p>
                          </div>
                          {(runResult.auto_search_result.split_summary.warnings ?? []).length ? (
                            <p className="text-amber-700">{(runResult.auto_search_result.split_summary.warnings ?? []).join(' | ')}</p>
                          ) : null}
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                          尚未取得 Final Holdout 三段式切分資訊。請先在「自動找最佳參數」執行搜尋，或確認 final holdout 已啟用。
                        </p>
                      )}
                    </div>

                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <h3 className="text-sm font-semibold">TimeSeriesSplit 結果</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        TimeSeriesSplit 結果（穩定性驗證，不是 Final Holdout 三段式切分）
                      </p>
                      {(runResult.ml_validation?.fold_metrics ?? []).length ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                                <th className="px-2 py-2">Fold</th>
                                <th className="px-2 py-2">訓練區間</th>
                                <th className="px-2 py-2">測試區間</th>
                                <th className="px-2 py-2">AC</th>
                                <th className="px-2 py-2">累積報酬</th>
                                <th className="px-2 py-2">MDD</th>
                                <th className="px-2 py-2">交易數</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(runResult.ml_validation?.fold_metrics ?? []).map((fold) => (
                                <tr key={`fold-${fold.fold_index}`} className="border-b border-[var(--color-border)]/60">
                                  <td className="px-2 py-2">{fold.fold_index}</td>
                                  <td className="px-2 py-2">{formatOrderedDateRange(fold.train_start, fold.train_end)}</td>
                                  <td className="px-2 py-2">{formatOrderedDateRange(fold.test_start, fold.test_end)}</td>
                                  <td className="px-2 py-2">{formatPct(fold.ac)}</td>
                                  <td className="px-2 py-2">{formatPct(fold.cumulative_return)}</td>
                                  <td className="px-2 py-2">{formatPct(fold.max_drawdown)}</td>
                                  <td className="px-2 py-2">{fold.trade_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">目前無 TimeSeriesSplit fold 結果。</p>
                      )}
                    </div>

                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <h3 className="text-sm font-semibold">模型驗證</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        平均準確率={formatNumber(runResult.ml_validation?.ml_model_validation?.metrics?.accuracy_mean ?? 0)} ｜ 平均 F1=
                        {formatNumber(runResult.ml_validation?.ml_model_validation?.metrics?.f1_mean ?? 0)}
                      </p>
                    </div>

                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <h3 className="text-sm font-semibold">特徵重要度</h3>
                      {normalizedFeatureImportance.length ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                                <th className="px-2 py-2">特徵</th>
                                <th className="px-2 py-2">平均重要度</th>
                                <th className="px-2 py-2">重要度標準差</th>
                                <th className="px-2 py-2">有效 fold 數</th>
                              </tr>
                            </thead>
                            <tbody>
                              {normalizedFeatureImportance.map((item) => (
                                <tr key={`fi-${item.feature}`} className="border-b border-[var(--color-border)]/60">
                                  <td className="px-2 py-2">
                                    {localizeCoreModeFeatureName(item.feature)}
                                    <span className="ml-1 text-[10px] text-[var(--color-text-muted)]">({item.feature})</span>
                                  </td>
                                  <td className="px-2 py-2">{formatNumber(item.importance_mean)}</td>
                                  <td className="px-2 py-2">{formatNumber(item.importance_std)}</td>
                                  <td className="px-2 py-2">{item.fold_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">無可用特徵重要度。</p>
                      )}
                    </div>

                    <div className="mt-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3">
                      <h3 className="text-sm font-semibold">候選參數排序</h3>
                      <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                        verified_score 為舊相容欄位，目前語意等同正式驗證分數；未知區驗證分數不參與排序。
                      </p>
                      {(runResult.auto_search_result?.results ?? []).length ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                                <th className="px-2 py-2">排名</th>
                                <th className="px-2 py-2">ML 預估分數</th>
                                <th className="px-2 py-2">正式驗證分數</th>
                                <th className="px-2 py-2">未知區驗證分數</th>
                                <th className="px-2 py-2">參數組合</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(runResult.auto_search_result?.results ?? []).map((item) => {
                                const validationScore = item.validation_score ?? item.verified_score;
                                return (
                                  <tr key={`ranking-auto-search-${item.rank}`} className="border-b border-[var(--color-border)]/60">
                                    <td className="px-2 py-2">{item.rank}</td>
                                    <td className="px-2 py-2">{item.predicted_score == null ? '--' : formatNumber(item.predicted_score)}</td>
                                    <td className="px-2 py-2">{validationScore == null ? '--' : formatNumber(validationScore)}</td>
                                    <td className="px-2 py-2">{item.final_holdout_score == null ? '--' : formatNumber(item.final_holdout_score)}</td>
                                    <td className="px-2 py-2"><CoreModeParamTable params={item.params} /></td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      ) : (runResult.ml_validation?.ml_candidate_ranking?.ranked_candidates ?? []).length ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="min-w-full text-left text-xs">
                            <thead>
                              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-muted)]">
                                <th className="px-2 py-2">排名</th>
                                <th className="px-2 py-2">ML 預估分數</th>
                                <th className="px-2 py-2">正式驗證分數</th>
                                <th className="px-2 py-2">未知區驗證分數</th>
                                <th className="px-2 py-2">參數組合</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(runResult.ml_validation?.ml_candidate_ranking?.ranked_candidates ?? []).map((item) => (
                                <tr key={`ranking-${item.rank}`} className="border-b border-[var(--color-border)]/60">
                                  <td className="px-2 py-2">{item.rank}</td>
                                  <td className="px-2 py-2">{formatNumber(item.predicted_score)}</td>
                                  <td className="px-2 py-2">{formatNumber(item.verified_score)}</td>
                                  <td className="px-2 py-2">--</td>
                                  <td className="px-2 py-2"><CoreModeParamTable params={item.params} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="mt-2 text-xs text-[var(--color-text-muted)]">目前無可用 ranked candidates。</p>
                      )}
                    </div>

                    {mlWarningBadges.length ? (
                      <ul className="mt-3 space-y-2 text-sm">
                        {mlWarningBadges.map((item, idx) => (
                          <li key={`${item.message}-${idx}`} className={`rounded-lg border px-3 py-2 ${warningToneClass(item.level)}`}>
                            {item.message}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {(runResult.auto_search_result?.warnings ?? []).length ? (
                      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-700">
                        {(runResult.auto_search_result?.warnings ?? []).map((item, idx) => (
                          <li key={`auto-search-warning-${idx}`}>{item}</li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-3 text-sm text-[var(--color-text-muted)]">請先執行回測以產生 ML 驗證細節。</p>
                )
              ) : null}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
