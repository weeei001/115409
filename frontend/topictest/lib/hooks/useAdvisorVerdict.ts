import { useCallback, useEffect, useMemo } from 'react';
import { toast } from 'sonner';
import { formatAdvisorError } from '../api/userFacingError';
import { useStockBehaviorAdvisor } from './useStockBehaviorAdvisor';
import type { UseStockDashboardResult } from './useStockDashboard';
import { summarizePricePosition } from '../utils/advisorSignals';
import {
  buildMaPositionSummary,
  buildReasonList,
  getTrendSummaryText,
  getVolumeInsight,
  normalizeReasonText,
} from '../utils/advisorUiHelpers';
import { mapDashboardToPartialCards } from '../utils/dashboardToAdvisorPartial';

interface UseAdvisorVerdictParams {
  symbol: string;
  dashboard: UseStockDashboardResult;
}

/**
 * 集中管理 AI 投資分析的狀態與衍生欄位，讓 Hero Verdict Card 與完整 `#ai-advisor`
 * 區塊共用同一份資料來源（單一 useStockBehaviorAdvisor 實例）。
 */
export function useAdvisorVerdict({ symbol, dashboard }: UseAdvisorVerdictParams) {
  const advisor = useStockBehaviorAdvisor();
  const {
    loading,
    error,
    setError,
    report,
    progress,
    aiTrendAnalysis,
    run: runAdvisorAnalysis,
    reset,
  } = advisor;

  // partialCards 從目前 dashboard 狀態即時 derive，dashboard 資料一進來會自動更新；
  // 不像之前 advisor 內部只在 run() 開頭快照一次，導致 race condition。
  const partialCards = useMemo(
    () =>
      mapDashboardToPartialCards(
        {
          institutionalRange: dashboard.institutionalRange,
          indicatorsRange: dashboard.indicatorsRange,
          priceChart: dashboard.priceChart,
          endDate: dashboard.endDate,
        },
        `${symbol}-derived`,
        dashboard.endDate ?? ''
      ),
    [
      symbol,
      dashboard.institutionalRange,
      dashboard.indicatorsRange,
      dashboard.priceChart,
      dashboard.endDate,
    ]
  );

  const dashboardSlice = useMemo(
    () => ({
      institutionalRange: dashboard.institutionalRange,
      indicatorsRange: dashboard.indicatorsRange,
      priceChart: dashboard.priceChart,
      endDate: dashboard.endDate,
    }),
    [dashboard.institutionalRange, dashboard.indicatorsRange, dashboard.priceChart, dashboard.endDate]
  );

  const runAnalysis = useCallback(
    async (force: boolean) => {
      if (!symbol.trim() || !dashboard.endDate) return;
      try {
        await runAdvisorAnalysis(symbol, {
          as_of_date: dashboard.endDate,
          dashboard: dashboardSlice,
          force,
        });
      } catch (err) {
        const msg =
          err instanceof Error && err.message ? err.message : formatAdvisorError(err);
        setError(msg);
        toast.error(msg);
      }
    },
    [symbol, dashboard.endDate, dashboardSlice, runAdvisorAnalysis, setError]
  );

  useEffect(() => {
    reset();
  }, [symbol, reset]);

  useEffect(() => {
    if (!symbol.trim() || dashboard.loading || !dashboard.endDate || !dashboard.latest) return;
    void runAnalysis(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 僅在代號／基準日／就緒狀態變更時自動分析
  }, [symbol, dashboard.endDate, dashboard.loading, dashboard.latest]);

  const generatedAtLabel = useMemo(() => {
    if (!report?.generated_at) return '--';
    const date = new Date(report.generated_at);
    return Number.isNaN(date.getTime()) ? report.generated_at : date.toLocaleString('zh-TW');
  }, [report?.generated_at]);

  const pricePosition = useMemo(
    () => summarizePricePosition(dashboard.priceChart ?? null),
    [dashboard.priceChart]
  );

  const keyReasons = useMemo(
    () => (report ? buildReasonList(report).map((item) => normalizeReasonText(item)) : []),
    [report]
  );

  const headlineReason = useMemo(() => {
    const first = keyReasons.find((item) => item && item !== '—');
    return first ?? '';
  }, [keyReasons]);

  const maPositionSummary = useMemo(
    () =>
      buildMaPositionSummary({
        relativeToMA20: pricePosition.relativeToMA20,
        relativeToMA60: pricePosition.relativeToMA60,
      }),
    [pricePosition.relativeToMA20, pricePosition.relativeToMA60]
  );

  const volumeInsight = useMemo(
    () => getVolumeInsight(dashboard.priceChart ?? null),
    [dashboard.priceChart]
  );

  const maStructureLabel = useMemo(() => {
    const trendSummary = getTrendSummaryText(pricePosition);
    if (trendSummary.includes('偏多')) return '偏多';
    if (trendSummary.includes('偏空')) return '偏空';
    return '盤整';
  }, [pricePosition]);

  const maPositionLabel = useMemo(
    () => maPositionSummary.replace('目前收盤相對均線：', ''),
    [maPositionSummary]
  );

  const volumeConfirmLabel = useMemo(() => {
    if (volumeInsight.status === '量增') return '充足';
    if (volumeInsight.status === '量縮') return '不足';
    if (volumeInsight.status === '接近均量') return '中性';
    return '無資料';
  }, [volumeInsight.status]);

  return {
    loading,
    error,
    setError,
    report,
    progress,
    partialCards,
    aiTrendAnalysis,
    runAnalysis,
    generatedAtLabel,
    pricePosition,
    keyReasons,
    headlineReason,
    maPositionSummary,
    maPositionLabel,
    maStructureLabel,
    volumeInsight,
    volumeConfirmLabel,
  };
}

export type UseAdvisorVerdictResult = ReturnType<typeof useAdvisorVerdict>;
