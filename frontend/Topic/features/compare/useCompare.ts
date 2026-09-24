import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchInstitutionalTrades,
  fetchMultipleStocks,
  fetchPriceChange,
  fetchSymbols,
  fetchTechnicalIndicators,
  fetchVolume,
} from '@/lib/api/stock';
import { lastItem, mapInstitutionalTrades, mapTechnicalIndicators } from '@/lib/mappers/stock';
import type { MultiStockResponse, PriceChangeResponse, VolumeAnalysisResponse } from '@/lib/types/api';
import type { CategoryLeader, CompareViewModel, InstitutionalAggregate } from '@/lib/types/compare';
import type { InstitutionalDay, TechnicalDay } from '@/lib/types/view';
import { aggregateInstitutional, buildCategoryLeaders, buildCompareViewModel } from '@/lib/utils/compare';
import { getDefaultDateRange } from '@/lib/utils/date';
import { applyBulkSelection } from '@/lib/utils/stockSelection';
import { userFacingMessage } from '@/lib/api/errorDetail';

export const MAX_COMPARE_STOCKS = 6;
const METRICS_BATCH_SIZE = 3;

export interface CompareMetrics {
  viewModel: CompareViewModel;
  institutionalMap: Record<string, InstitutionalDay[] | null>;
  aggregateMap: Record<string, InstitutionalAggregate>;
  technicalLatestMap: Record<string, TechnicalDay | null>;
  leaders: CategoryLeader[];
  warnings: string[];
}

/** 一次「開始比較」的結果；各區塊一律用這裡的 symbols，不用目前的已選清單（決議 D9-c16） */
export interface CompareResult {
  symbols: string[];
  startDate: string;
  endDate: string;
  chart: MultiStockResponse | null;
  metrics: CompareMetrics | null;
}

interface SymbolMetricFetch {
  symbol: string;
  change: PromiseSettledResult<PriceChangeResponse>;
  volume: PromiseSettledResult<VolumeAnalysisResponse>;
  institutional: PromiseSettledResult<InstitutionalDay[]>;
  technical: PromiseSettledResult<TechnicalDay[]>;
}

/** 每批 3 檔，每檔同時抓 4 支 API；任一支失敗不影響其他 */
async function fetchMetricsInBatches(
  symbols: string[],
  startDate: string,
  endDate: string,
  onProgress: (done: number, total: number) => void,
): Promise<SymbolMetricFetch[]> {
  const results: SymbolMetricFetch[] = [];
  for (let i = 0; i < symbols.length; i += METRICS_BATCH_SIZE) {
    const batch = symbols.slice(i, i + METRICS_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        const [change, volume, institutional, technical] = await Promise.allSettled([
          fetchPriceChange(symbol, startDate, endDate),
          fetchVolume(symbol, startDate, endDate),
          fetchInstitutionalTrades(symbol, startDate, endDate).then(mapInstitutionalTrades),
          fetchTechnicalIndicators(symbol, startDate, endDate).then(mapTechnicalIndicators),
        ]);
        return { symbol, change, volume, institutional, technical };
      }),
    );
    results.push(...batchResults);
    onProgress(Math.min(i + batch.length, symbols.length), symbols.length);
  }
  return results;
}

const valueOf = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

function buildMetrics(symbols: string[], startDate: string, endDate: string, fetched: SymbolMetricFetch[]): CompareMetrics {
  const priceChangeMap: Record<string, PriceChangeResponse | null> = {};
  const volumeMap: Record<string, VolumeAnalysisResponse | null> = {};
  const institutionalMap: Record<string, InstitutionalDay[] | null> = {};
  const technicalMap: Record<string, TechnicalDay[] | null> = {};
  const warnings: string[] = [];

  for (const item of fetched) {
    priceChangeMap[item.symbol] = valueOf(item.change);
    volumeMap[item.symbol] = valueOf(item.volume);
    institutionalMap[item.symbol] = valueOf(item.institutional);
    technicalMap[item.symbol] = valueOf(item.technical);
    if (item.change.status === 'rejected') warnings.push(`${item.symbol} 漲跌資料載入失敗：將影響報酬、波動、回撤、勝率與相關性。`);
    if (item.volume.status === 'rejected') warnings.push(`${item.symbol} 成交資料載入失敗：將影響平均量與平均金額。`);
    if (item.institutional.status === 'rejected') warnings.push(`${item.symbol} 法人資料載入失敗：法人對比與「法人合計買超最高」會顯示 —。`);
    if (item.technical.status === 'rejected') warnings.push(`${item.symbol} 技術指標載入失敗：技術快照與均線趨勢會顯示 —。`);
  }

  const viewModel = buildCompareViewModel({ symbols, startDate, endDate, priceChangeMap, volumeMap });
  const aggregateMap = Object.fromEntries(symbols.map((sym) => [sym, aggregateInstitutional(sym, institutionalMap[sym])]));
  const technicalLatestMap = Object.fromEntries(symbols.map((sym) => [sym, lastItem(technicalMap[sym])]));
  const leaders = buildCategoryLeaders(symbols, viewModel.metricsRows, aggregateMap, technicalLatestMap, viewModel.correlationMatrix);
  return { viewModel, institutionalMap, aggregateMap, technicalLatestMap, leaders, warnings };
}

function summarizeSymbols(symbols: string[], limit = 4): string {
  if (symbols.length <= limit) return symbols.join('、');
  return `${symbols.slice(0, limit).join('、')} 等 ${symbols.length} 檔`;
}

const errorMessage = (err: unknown, fallback: string) => userFacingMessage(err, fallback);

export function useCompare() {
  const [defaults] = useState(() => getDefaultDateRange());
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [result, setResult] = useState<CompareResult | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsProgress, setMetricsProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const chartCache = useRef(new Map<string, MultiStockResponse>());
  const metricsCache = useRef(new Map<string, CompareMetrics>());
  const seqRef = useRef(0);

  useEffect(() => {
    fetchSymbols()
      .then(setAllSymbols)
      .catch((err) => setError(errorMessage(err, '無法載入股票清單')));
  }, []);

  const handleBulkSelect = useCallback(
    (input: string) => {
      if (allSymbols.length === 0) {
        setError('股票清單載入中，請稍後再試。');
        return;
      }
      const { nextSelected, result: bulk } = applyBulkSelection({
        input,
        currentSelected: selected,
        allSymbols,
        maxSelection: MAX_COMPARE_STOCKS,
      });
      if (nextSelected.length !== selected.length) {
        setSelected(nextSelected);
        setError(null);
      }
      if (bulk.added.length > 0) toast.success(`已加入 ${bulk.added.length} 檔：${summarizeSymbols(bulk.added)}`);
      const issues: string[] = [];
      if (bulk.duplicates.length > 0) issues.push(`重複略過 ${bulk.duplicates.length} 檔`);
      if (bulk.invalid.length > 0) issues.push(`無效代號 ${bulk.invalid.length} 檔`);
      if (bulk.overflow.length > 0) issues.push(`超過上限 ${MAX_COMPARE_STOCKS} 檔`);
      if (issues.length > 0) toast.warning(issues.join('；'));
      if (bulk.overflow.length > 0) setError(`最多比較 ${MAX_COMPARE_STOCKS} 支股票`);
    },
    [allSymbols, selected],
  );

  const addSymbol = useCallback(
    (sym: string) => {
      if (selected.includes(sym)) return;
      if (selected.length >= MAX_COMPARE_STOCKS) {
        setError(`最多比較 ${MAX_COMPARE_STOCKS} 支股票`);
        return;
      }
      setSelected((prev) => [...prev, sym]);
      setError(null);
    },
    [selected],
  );

  const removeSymbol = useCallback((sym: string) => setSelected((prev) => prev.filter((s) => s !== sym)), []);

  const clearAll = useCallback(() => {
    // 取消進行中的比較：之後回來的資料一律丟掉（決議 c75）
    seqRef.current += 1;
    setChartLoading(false);
    setMetricsLoading(false);
    setSelected([]);
    setResult(null);
    setWarnings([]);
    setError(null);
    setMetricsError(null);
    setMetricsProgress(null);
  }, []);

  const compare = useCallback(async () => {
    if (selected.length < 2) {
      setError('請至少選擇 2 支股票');
      return;
    }
    const symbols = [...selected];
    const seq = ++seqRef.current;
    const isCurrent = () => seq === seqRef.current;
    const key = `${symbols.join(',')}|${startDate}|${endDate}`;
    const cachedChart = chartCache.current.get(key) ?? null;
    const cachedMetrics = metricsCache.current.get(key) ?? null;

    setChartLoading(!cachedChart);
    setMetricsLoading(!cachedMetrics);
    setMetricsProgress(cachedMetrics ? null : { done: 0, total: symbols.length });
    setError(null);
    setMetricsError(null);
    setWarnings(cachedMetrics?.warnings ?? []);
    // 新的一次比較：舊結果先收起，不跟新資料混在一起
    setResult({ symbols, startDate, endDate, chart: cachedChart, metrics: cachedMetrics });

    if (!cachedChart) {
      try {
        const chart = await fetchMultipleStocks(symbols.join(','), startDate, endDate);
        if (!isCurrent()) return;
        chartCache.current.set(key, chart);
        setResult((prev) => (prev ? { ...prev, chart } : prev));
      } catch (err) {
        if (!isCurrent()) return;
        const msg = errorMessage(err, '載入比較資料失敗');
        setError(msg);
        toast.error(msg);
      } finally {
        if (isCurrent()) setChartLoading(false);
      }
    }

    if (cachedMetrics) return;
    try {
      const fetched = await fetchMetricsInBatches(symbols, startDate, endDate, (done, total) => {
        if (isCurrent()) setMetricsProgress({ done, total });
      });
      if (!isCurrent()) return;
      const metrics = buildMetrics(symbols, startDate, endDate, fetched);
      metricsCache.current.set(key, metrics);
      setResult((prev) => (prev ? { ...prev, metrics } : prev));
      setWarnings(metrics.warnings);
      if (metrics.warnings.length > 0) toast.warning('部分資料缺失，已在頁面中標示影響欄位。');
    } catch (err) {
      if (!isCurrent()) return;
      const msg = errorMessage(err, '載入比較指標失敗');
      setMetricsError(msg);
      toast.error(msg);
    } finally {
      if (isCurrent()) {
        setMetricsLoading(false);
        setMetricsProgress(null);
      }
    }
  }, [selected, startDate, endDate]);

  return {
    allSymbols,
    selected,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    result,
    chartLoading,
    metricsLoading,
    metricsProgress,
    error,
    metricsError,
    warnings,
    handleBulkSelect,
    addSymbol,
    removeSymbol,
    clearAll,
    compare,
  };
}
