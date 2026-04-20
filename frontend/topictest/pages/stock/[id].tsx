import React, { useEffect, useLayoutEffect, useState, useCallback, useRef } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';
import { TrendingUp, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import { StockSectionNav } from '../../components/StockSectionNav';
import { AnimatedSection } from '../../components/AnimatedSection';
import { getDefaultDateRange } from '../../lib/utils/date';
import { isValidDailyPrice } from '../../lib/utils/stockValidation';

const HISTORY_PAGE_SIZE = 30;

const sectionClass = 'scroll-mt-[9.5rem]';

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
  /** init 與 fetchDateRange 失敗時的後備區間，不依賴可能過期的 startDate/endDate 閉包 */
  const rangeFallbackRef = useRef(getDefaultDateRange());
  /** 換股後須等 init 寫入日期再載入圖表，避免 loading 結束與 setStartDate 各觸發一次圖表請求 */
  const [chartRangeReady, setChartRangeReady] = useState(false);

  /** 換股或初次有 symbol 時同步清空，避免 client 導航時短暫顯示上一檔股票資料 */
  useLayoutEffect(() => {
    if (!symbol) return;
    const d = getDefaultDateRange();
    rangeFallbackRef.current = d;
    setChartRangeReady(false);
    setLoading(true);
    setError(null);
    setLatest(null);
    setCandlestickMA(null);
    setVolumeData(null);
    setPriceChangeData(null);
    setStatistics(null);
    setHistory(null);
    setHistoryPage(1);
    setHistoryError(null);
    setChartError(null);
    chartReqIdRef.current += 1;
    historyReqIdRef.current += 1;
    setStartDate(d.start);
    setEndDate(d.end);
  }, [symbol]);

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
        toast.error(msg);
      }
    } catch (err) {
      if (id !== chartReqIdRef.current) return;
      const msg = err instanceof Error ? err.message : '圖表資料載入失敗';
      setChartError(msg);
      toast.error(msg);
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
      const msg = err instanceof Error ? err.message : '無法載入歷史資料';
      setHistoryError(msg);
      toast.error(msg);
      setHistory(null);
    }
  }, []);

  useEffect(() => {
    if (!router.isReady || !symbol) return;

    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      setChartRangeReady(false);
      try {
        const latestRes = await fetchLatestPrice(symbol);
        if (cancelled) return;

        if (!isValidDailyPrice(latestRes)) {
          if (!cancelled) {
            setLatest(null);
            setError('無法取得報價資料');
            setChartRangeReady(false);
          }
          return;
        }
        setLatest(latestRes);

        const { start: sd0, end: ed0 } = rangeFallbackRef.current;
        let sd = sd0;
        let ed = ed0;
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
          /* use rangeFallbackRef defaults */
        }
        if (!cancelled) {
          setHistoryPage(1);
          setChartRangeReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '載入失敗');
          setChartRangeReady(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [symbol, router.isReady]);

  useEffect(() => {
    if (!symbol || loading || !chartRangeReady) return;
    loadChartData(symbol, startDate, endDate);
  }, [symbol, loading, chartRangeReady, startDate, endDate, loadChartData]);

  useEffect(() => {
    if (!symbol || loading) return;
    void loadHistory(symbol, historyPage);
  }, [historyPage, symbol, loading, loadHistory]);

  const stockTitle = symbol ? `股海明燈｜${symbol} 個股分析` : '股海明燈｜個股分析';
  const stockDesc = symbol
    ? `查詢 ${symbol} 即時股價、K 線、成交量、漲跌幅與歷史行情（展示／專題用途）。`
    : '個股走勢、技術線圖與歷史行情分析（展示／專題用途）。';
  const stockPageHead = (
    <Head>
      <title>{stockTitle}</title>
      <meta name="description" content={stockDesc} />
      <meta property="og:title" content={stockTitle} />
      <meta property="og:description" content={stockDesc} />
      <meta property="og:type" content="article" />
      <meta name="twitter:card" content="summary" />
      <meta name="twitter:title" content={stockTitle} />
      <meta name="twitter:description" content={stockDesc} />
    </Head>
  );

  if (loading) {
    return (
      <>
        {stockPageHead}
        <div className="min-h-screen flex items-center justify-center" role="status" aria-live="polite">
          <Loader2 size={40} className="text-brand animate-spin" aria-hidden="true" />
          <span className="sr-only">載入中...</span>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        {stockPageHead}
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
          <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up max-w-md text-center">
            {error}
          </div>
          <button
            onClick={() => router.push('/')}
            className="px-5 py-2.5 rounded-xl text-white font-semibold shadow-lg transition-all cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            返回首頁
          </button>
        </div>
      </>
    );
  }

  if (!latest) {
    return (
      <>
        {stockPageHead}
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
          <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up max-w-md text-center">
            無法取得報價資料
          </div>
          <button
            type="button"
            onClick={() => router.push('/')}
            className="px-5 py-2.5 rounded-xl text-white font-semibold shadow-lg transition-all cursor-pointer"
            style={{ background: 'var(--brand-gradient)' }}
          >
            返回首頁
          </button>
        </div>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col text-[var(--color-text-primary)]">
      {stockPageHead}
      <SubpageHeader
        icon={TrendingUp}
        title="股海明燈"
        subtitle="個股走勢與分析"
      />
      <div className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
        <StockSectionNav />

        <AnimatedSection preset="fadeUp" delay={0.05}>
          <section id="stock-overview" className={sectionClass}>
            <StockHeader data={latest} />
          </section>
        </AnimatedSection>

        <AnimatedSection preset="fadeUp" delay={0.1}>
          <section id="ai-trend" className={sectionClass}>
            <AITrendPanel analysis={mockAiAnalysis} sourcesSectionTitle="示範引用來源" />
          </section>
        </AnimatedSection>

        <AnimatedSection preset="fadeIn" delay={0.05}>
          <section id="date-range" className={sectionClass}>
            <div className="flex items-center justify-between flex-wrap gap-4">
              <DateRangePicker
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
              />
            </div>
          </section>
        </AnimatedSection>

        {chartLoading && (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-muted)]">
            <Loader2 size={16} className="animate-spin text-brand" />
            載入圖表資料中…
          </div>
        )}
        {chartError && (
          <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up">
            {chartError}
          </div>
        )}

        <AnimatedSection preset="fadeUp" delay={0.05}>
          <section id="statistics" className={sectionClass}>
            {statistics && <StatisticsPanel stats={statistics} />}
          </section>
        </AnimatedSection>

        <AnimatedSection preset="scaleIn" delay={0.05}>
          <section id="candlestick" className={sectionClass}>
            {candlestickMA && <CandlestickChart data={candlestickMA} />}
          </section>
        </AnimatedSection>

        <AnimatedSection preset="scaleIn" delay={0.05}>
          <section id="volume" className={sectionClass}>
            {volumeData && <VolumeChart data={volumeData} />}
          </section>
        </AnimatedSection>

        <AnimatedSection preset="scaleIn" delay={0.05}>
          <section id="price-change" className={sectionClass}>
            {priceChangeData && <PriceChangeChart data={priceChangeData} />}
          </section>
        </AnimatedSection>

        {historyError && (
          <div className="px-4 py-3 rounded-xl bg-up-muted border border-up/20 text-sm text-up">
            {historyError}
          </div>
        )}

        <AnimatedSection preset="fadeUp" delay={0.05}>
          <section id="history" className={sectionClass}>
            {history && (
              <HistoryTable
                data={history}
                page={historyPage}
                pageSize={HISTORY_PAGE_SIZE}
                onPageChange={setHistoryPage}
              />
            )}
          </section>
        </AnimatedSection>
      </div>
    </div>
  );
}
