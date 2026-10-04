import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchInstitutionalTrades,
  fetchMultipleStocks,
  fetchSymbols,
  fetchTechnicalIndicators,
  fetchVolume,
} from '@/lib/api/stock';
import { lastItem, mapInstitutionalTrades, mapTechnicalIndicators } from '@/lib/mappers/stock';
import { fetchBenchmarkHistory, type BenchmarkHistoryResponse } from '@/lib/api/benchmark';
import { fetchCompareFundamentals, type CompareFundamentalsData } from '@/lib/api/compareFundamentals';
import type { MultiStockResponse, StockInfo, VolumeAnalysisResponse } from '@/lib/types/api';
import type { CategoryLeader, CompareViewModel, InstitutionalAggregate } from '@/lib/types/compare';
import type { InstitutionalDay, TechnicalDay } from '@/lib/types/view';
import { aggregateInstitutional, alignComparePrices, buildCategoryLeaders, buildCompareViewModel, buildInstitutionalRankingAggregates } from '@/lib/utils/compare';
import { getDefaultDateRange } from '@/lib/utils/date';
import { useStockInfos } from '@/lib/hooks/useStockInfos';
import { applyBulkSelection } from '@/lib/utils/stockSelection';
import { userFacingMessage } from '@/lib/api/errorDetail';

const METRICS_BATCH_SIZE = 3;

export interface CompareMetrics {
  viewModel: CompareViewModel;
  institutionalMap: Record<string, InstitutionalDay[] | null>;
  aggregateMap: Record<string, InstitutionalAggregate>;
  technicalLatestMap: Record<string, TechnicalDay | null>;
  leaders: CategoryLeader[];
  warnings: string[];
  fundamentals: Record<string, CompareFundamentalsData | null>;
  fundamentalsEndDate: string;
  benchmark: BenchmarkHistoryResponse | null;
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
  volume: PromiseSettledResult<VolumeAnalysisResponse>;
  institutional: PromiseSettledResult<InstitutionalDay[]>;
  technical: PromiseSettledResult<TechnicalDay[]>;
  fundamentals: PromiseSettledResult<CompareFundamentalsData>;
}

/** Fetch independent supplementary datasets in batches; prices come from the shared chart. */
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
        const [volume, institutional, technical, fundamentals] = await Promise.allSettled([
          fetchVolume(symbol, startDate, endDate),
          fetchInstitutionalTrades(symbol, startDate, endDate).then(mapInstitutionalTrades),
          fetchTechnicalIndicators(symbol, startDate, endDate).then(mapTechnicalIndicators),
          fetchCompareFundamentals(symbol, endDate),
        ]);
        return { symbol, volume, institutional, technical, fundamentals };
      }),
    );
    results.push(...batchResults);
    onProgress(Math.min(i + batch.length, symbols.length), symbols.length);
  }
  return results;
}

const valueOf = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === 'fulfilled' ? r.value : null);

function buildMetrics(symbols: string[], startDate: string, endDate: string, chart: MultiStockResponse | null, fetched: SymbolMetricFetch[], benchmark: PromiseSettledResult<BenchmarkHistoryResponse>): CompareMetrics {
  const volumeMap: Record<string, VolumeAnalysisResponse | null> = {};
  const institutionalMap: Record<string, InstitutionalDay[] | null> = {};
  const technicalMap: Record<string, TechnicalDay[] | null> = {};
  const warnings: string[] = [];
  const fundamentals: Record<string, CompareFundamentalsData | null> = {};

  for (const item of fetched) {
    volumeMap[item.symbol] = valueOf(item.volume);
    institutionalMap[item.symbol] = valueOf(item.institutional);
    technicalMap[item.symbol] = valueOf(item.technical);
    fundamentals[item.symbol] = valueOf(item.fundamentals);
    if (item.fundamentals.status === 'rejected') warnings.push(`${item.symbol} 基本面資料載入失敗，其他比較仍可使用。`);
    else warnings.push(...item.fundamentals.value.warnings);
    if (item.volume.status === 'rejected') warnings.push(`${item.symbol} 成交資料載入失敗：將影響平均量與平均金額。`);
    if (item.institutional.status === 'rejected') warnings.push(`${item.symbol} 法人資料載入失敗：法人對比與「法人合計買超最高」會顯示 —。`);
    if (item.technical.status === 'rejected') warnings.push(`${item.symbol} 技術指標載入失敗：技術快照與均線趨勢會顯示 —。`);
  }

  const viewModel = buildCompareViewModel({ symbols, startDate, endDate, chart, volumeMap });
  const actualEnd = viewModel.qualityMeta.analysisRange?.endDate ?? endDate;
  const aggregateMap = Object.fromEntries(symbols.map((sym) => [sym, aggregateInstitutional(sym, institutionalMap[sym])]));
  const technicalLatestMap = Object.fromEntries(symbols.map((sym) => [sym, viewModel.qualityMeta.analysisRange
    ? technicalMap[sym]?.find((row) => row.date === actualEnd) ?? null
    : lastItem(technicalMap[sym]) ]));
  const ranking = buildInstitutionalRankingAggregates(symbols, institutionalMap);
  if (symbols.length > 1 && symbols.every((sym) => institutionalMap[sym] !== null)
    && ranking.commonDates.length < 2 && symbols.some((sym) => (institutionalMap[sym] ?? []).length > 0)) {
    warnings.push('法人共同資料日不足 2 日，不列入法人摘要排名。');
  }
  const leaders = buildCategoryLeaders(symbols, viewModel.metricsRows, ranking.aggregates, viewModel.qualityMeta.analysisRange ? technicalLatestMap : {}, viewModel.correlationMatrix, viewModel.correlationSamples);
  if (benchmark.status === 'rejected') warnings.push('大盤資料載入失敗，個股比較仍可使用。');
  return { viewModel, institutionalMap, aggregateMap, technicalLatestMap, leaders, warnings,
    fundamentals, fundamentalsEndDate: actualEnd, benchmark: valueOf(benchmark) };
}

function summarizeSymbols(symbols: string[], limit = 4): string {
  if (symbols.length <= limit) return symbols.join('、');
  return `${symbols.slice(0, limit).join('、')} 等 ${symbols.length} 檔`;
}

const errorMessage = (err: unknown, fallback: string) => userFacingMessage(err, fallback);

export function useCompare() {
  const [defaults] = useState(() => getDefaultDateRange());
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const stockInfoList = useStockInfos();
  const stockInfos = useMemo<Record<string, StockInfo>>(
    () => Object.fromEntries((stockInfoList.data ?? []).map((stock) => [stock.symbol, stock])),
    [stockInfoList.data],
  );
  const metadataWarning = stockInfoList.status === 'error' ? '公司與產業資料載入失敗，仍可使用股票代號比較。' : null;
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
    let active = true;
    fetchSymbols()
      .then((symbols) => { if (active) setAllSymbols(symbols); })
      .catch((err) => { if (active) setError(errorMessage(err, '無法載入股票清單')); });
    return () => { active = false; };
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
      });
      if (nextSelected.length !== selected.length) {
        setSelected(nextSelected);
        setError(null);
      }
      if (bulk.added.length > 0) toast.success(`已加入 ${bulk.added.length} 檔：${summarizeSymbols(bulk.added)}`);
      const issues: string[] = [];
      if (bulk.duplicates.length > 0) issues.push(`重複略過 ${bulk.duplicates.length} 檔`);
      if (bulk.invalid.length > 0) issues.push(`無效代號 ${bulk.invalid.length} 檔`);
      if (issues.length > 0) toast.warning(issues.join('；'));
    },
    [allSymbols, selected],
  );

  const addSymbol = useCallback(
    (sym: string) => {
      if (selected.includes(sym)) return;
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
    if (selected.length === 0) return;
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

    let chart = cachedChart;
    if (!cachedChart) {
      try {
        chart = await fetchMultipleStocks(symbols.join(','), startDate, endDate);
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
      const aligned = chart ? alignComparePrices(chart) : null;
      const fetchStart = aligned?.data.length ? aligned.start_date : startDate;
      const fetchEnd = aligned?.data.length ? aligned.end_date : endDate;
      const [fetched, [benchmark]] = await Promise.all([
        fetchMetricsInBatches(symbols, fetchStart, fetchEnd, (done, total) => {
          if (isCurrent()) setMetricsProgress({ done, total });
        }),
        Promise.allSettled([fetchBenchmarkHistory(fetchStart, fetchEnd)]),
      ]);
      if (!isCurrent()) return;
      const metrics = buildMetrics(symbols, startDate, endDate, chart, fetched, benchmark);
      if (chart && metrics.warnings.length === 0) metricsCache.current.set(key, metrics);
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
    stockInfos,
    metadataWarning,
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
