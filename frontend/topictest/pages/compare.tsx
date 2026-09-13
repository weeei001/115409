import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import { motion } from 'motion/react';
import { GitCompare, X } from 'lucide-react';
import { toast } from 'sonner';
import {
  fetchInstitutionalTrades,
  fetchMultipleStocks,
  fetchPriceChange,
  fetchSymbols,
  fetchTechnicalIndicators,
  fetchVolume,
} from '../lib/api/stock';
import type {
  BulkSelectResult,
  CompareChartMode,
  CompareViewModel,
  MultiStockResponse,
  PriceChangeResponse,
  VolumeAnalysisResponse,
} from '../lib/types';
import type {
  InstitutionalTradeListResponse,
  TechnicalIndicatorDayRow,
  TechnicalIndicatorListResponse,
} from '../lib/types/stockDashboard';
import { getDefaultDateRange } from '../lib/utils/date';
import {
  aggregateInstitutional,
  buildCategoryLeaders,
  buildCompareViewModel,
  type CategoryLeader,
  type InstitutionalAggregate,
} from '../lib/utils/compare';
import {
  mapInstitutionalTradesApi,
  mapTechnicalIndicatorsApi,
  mapTechnicalLatestFromList,
} from '../lib/utils/openapiStockMappers';
import { applyBulkSelection } from '../lib/utils/stockSelection';
import { StockSearch } from '../components/StockSearch';
import { DateRangePicker } from '../components/DateRangePicker';
import { ComparisonChart } from '../components/ComparisonChart';
import { CompareMetricsTable } from '../components/CompareMetricsTable';
import { RiskReturnScatter } from '../components/RiskReturnScatter';
import { CorrelationHeatmap } from '../components/CorrelationHeatmap';
import { CompareMethodologyPanel } from '../components/CompareMethodologyPanel';
import { CompareHero } from '../components/compare/CompareHero';
import { CompareCategoryLeaders } from '../components/compare/CompareCategoryLeaders';
import { StockSnapshotCard } from '../components/compare/StockSnapshotCard';
import { InstitutionalComparePanel } from '../components/compare/InstitutionalComparePanel';
import { TechnicalSnapshotGrid } from '../components/compare/TechnicalSnapshotGrid';
import { SubpageHeader } from '../components/SubpageHeader';

interface MetricsCacheEntry {
  viewModel: CompareViewModel;
  fetchWarnings: string[];
  institutionalListMap: Record<string, InstitutionalTradeListResponse | null>;
  technicalListMap: Record<string, TechnicalIndicatorListResponse | null>;
  institutionalAggregateMap: Record<string, InstitutionalAggregate>;
  technicalLatestMap: Record<string, TechnicalIndicatorDayRow | null>;
  categoryLeaders: CategoryLeader[];
}

interface SymbolMetricFetchResult {
  symbol: string;
  changeResult: PromiseSettledResult<PriceChangeResponse>;
  volumeResult: PromiseSettledResult<VolumeAnalysisResponse>;
  institutionalResult: PromiseSettledResult<InstitutionalTradeListResponse>;
  technicalResult: PromiseSettledResult<TechnicalIndicatorListResponse>;
}

const MAX_COMPARE_STOCKS = 6;
const METRICS_BATCH_SIZE = 3;

async function fetchMetricsInBatches(
  symbols: string[],
  startDate: string,
  endDate: string,
  onProgress?: (done: number, total: number) => void,
): Promise<SymbolMetricFetchResult[]> {
  const results: SymbolMetricFetchResult[] = [];

  for (let i = 0; i < symbols.length; i += METRICS_BATCH_SIZE) {
    const batch = symbols.slice(i, i + METRICS_BATCH_SIZE);

    const batchResults = await Promise.all(
      batch.map(async (symbol) => {
        const [changeResult, volumeResult, institutionalApiResult, technicalApiResult] =
          await Promise.allSettled([
            fetchPriceChange(symbol, startDate, endDate),
            fetchVolume(symbol, startDate, endDate),
            fetchInstitutionalTrades(symbol, startDate, endDate),
            fetchTechnicalIndicators(symbol, startDate, endDate),
          ]);

        const institutionalResult: PromiseSettledResult<InstitutionalTradeListResponse> =
          institutionalApiResult.status === 'fulfilled'
            ? {
                status: 'fulfilled',
                value: mapInstitutionalTradesApi(symbol, institutionalApiResult.value),
              }
            : institutionalApiResult;

        const technicalResult: PromiseSettledResult<TechnicalIndicatorListResponse> =
          technicalApiResult.status === 'fulfilled'
            ? {
                status: 'fulfilled',
                value: mapTechnicalIndicatorsApi(symbol, technicalApiResult.value),
              }
            : technicalApiResult;

        return {
          symbol,
          changeResult,
          volumeResult,
          institutionalResult,
          technicalResult,
        };
      }),
    );

    results.push(...batchResults);
    onProgress?.(Math.min(i + batch.length, symbols.length), symbols.length);
  }

  return results;
}

function summarizeSymbols(symbols: string[], limit = 4): string {
  if (symbols.length <= limit) return symbols.join('、');
  return `${symbols.slice(0, limit).join('、')} 等 ${symbols.length} 檔`;
}

function buildLastCloseMap(data: MultiStockResponse | null): Record<string, number | null> {
  if (!data) return {};
  const map: Record<string, number | null> = {};
  for (const symbol of data.symbols) {
    let last: number | null = null;
    for (const row of data.data) {
      const v = row.prices[symbol];
      if (typeof v === 'number' && Number.isFinite(v)) last = v;
    }
    map[symbol] = last;
  }
  return map;
}

export default function ComparePage() {
  const defaults = getDefaultDateRange();
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [compareData, setCompareData] = useState<MultiStockResponse | null>(null);
  const [viewModel, setViewModel] = useState<CompareViewModel | null>(null);
  const [institutionalListMap, setInstitutionalListMap] = useState<
    Record<string, InstitutionalTradeListResponse | null>
  >({});
  const [institutionalAggregateMap, setInstitutionalAggregateMap] = useState<
    Record<string, InstitutionalAggregate>
  >({});
  const [technicalLatestMap, setTechnicalLatestMap] = useState<
    Record<string, TechnicalIndicatorDayRow | null>
  >({});
  const [categoryLeaders, setCategoryLeaders] = useState<CategoryLeader[] | null>(null);
  const [chartMode, setChartMode] = useState<CompareChartMode>('index100');
  const [chartLoading, setChartLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsProgress, setMetricsProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const compareCacheRef = useRef<Map<string, MultiStockResponse>>(new Map());
  const metricsCacheRef = useRef<Map<string, MetricsCacheEntry>>(new Map());
  const compareRequestSeq = useRef(0);
  const controlsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSymbols()
      .then((symbols) => setAllSymbols(symbols.map((symbol) => symbol.toUpperCase())))
      .catch((err) => setError(err instanceof Error ? err.message : '無法載入股票清單'));
  }, []);

  const handleBulkSelect = useCallback(
    (input: string): BulkSelectResult => {
      if (allSymbols.length === 0) {
        const loadingResult: BulkSelectResult = { added: [], duplicates: [], invalid: [], overflow: [] };
        setError('股票清單載入中，請稍後再試。');
        return loadingResult;
      }

      const { nextSelected, result } = applyBulkSelection({
        input,
        currentSelected: selected,
        allSymbols,
        maxSelection: MAX_COMPARE_STOCKS,
      });

      if (nextSelected.length !== selected.length) {
        setSelected(nextSelected);
        setError(null);
      }

      if (result.added.length > 0) {
        toast.success(`已加入 ${result.added.length} 檔：${summarizeSymbols(result.added)}`);
      }

      const issueMessages: string[] = [];
      if (result.duplicates.length > 0) issueMessages.push(`重複略過 ${result.duplicates.length} 檔`);
      if (result.invalid.length > 0) issueMessages.push(`無效代號 ${result.invalid.length} 檔`);
      if (result.overflow.length > 0) issueMessages.push(`超過上限 ${MAX_COMPARE_STOCKS} 檔`);

      if (issueMessages.length > 0) toast.warning(issueMessages.join('；'));
      if (result.overflow.length > 0) setError(`最多比較 ${MAX_COMPARE_STOCKS} 支股票`);

      return result;
    },
    [allSymbols, selected],
  );

  const addSymbol = (sym: string) => {
    if (selected.includes(sym)) return;
    if (selected.length >= MAX_COMPARE_STOCKS) {
      setError(`最多比較 ${MAX_COMPARE_STOCKS} 支股票`);
      return;
    }
    setSelected((prev) => [...prev, sym]);
    setError(null);
  };

  const removeSymbol = (sym: string) => {
    setSelected((prev) => prev.filter((s) => s !== sym));
  };

  const clearSymbols = () => {
    setSelected([]);
    setCompareData(null);
    setViewModel(null);
    setInstitutionalListMap({});
    setInstitutionalAggregateMap({});
    setTechnicalLatestMap({});
    setCategoryLeaders(null);
    setWarnings([]);
    setError(null);
    setMetricsError(null);
    setMetricsProgress(null);
  };

  const handleJumpToControls = useCallback(() => {
    controlsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleCompare = useCallback(async () => {
    if (selected.length < 2) {
      setError('請至少選擇 2 支股票');
      return;
    }

    const seq = ++compareRequestSeq.current;
    const symbolsParam = selected.join(',');
    const queryKey = `${symbolsParam}|${startDate}|${endDate}`;

    setChartLoading(true);
    setMetricsLoading(true);
    setMetricsProgress({ done: 0, total: selected.length });
    setError(null);
    setMetricsError(null);
    setWarnings([]);

    const cachedCompare = compareCacheRef.current.get(queryKey);
    if (cachedCompare && seq === compareRequestSeq.current) setCompareData(cachedCompare);

    const cachedMetrics = metricsCacheRef.current.get(queryKey);
    if (cachedMetrics && seq === compareRequestSeq.current) {
      setViewModel(cachedMetrics.viewModel);
      setInstitutionalListMap(cachedMetrics.institutionalListMap);
      setInstitutionalAggregateMap(cachedMetrics.institutionalAggregateMap);
      setTechnicalLatestMap(cachedMetrics.technicalLatestMap);
      setCategoryLeaders(cachedMetrics.categoryLeaders);
      setWarnings(cachedMetrics.fetchWarnings);
      setMetricsLoading(false);
      setMetricsProgress(null);
    }

    try {
      if (!cachedCompare) {
        const res = await fetchMultipleStocks(symbolsParam, startDate, endDate);
        if (seq !== compareRequestSeq.current) return;
        setCompareData(res);
        compareCacheRef.current.set(queryKey, res);
      }
    } catch (err) {
      if (seq !== compareRequestSeq.current) return;
      const msg = err instanceof Error ? err.message : '載入比較資料失敗';
      setError(msg);
      toast.error(msg);
      setCompareData(null);
    } finally {
      if (seq === compareRequestSeq.current) setChartLoading(false);
    }

    try {
      if (cachedMetrics) return;

      const perSymbolResults = await fetchMetricsInBatches(
        selected,
        startDate,
        endDate,
        (done, total) => {
          if (seq === compareRequestSeq.current) setMetricsProgress({ done, total });
        },
      );

      if (seq !== compareRequestSeq.current) return;

      const nextPriceChangeMap: Record<string, PriceChangeResponse | null> = {};
      const nextVolumeMap: Record<string, VolumeAnalysisResponse | null> = {};
      const nextInstitutionalListMap: Record<string, InstitutionalTradeListResponse | null> = {};
      const nextTechnicalListMap: Record<string, TechnicalIndicatorListResponse | null> = {};
      const fetchWarnings: string[] = [];

      for (const item of perSymbolResults) {
        nextPriceChangeMap[item.symbol] =
          item.changeResult.status === 'fulfilled' ? item.changeResult.value : null;
        nextVolumeMap[item.symbol] =
          item.volumeResult.status === 'fulfilled' ? item.volumeResult.value : null;
        nextInstitutionalListMap[item.symbol] =
          item.institutionalResult.status === 'fulfilled' ? item.institutionalResult.value : null;
        nextTechnicalListMap[item.symbol] =
          item.technicalResult.status === 'fulfilled' ? item.technicalResult.value : null;

        if (item.changeResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 漲跌資料載入失敗：將影響報酬、波動、回撤、勝率與相關性。`);
        }
        if (item.volumeResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 成交資料載入失敗：將影響平均量與平均金額。`);
        }
        if (item.institutionalResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 法人資料載入失敗：法人對比與「法人最愛」會顯示 —。`);
        }
        if (item.technicalResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 技術指標載入失敗：技術快照與均線趨勢會顯示 —。`);
        }
      }

      const nextViewModel = buildCompareViewModel({
        symbols: selected,
        startDate,
        endDate,
        priceChangeMap: nextPriceChangeMap,
        volumeMap: nextVolumeMap,
      });

      const nextInstAggregateMap: Record<string, InstitutionalAggregate> = {};
      for (const sym of selected) {
        nextInstAggregateMap[sym] = aggregateInstitutional(sym, nextInstitutionalListMap[sym]);
      }

      const nextTechnicalLatestMap: Record<string, TechnicalIndicatorDayRow | null> = {};
      for (const sym of selected) {
        const list = nextTechnicalListMap[sym];
        // mapTechnicalLatestFromList 回傳 minimal type；要原始 row 給訊號判讀用，直接取 list 尾端。
        nextTechnicalLatestMap[sym] = list && list.data.length > 0 ? list.data[list.data.length - 1] : null;
        // 同時呼叫 mapTechnicalLatestFromList 維持 API 介面一致性
        mapTechnicalLatestFromList(sym, list);
      }

      const nextLeaders = buildCategoryLeaders(
        selected,
        nextViewModel.metricsRows,
        nextInstAggregateMap,
        nextTechnicalLatestMap,
        nextViewModel.correlationMatrix,
      );

      setViewModel(nextViewModel);
      setInstitutionalListMap(nextInstitutionalListMap);
      setInstitutionalAggregateMap(nextInstAggregateMap);
      setTechnicalLatestMap(nextTechnicalLatestMap);
      setCategoryLeaders(nextLeaders);
      setWarnings(fetchWarnings);

      if (fetchWarnings.length > 0) {
        toast.warning('部分資料缺失，已在頁面中標示影響欄位。');
      }

      metricsCacheRef.current.set(queryKey, {
        viewModel: nextViewModel,
        fetchWarnings,
        institutionalListMap: nextInstitutionalListMap,
        technicalListMap: nextTechnicalListMap,
        institutionalAggregateMap: nextInstAggregateMap,
        technicalLatestMap: nextTechnicalLatestMap,
        categoryLeaders: nextLeaders,
      });
    } catch (err) {
      if (seq !== compareRequestSeq.current) return;
      const msg = err instanceof Error ? err.message : '載入比較指標失敗';
      setMetricsError(msg);
      toast.error(msg);
    } finally {
      if (seq === compareRequestSeq.current) {
        setMetricsLoading(false);
        setMetricsProgress(null);
      }
    }
  }, [selected, startDate, endDate]);

  const availableSymbols = allSymbols.filter((s) => !selected.includes(s));
  const lastCloseMap = useMemo(() => buildLastCloseMap(compareData), [compareData]);
  const snapshotSymbols = compareData?.symbols ?? selected;
  const symbolColors = viewModel?.symbolColors ?? {};

  const snapshotGridClass = (() => {
    const n = snapshotSymbols.length;
    if (n <= 2) return 'grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4';
    if (n === 3) return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4';
    return 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4';
  })();

  return (
    <div className="min-h-[100dvh] flex flex-col text-[var(--color-text-primary)]">
      <Head>
        <title>股海明燈｜多股比較</title>
        <meta
          name="description"
          content="同時比較多支台股的走勢、法人、技術指標與多維分數雷達，協助快速比對相對強弱與分散程度。"
        />
      </Head>

      <SubpageHeader
        icon={GitCompare}
        title="多股比較"
        subtitle="走勢、法人、技術指標、相關性一頁看完，協助快速比對相對強弱。"
      />

      <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        <motion.div
          ref={controlsRef}
          className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-[var(--shadow-card)] p-5 sm:p-6 flex flex-col gap-4 scroll-mt-24"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end gap-4">
            <StockSearch
              className="flex-1 min-w-0"
              symbols={availableSymbols}
              onSelect={addSymbol}
              onBulkSelect={handleBulkSelect}
              maxSelection={MAX_COMPARE_STOCKS}
              selectedCount={selected.length}
              placeholder="新增股票代號..."
            />
            <DateRangePicker
              className="shrink-0 lg:pl-5 lg:ml-1 lg:border-l lg:border-[var(--color-border)]"
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
            <p>已選 {selected.length}/{MAX_COMPARE_STOCKS}；至少 2 檔才可比較。</p>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={clearSymbols}
                className="px-2.5 py-1 rounded-lg border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-up/50 hover:text-up cursor-pointer"
              >
                清空全部
              </button>
            )}
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((sym) => (
                <span
                  key={sym}
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-brand/5 dark:bg-brand/15 border border-brand/40 text-sm font-mono font-medium text-brand-deep dark:text-brand"
                >
                  {sym}
                  <button
                    type="button"
                    onClick={() => removeSymbol(sym)}
                    className="rounded-full p-0.5 text-brand-deep/70 hover:text-up hover:bg-up-muted transition-colors cursor-pointer"
                    aria-label={`移除 ${sym}`}
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis">
              {error}
            </div>
          )}

          {metricsError && (
            <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up-emphasis">
              {metricsError}
            </div>
          )}

          {warnings.length > 0 && (
            <div
              role="status"
              aria-live="polite"
              className="ui-alert-warning px-4 py-3 rounded-xl text-xs space-y-1"
            >
              {warnings.map((warning) => (
                <p key={warning}>• {warning}</p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleCompare}
            disabled={chartLoading || metricsLoading || selected.length < 2}
            className="w-full sm:w-auto sm:self-start px-8 py-3 rounded-2xl text-[var(--color-on-brand)] text-[15px] font-semibold shadow-md shadow-brand/25
                       hover:shadow-lg hover:brightness-[1.02] transition-[box-shadow,filter,opacity] disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
            style={{ background: 'var(--brand-gradient)' }}
          >
            {chartLoading ? '載入主圖資料...' : metricsLoading ? '計算比較指標...' : '開始比較'}
          </button>

          {(chartLoading || metricsLoading) && (
            <div
              className="text-xs text-[var(--color-text-muted)]"
              aria-live="polite"
              aria-atomic="true"
            >
              {chartLoading && <p>主圖資料載入中...</p>}
              {metricsLoading && metricsProgress && (
                <p>指標資料載入中：{metricsProgress.done}/{metricsProgress.total}</p>
              )}
            </div>
          )}
        </motion.div>

        {viewModel && compareData && (
          <CompareHero
            symbols={compareData.symbols}
            symbolColors={symbolColors}
            startDate={viewModel.qualityMeta.analysisRange.startDate}
            endDate={viewModel.qualityMeta.analysisRange.endDate}
            alignedDays={viewModel.qualityMeta.alignedDays}
            onJumpToControls={handleJumpToControls}
          />
        )}

        {/* ① 概覽：類別冠軍 */}
        {categoryLeaders && (
          <CompareCategoryLeaders leaders={categoryLeaders} symbolColors={symbolColors} />
        )}

        {/* ② 走勢與報酬：比較主圖 → 快照走勢 → 指標表 */}
        {compareData && (
          <ComparisonChart
            data={compareData}
            mode={chartMode}
            onModeChange={setChartMode}
            symbolColors={symbolColors}
          />
        )}

        {viewModel && compareData && snapshotSymbols.length > 0 && (
          <section aria-label="個股快照網格">
            <h2 className="sr-only">個股快照</h2>
            <div className={snapshotGridClass}>
              {snapshotSymbols.map((sym) => {
                const metricsRow = viewModel.metricsRows.find((r) => r.symbol === sym);
                return (
                  <StockSnapshotCard
                    key={sym}
                    symbol={sym}
                    color={symbolColors[sym] ?? '#999999'}
                    multiStockData={compareData}
                    metricsRow={metricsRow}
                  />
                );
              })}
            </div>
          </section>
        )}

        {!metricsLoading && viewModel && viewModel.metricsRows.length > 0 && (
          <CompareMetricsTable rows={viewModel.metricsRows} symbolColors={symbolColors} />
        )}

        {/* ③ 風險與關聯：散佈圖 + 相關性熱力圖 */}
        {!metricsLoading && viewModel && viewModel.metricsRows.length > 0 && (
          <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <RiskReturnScatter rows={viewModel.metricsRows} symbolColors={symbolColors} />
            <CorrelationHeatmap
              symbols={selected}
              matrix={viewModel.correlationMatrix}
              alignedDays={viewModel.qualityMeta.alignedDays}
            />
          </section>
        )}

        {/* ④ 籌碼與技術 */}
        {viewModel && Object.keys(institutionalListMap).length > 0 && (
          <InstitutionalComparePanel
            symbols={selected}
            institutionalMap={institutionalListMap}
            aggregateMap={institutionalAggregateMap}
            symbolColors={symbolColors}
          />
        )}

        {viewModel && Object.keys(technicalLatestMap).length > 0 && (
          <TechnicalSnapshotGrid
            symbols={selected}
            technicalLatestMap={technicalLatestMap}
            lastCloseMap={lastCloseMap}
            symbolColors={symbolColors}
          />
        )}

        {/* ⑤ 方法與可信度 */}
        {viewModel && <CompareMethodologyPanel qualityMeta={viewModel.qualityMeta} />}
      </main>
    </div>
  );
}
