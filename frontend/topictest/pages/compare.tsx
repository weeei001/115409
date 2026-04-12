import React, { useCallback, useEffect, useRef, useState } from 'react';
import Head from 'next/head';
import { motion } from 'motion/react';
import { GitCompare, X } from 'lucide-react';
import { toast } from 'sonner';
import { fetchSymbols, fetchMultipleStocks, fetchPriceChange, fetchVolume } from '../lib/api/stock';
import type {
  BulkSelectResult,
  CompareChartMode,
  CompareViewModel,
  MultiStockResponse,
  PriceChangeResponse,
  VolumeAnalysisResponse,
} from '../lib/types';
import { getDefaultDateRange } from '../lib/utils/date';
import { buildCompareViewModel } from '../lib/utils/compare';
import { applyBulkSelection } from '../lib/utils/stockSelection';
import { StockSearch } from '../components/StockSearch';
import { DateRangePicker } from '../components/DateRangePicker';
import { ComparisonChart } from '../components/ComparisonChart';
import { CompareMetricsTable } from '../components/CompareMetricsTable';
import { RiskReturnScatter } from '../components/RiskReturnScatter';
import { CorrelationHeatmap } from '../components/CorrelationHeatmap';
import { CompareInsightsPanel } from '../components/CompareInsightsPanel';
import { CompareMethodologyPanel } from '../components/CompareMethodologyPanel';
import { SubpageHeader } from '../components/SubpageHeader';

interface MetricsCacheEntry {
  viewModel: CompareViewModel;
  fetchWarnings: string[];
}

interface SymbolMetricFetchResult {
  symbol: string;
  changeResult: PromiseSettledResult<PriceChangeResponse>;
  volumeResult: PromiseSettledResult<VolumeAnalysisResponse>;
}

const MODE_BUTTONS: Array<{ key: CompareChartMode; label: string }> = [
  { key: 'price', label: '報價' },
  { key: 'index100', label: 'Index=100' },
  { key: 'cumulativeReturn', label: '累積報酬%' },
];

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
        const [changeResult, volumeResult] = await Promise.allSettled([
          fetchPriceChange(symbol, startDate, endDate),
          fetchVolume(symbol, startDate, endDate),
        ]);
        return { symbol, changeResult, volumeResult };
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

export default function ComparePage() {
  const defaults = getDefaultDateRange();
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [compareData, setCompareData] = useState<MultiStockResponse | null>(null);
  const [viewModel, setViewModel] = useState<CompareViewModel | null>(null);
  const [chartMode, setChartMode] = useState<CompareChartMode>('price');
  const [chartLoading, setChartLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [metricsProgress, setMetricsProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const compareCacheRef = useRef<Map<string, MultiStockResponse>>(new Map());
  const metricsCacheRef = useRef<Map<string, MetricsCacheEntry>>(new Map());

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
      if (result.duplicates.length > 0) {
        issueMessages.push(`重複略過 ${result.duplicates.length} 檔`);
      }
      if (result.invalid.length > 0) {
        issueMessages.push(`無效代號 ${result.invalid.length} 檔`);
      }
      if (result.overflow.length > 0) {
        issueMessages.push(`超過上限 ${MAX_COMPARE_STOCKS} 檔`);
      }

      if (issueMessages.length > 0) {
        toast.warning(issueMessages.join('；'));
      }

      if (result.overflow.length > 0) {
        setError(`最多比較 ${MAX_COMPARE_STOCKS} 支股票`);
      }

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
    setWarnings([]);
    setError(null);
    setMetricsError(null);
    setMetricsProgress(null);
  };

  const handleCompare = useCallback(async () => {
    if (selected.length < 2) {
      setError('請至少選擇 2 支股票');
      return;
    }

    const symbolsParam = selected.join(',');
    const queryKey = `${symbolsParam}|${startDate}|${endDate}`;

    setChartLoading(true);
    setMetricsLoading(true);
    setMetricsProgress({ done: 0, total: selected.length });
    setError(null);
    setMetricsError(null);
    setWarnings([]);

    const cachedCompare = compareCacheRef.current.get(queryKey);
    if (cachedCompare) setCompareData(cachedCompare);

    const cachedMetrics = metricsCacheRef.current.get(queryKey);
    if (cachedMetrics) {
      setViewModel(cachedMetrics.viewModel);
      setWarnings(cachedMetrics.fetchWarnings);
      setMetricsLoading(false);
      setMetricsProgress(null);
    }

    try {
      if (!cachedCompare) {
        const res = await fetchMultipleStocks(symbolsParam, startDate, endDate);
        setCompareData(res);
        compareCacheRef.current.set(queryKey, res);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '載入比較資料失敗';
      setError(msg);
      toast.error(msg);
      setCompareData(null);
    } finally {
      setChartLoading(false);
    }

    try {
      if (cachedMetrics) return;

      const perSymbolResults = await fetchMetricsInBatches(
        selected,
        startDate,
        endDate,
        (done, total) => setMetricsProgress({ done, total }),
      );

      const nextPriceChangeMap: Record<string, PriceChangeResponse | null> = {};
      const nextVolumeMap: Record<string, VolumeAnalysisResponse | null> = {};
      const fetchWarnings: string[] = [];

      for (const item of perSymbolResults) {
        const changeData = item.changeResult.status === 'fulfilled' ? item.changeResult.value : null;
        const volumeData = item.volumeResult.status === 'fulfilled' ? item.volumeResult.value : null;

        nextPriceChangeMap[item.symbol] = changeData;
        nextVolumeMap[item.symbol] = volumeData;

        if (item.changeResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 漲跌資料載入失敗：將影響報酬、波動、回撤、勝率與相關性。`);
        }
        if (item.volumeResult.status === 'rejected') {
          fetchWarnings.push(`${item.symbol} 成交資料載入失敗：將影響平均量與平均金額。`);
        }
      }

      const nextViewModel = buildCompareViewModel({
        symbols: selected,
        startDate,
        endDate,
        priceChangeMap: nextPriceChangeMap,
        volumeMap: nextVolumeMap,
      });

      setViewModel(nextViewModel);
      setWarnings(fetchWarnings);

      if (fetchWarnings.length > 0) {
        toast.warning('部分資料缺失，已在頁面中標示影響欄位。');
      }

      metricsCacheRef.current.set(queryKey, {
        viewModel: nextViewModel,
        fetchWarnings,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '載入比較指標失敗';
      setMetricsError(msg);
      toast.error(msg);
    } finally {
      setMetricsLoading(false);
      setMetricsProgress(null);
    }
  }, [selected, startDate, endDate]);

  const availableSymbols = allSymbols.filter((s) => !selected.includes(s));

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜多股比較</title>
        <meta
          name="description"
          content="同時比較多支股票的價格走勢、累積報酬、相關係數與風險報酬（前端運算比較示範）。"
        />
      </Head>

      <SubpageHeader
        icon={GitCompare}
        title="多股比較"
        subtitle="前端運算比較，後端提供原始行情資料"
      />

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        <motion.section
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700 shadow-sm p-5 sm:p-6 flex flex-col gap-4"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
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
              className="shrink-0 lg:pl-5 lg:ml-1 lg:border-l lg:border-gray-100 dark:lg:border-gray-600"
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          <div className="flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
            <p>已選 {selected.length}/{MAX_COMPARE_STOCKS}；至少 2 檔才可比較。</p>
            {selected.length > 0 && (
              <button
                type="button"
                onClick={clearSymbols}
                className="px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-red-300 text-gray-500 hover:text-red-500 cursor-pointer"
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
                  className="inline-flex items-center gap-1.5 pl-3 pr-2 py-1.5 rounded-full bg-[#fff7ed] dark:bg-[#ffa95a]/15 border border-[#ffa95a]/50 text-sm font-mono font-medium text-[#ea580c] dark:text-[#ffa95a]"
                >
                  {sym}
                  <button
                    type="button"
                    onClick={() => removeSymbol(sym)}
                    className="rounded-full p-0.5 text-[#ea580c]/70 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors cursor-pointer"
                    aria-label={`移除 ${sym}`}
                  >
                    <X size={14} strokeWidth={2.5} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {error}
            </div>
          )}

          {metricsError && (
            <div className="px-4 py-3 rounded-xl bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-sm text-red-600 dark:text-red-400">
              {metricsError}
            </div>
          )}

          {warnings.length > 0 && (
            <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-400 space-y-1">
              {warnings.map((warning) => (
                <p key={warning}>• {warning}</p>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleCompare}
            disabled={chartLoading || metricsLoading || selected.length < 2}
            className="w-full sm:w-auto sm:self-start px-8 py-3 rounded-2xl bg-gradient-to-r from-[#ffa95a] to-[#ffb347] text-white text-[15px] font-semibold shadow-md shadow-[#ffa95a]/25
                       hover:shadow-lg hover:shadow-[#ffa95a]/30 hover:brightness-[1.02] transition-all disabled:opacity-45 disabled:cursor-not-allowed disabled:shadow-none"
          >
            {chartLoading ? '載入主圖資料...' : metricsLoading ? '計算比較指標...' : '開始比較'}
          </button>

          {(chartLoading || metricsLoading) && (
            <div className="text-xs text-gray-500 dark:text-gray-400">
              {chartLoading && <p>主圖資料載入中...</p>}
              {metricsLoading && metricsProgress && (
                <p>指標資料載入中：{metricsProgress.done}/{metricsProgress.total}</p>
              )}
            </div>
          )}

          {compareData && (
            <div
              className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-gray-50 dark:bg-gray-900/50 border border-gray-100 dark:border-gray-600/80 w-full sm:w-fit"
              role="tablist"
              aria-label="圖表顯示模式"
            >
              {MODE_BUTTONS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={chartMode === m.key}
                  onClick={() => setChartMode(m.key)}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors cursor-pointer ${
                    chartMode === m.key
                      ? 'bg-white dark:bg-gray-800 text-[#c2410c] dark:text-[#ffa95a] shadow-sm ring-1 ring-[#ffa95a]/30'
                      : 'text-gray-500 dark:text-gray-400 hover:text-[#b45309] dark:hover:text-gray-200'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </motion.section>

        {viewModel && <CompareInsightsPanel insights={viewModel.insights} symbolColors={viewModel.symbolColors} />}

        {compareData && (
          <ComparisonChart
            data={compareData}
            mode={chartMode}
            symbolColors={viewModel?.symbolColors}
          />
        )}

        {viewModel && <CompareMethodologyPanel qualityMeta={viewModel.qualityMeta} />}

        {!metricsLoading && viewModel && viewModel.metricsRows.length > 0 && (
          <section className="flex flex-col gap-6">
            <CompareMetricsTable
              rows={viewModel.metricsRows}
              symbolColors={viewModel.symbolColors}
            />
            <RiskReturnScatter
              rows={viewModel.metricsRows}
              symbolColors={viewModel.symbolColors}
            />
            <CorrelationHeatmap
              symbols={selected}
              matrix={viewModel.correlationMatrix}
            />
          </section>
        )}
      </div>
    </div>
  );
}
