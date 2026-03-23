import React, { useEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { TrendingUp } from 'lucide-react';
import {
  fetchLatestPrice,
  fetchCandlestickMA,
  fetchVolume,
  fetchPriceChange,
  fetchStatistics,
  fetchHistory,
  fetchDateRange,
} from '../../lib/api/stock';
import type {
  DailyPriceResponse,
  CandlestickWithMAResponse,
  VolumeAnalysisResponse,
  PriceChangeResponse,
  PriceStatistics,
  HistoricalPriceList,
  AITrendAnalysis,
} from '../../lib/types';
import { StockHeader } from '../../components/StockHeader';
import { StatisticsPanel } from '../../components/StatisticsPanel';
import { CandlestickChart } from '../../components/CandlestickChart';
import { VolumeChart } from '../../components/VolumeChart';
import { PriceChangeChart } from '../../components/PriceChangeChart';
import { HistoryTable } from '../../components/HistoryTable';
import { DateRangePicker } from '../../components/DateRangePicker';
import { AITrendPanel } from '../../components/AITrendPanel';
import { SubpageHeader } from '../../components/SubpageHeader';
import { getDefaultDateRange } from '../../lib/utils/date';

const HISTORY_PAGE_SIZE = 30;

const mockAiAnalysis: AITrendAnalysis = {
  conclusion: '強力看多',
  confidence: 92,
  summary:
    '受惠於 AI 晶片需求強勁，先進製程產能滿載，預期本季營收將再創新高。外資連續買超，技術面呈現多頭排列，短期內上漲動能充足。',
  sources: [
    { id: '1', title: '外資重申台積電買進評等，目標價上看 1200 元', date: '2026-03-15' },
    { id: '2', title: 'AI 伺服器需求爆發，3奈米產能供不應求', date: '2026-03-14' },
    { id: '3', title: '法說會釋出樂觀展望，資本支出維持高檔', date: '2026-03-12' },
  ],
};

export default function StockDetail() {
  const router = useRouter();
  const symbol = (Array.isArray(router.query.id) ? router.query.id[0] : router.query.id) || '';

  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [latest, setLatest] = useState<DailyPriceResponse | null>(null);
  const [candlestickMA, setCandlestickMA] = useState<CandlestickWithMAResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeAnalysisResponse | null>(null);
  const [priceChangeData, setPriceChangeData] = useState<PriceChangeResponse | null>(null);
  const [statistics, setStatistics] = useState<PriceStatistics | null>(null);
  const [history, setHistory] = useState<HistoricalPriceList | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);

  const chartReqIdRef = useRef(0);
  const historyReqIdRef = useRef(0);

  const loadChartData = useCallback(async (sym: string, sd: string, ed: string) => {
    const id = ++chartReqIdRef.current;
    setChartError(null);
    setChartLoading(true);
    try {
      const results = await Promise.allSettled([
        fetchCandlestickMA(sym, sd, ed, '5,10,20'),
        fetchVolume(sym, sd, ed),
        fetchPriceChange(sym, sd, ed),
        fetchStatistics(sym, sd, ed),
      ]);
      if (id !== chartReqIdRef.current) return;

      const [kma, vol, pc, stats] = results;
      if (kma.status === 'fulfilled') setCandlestickMA(kma.value);
      if (vol.status === 'fulfilled') setVolumeData(vol.value);
      if (pc.status === 'fulfilled') setPriceChangeData(pc.value);
      if (stats.status === 'fulfilled') setStatistics(stats.value);

      const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
      if (fulfilled === 0) {
        const firstRejected = results.find((r) => r.status === 'rejected') as
          | PromiseRejectedResult
          | undefined;
        const msg =
          firstRejected?.reason instanceof Error
            ? firstRejected.reason.message
            : '圖表資料載入失敗';
        setChartError(msg);
      }
    } catch (err) {
      if (id !== chartReqIdRef.current) return;
      setChartError(err instanceof Error ? err.message : '圖表資料載入失敗');
    } finally {
      if (id === chartReqIdRef.current) setChartLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (sym: string, page: number) => {
    const id = ++historyReqIdRef.current;
    setHistoryError(null);
    try {
      const res = await fetchHistory(sym, {
        skip: (page - 1) * HISTORY_PAGE_SIZE,
        limit: HISTORY_PAGE_SIZE,
      });
      if (id !== historyReqIdRef.current) return;
      setHistory(res);
    } catch (err) {
      if (id !== historyReqIdRef.current) return;
      console.error('loadHistory failed:', err);
      setHistoryError(err instanceof Error ? err.message : '無法載入歷史資料');
      setHistory(null);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || !symbol) return;

    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      try {
        const latestRes = await fetchLatestPrice(symbol);
        if (cancelled) return;
        setLatest(latestRes);

        let sd = startDate;
        let ed = endDate;
        try {
          const range = await fetchDateRange(symbol);
          if (range.latest_date) ed = range.latest_date;
          const startD = new Date(ed);
          startD.setMonth(startD.getMonth() - 3);
          sd = startD.toISOString().slice(0, 10);
          if (!cancelled) {
            setStartDate(sd);
            setEndDate(ed);
          }
        } catch {
          /* use defaults */
        }
        if (!cancelled) setHistoryPage(1);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '載入失敗');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    init();
    return () => { cancelled = true; };
  }, [symbol, router.isReady]);

  useEffect(() => {
    if (!symbol || loading) return;
    loadChartData(symbol, startDate, endDate);
  }, [symbol, loading, startDate, endDate, loadChartData]);

  useEffect(() => {
    if (!symbol || loading) return;
    void loadHistory(symbol, historyPage);
  }, [historyPage, symbol, loading, loadHistory]);

  const stockPageHead = (
    <Head>
      <title>{symbol ? `股海明燈｜${symbol} 個股分析` : '股海明燈｜個股分析'}</title>
      <meta
        name="description"
        content={
          symbol
            ? `查詢 ${symbol} 即時股價、K 線、成交量、漲跌幅與歷史行情（展示／專題用途）。`
            : '個股走勢、技術線圖與歷史行情分析（展示／專題用途）。'
        }
      />
    </Head>
  );

  if (loading) {
    return (
      <>
        {stockPageHead}
        <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-900">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
            className="w-8 h-8 border-4 border-[#ffd45a] border-t-[#ffa95a] rounded-full"
          />
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {stockPageHead}
        <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-gray-900 gap-4">
          <div className="text-red-500 text-lg">{error}</div>
          <button
            onClick={() => router.push('/')}
            className="px-4 py-2 bg-[#ffa95a] text-white rounded-lg hover:bg-[#ff9a3a] transition-colors"
          >
            返回首頁
          </button>
        </div>
      </>
    );
  }

  if (!latest) return <>{stockPageHead}</>;

  return (
    <div className="min-h-screen flex flex-col bg-gray-50/50 dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {stockPageHead}
      <SubpageHeader
        icon={TrendingUp}
        title="股海明燈"
        subtitle="個股走勢與分析"
      />
      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <StockHeader data={latest} />
        <AITrendPanel analysis={mockAiAnalysis} />

        <div className="flex items-center justify-between flex-wrap gap-4">
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
        </div>

        {chartLoading && (
          <div className="text-sm text-gray-500 dark:text-gray-400">載入圖表資料中…</div>
        )}
        {chartError && (
          <div className="text-red-500 text-sm py-2 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/80 dark:bg-red-900/20 px-4">
            {chartError}
          </div>
        )}

        {statistics && <StatisticsPanel stats={statistics} />}
        {candlestickMA && <CandlestickChart data={candlestickMA} />}
        {volumeData && <VolumeChart data={volumeData} />}
        {priceChangeData && <PriceChangeChart data={priceChangeData} />}
        {historyError && (
          <div className="text-red-500 text-sm py-2">{historyError}</div>
        )}
        {history && (
          <HistoryTable
            data={history}
            page={historyPage}
            pageSize={HISTORY_PAGE_SIZE}
            onPageChange={setHistoryPage}
          />
        )}
      </div>
    </div>
  );
}
