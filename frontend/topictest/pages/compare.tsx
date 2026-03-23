import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import Head from 'next/head';
import { motion } from 'motion/react';
import { GitCompare, X } from 'lucide-react';
import { fetchSymbols, fetchMultipleStocks, fetchPriceChange, fetchVolume } from '../lib/api/stock';
import type { CompareChartMode, CompareMetricsRow, MultiStockResponse, PriceChangeResponse } from '../lib/types';
import { getDefaultDateRange } from '../lib/utils/date';
import { buildCorrelationMatrix, buildMetricsRow } from '../lib/utils/compare';
import { StockSearch } from '../components/StockSearch';
import { DateRangePicker } from '../components/DateRangePicker';
import { ComparisonChart } from '../components/ComparisonChart';
import { CompareMetricsTable } from '../components/CompareMetricsTable';
import { RiskReturnScatter } from '../components/RiskReturnScatter';
import { CorrelationHeatmap } from '../components/CorrelationHeatmap';
import { SubpageHeader } from '../components/SubpageHeader';

interface MetricsCacheEntry {
  rows: CompareMetricsRow[];
  priceChangeMap: Record<string, PriceChangeResponse | null>;
}

const MODE_BUTTONS: Array<{ key: CompareChartMode; label: string }> = [
  { key: 'price', label: '股價' },
  { key: 'index100', label: 'Index=100' },
  { key: 'cumulativeReturn', label: '累積報酬%' },
];

export default function ComparePage() {
  const defaults = getDefaultDateRange();
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [compareData, setCompareData] = useState<MultiStockResponse | null>(null);
  const [chartMode, setChartMode] = useState<CompareChartMode>('price');
  const [chartLoading, setChartLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [metricsRows, setMetricsRows] = useState<CompareMetricsRow[]>([]);
  const [priceChangeMap, setPriceChangeMap] = useState<Record<string, PriceChangeResponse | null>>({});
  const compareCacheRef = useRef<Map<string, MultiStockResponse>>(new Map());
  const metricsCacheRef = useRef<Map<string, MetricsCacheEntry>>(new Map());

  useEffect(() => {
    fetchSymbols()
      .then(setAllSymbols)
      .catch((err) => setError(err instanceof Error ? err.message : '無法載入股票清單'));
  }, []);

  const handleCompare = useCallback(async () => {
    if (selected.length < 2) {
      setError('請至少選擇 2 支股票');
      return;
    }
    const symbolsParam = selected.join(',');
    const queryKey = `${symbolsParam}|${startDate}|${endDate}`;

    setChartLoading(true);
    setMetricsLoading(true);
    setError(null);
    setMetricsError(null);
    setWarnings([]);

    const cachedCompare = compareCacheRef.current.get(queryKey);
    if (cachedCompare) setCompareData(cachedCompare);

    const cachedMetrics = metricsCacheRef.current.get(queryKey);
    if (cachedMetrics) {
      setMetricsRows(cachedMetrics.rows);
      setPriceChangeMap(cachedMetrics.priceChangeMap);
      setMetricsLoading(false);
    }

    try {
      if (!cachedCompare) {
        const res = await fetchMultipleStocks(symbolsParam, startDate, endDate);
        setCompareData(res);
        compareCacheRef.current.set(queryKey, res);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入比較資料失敗');
    } finally {
      setChartLoading(false);
    }

    try {
      if (cachedMetrics) return;

      const perSymbolResults = await Promise.all(
        selected.map(async (symbol) => {
          const [changeResult, volumeResult] = await Promise.allSettled([
            fetchPriceChange(symbol, startDate, endDate),
            fetchVolume(symbol, startDate, endDate),
          ]);
          return { symbol, changeResult, volumeResult };
        })
      );

      const nextPriceChangeMap: Record<string, PriceChangeResponse | null> = {};
      const nextRows: CompareMetricsRow[] = [];
      const nextWarnings: string[] = [];

      for (const item of perSymbolResults) {
        const changeData = item.changeResult.status === 'fulfilled' ? item.changeResult.value : null;
        const volumeData = item.volumeResult.status === 'fulfilled' ? item.volumeResult.value : null;
        nextPriceChangeMap[item.symbol] = changeData;
        nextRows.push(buildMetricsRow(item.symbol, changeData, volumeData));

        if (item.changeResult.status === 'rejected') nextWarnings.push(`${item.symbol} 漲跌幅資料載入失敗`);
        if (item.volumeResult.status === 'rejected') nextWarnings.push(`${item.symbol} 成交量資料載入失敗`);
      }

      setMetricsRows(nextRows);
      setPriceChangeMap(nextPriceChangeMap);
      setWarnings(nextWarnings);
      metricsCacheRef.current.set(queryKey, { rows: nextRows, priceChangeMap: nextPriceChangeMap });
    } catch (err) {
      setMetricsError(err instanceof Error ? err.message : '載入比較指標失敗');
    } finally {
      setMetricsLoading(false);
    }
  }, [selected, startDate, endDate]);

  const addSymbol = (sym: string) => {
    if (selected.includes(sym)) return;
    if (selected.length >= 10) {
      setError('最多比較 10 支股票');
      return;
    }
    setSelected((prev) => [...prev, sym]);
  };

  const removeSymbol = (sym: string) => {
    setSelected((prev) => prev.filter((s) => s !== sym));
  };

  const availableSymbols = useMemo(
    () => allSymbols.filter((s) => !selected.includes(s)),
    [allSymbols, selected]
  );

  const correlationMatrix = useMemo(
    () => buildCorrelationMatrix(selected, priceChangeMap),
    [selected, priceChangeMap]
  );

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      <Head>
        <title>股海明燈｜多股比較</title>
        <meta
          name="description"
          content="同時比較多支股票的價格走勢、累積報酬、相關係數與風險報酬（展示／專題用途）。"
        />
      </Head>
      <SubpageHeader
        icon={GitCompare}
        title="多股比較"
        subtitle="同時比較多支股票的走勢與指標"
      />

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <motion.div
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 flex flex-col gap-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex flex-col sm:flex-row gap-4">
            <StockSearch
              symbols={availableSymbols}
              onSelect={addSymbol}
              placeholder="新增股票代號..."
            />
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((sym) => (
                <span
                  key={sym}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#fff9e6] dark:bg-[#ffa95a]/10 border border-[#ffa95a]/20 text-sm font-mono text-[#b97a3a] dark:text-[#ffa95a]"
                >
                  {sym}
                  <button onClick={() => removeSymbol(sym)} className="hover:text-red-500 transition-colors">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && <div className="text-red-500 text-sm">{error}</div>}
          {metricsError && <div className="text-red-500 text-sm">{metricsError}</div>}
          {warnings.length > 0 && (
            <div className="text-amber-600 dark:text-amber-400 text-xs">
              {warnings.join('、')}
            </div>
          )}

          <button
            onClick={handleCompare}
            disabled={chartLoading || metricsLoading || selected.length < 2}
            className="self-start px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white font-medium
                       hover:shadow-lg hover:shadow-[#ffa95a]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {chartLoading || metricsLoading ? '載入中...' : '開始比較'}
          </button>
        </motion.div>

        {compareData && (
          <div className="flex flex-col gap-4">
            <div className="inline-flex self-start bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl p-1">
              {MODE_BUTTONS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => setChartMode(m.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    chartMode === m.key
                      ? 'bg-[#fff0df] dark:bg-[#ffa95a]/20 text-[#b97a3a] dark:text-[#ffd45a]'
                      : 'text-gray-500 dark:text-gray-400 hover:text-[#b97a3a]'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <ComparisonChart data={compareData} mode={chartMode} />
          </div>
        )}
        {!metricsLoading && metricsRows.length > 0 && (
          <>
            <CompareMetricsTable rows={metricsRows} />
            <RiskReturnScatter rows={metricsRows} />
            <CorrelationHeatmap symbols={selected} matrix={correlationMatrix} />
          </>
        )}
      </div>
    </div>
  );
}
