import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchCandlestickMA,
  fetchDateRange,
  fetchHistory,
  fetchInstitutionalTrades,
  fetchLatestPrice,
  fetchPriceChange,
  fetchStatistics,
  fetchTechnicalIndicators,
  fetchVolume,
  fetchVolumeWithChips,
} from '../api/stock';
import {
  candlestickMaToPriceChart,
  lastItem,
  mapInstitutionalTrades,
  mapTechnicalIndicators,
  toDailyQuote,
  toPriceStats,
} from '../mappers/stock';
import type {
  CandlestickWithMAResponse,
  ChipsVolumeData,
  HistoricalPriceList,
  PriceChangeResponse,
  VolumeAnalysisResponse,
} from '../types/api';
import type { DailyQuote, InstitutionalDay, PriceStats, TechnicalDay } from '../types/view';
import { getDefaultDateRange, shiftYmdMonths } from '../utils/date';
import { isValidDailyPrice } from '../utils/stockValidation';
import { buildVolumeInsight, type VolumeInsight } from '../charts/volumeInsight';

export const HISTORY_PAGE_SIZE = 30;
export const DEFAULT_MA_PERIODS = '5,10,20,60';
export const isStockSymbol = (sym: string): boolean => /^\d{4,6}$/.test(sym.trim());

const errorMessage = (reason: unknown, fallback: string) => (reason instanceof Error ? reason.message : fallback);

export interface HistoryPage {
  total: number;
  rows: DailyQuote[];
}

export function useStockDashboard(symbol: string) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  /** AI 分析基準日：固定為資料最後一天，不跟著圖表結束日變動（決議 D9-c20） */
  const [baseDate, setBaseDate] = useState<string | null>(null);
  const [maPeriods, setMaPeriods] = useState(DEFAULT_MA_PERIODS);
  const [showPriceChange, setShowPriceChange] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rangeReady, setRangeReady] = useState(false);
  const [latest, setLatest] = useState<DailyQuote | null>(null);

  const [candlestickMA, setCandlestickMA] = useState<CandlestickWithMAResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeAnalysisResponse | null>(null);
  const [volumeInsight, setVolumeInsight] = useState<VolumeInsight | null>(null);
  const [priceChangeData, setPriceChangeData] = useState<PriceChangeResponse | null>(null);
  const [statistics, setStatistics] = useState<PriceStats | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  const [institutional, setInstitutional] = useState<InstitutionalDay[] | null>(null);
  const [indicators, setIndicators] = useState<TechnicalDay[] | null>(null);
  const [chipsVolume, setChipsVolume] = useState<ChipsVolumeData[] | null>(null);
  const [chipsLoading, setChipsLoading] = useState(false);
  const [chipsError, setChipsError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const initReq = useRef(0);
  const chartReq = useRef(0);
  const chipsReq = useRef(0);
  const historyReq = useRef(0);

  // 換股票：清空所有資料，避免短暫顯示上一檔
  useLayoutEffect(() => {
    const d = getDefaultDateRange();
    setRangeReady(false);
    setLoading(isStockSymbol(symbol));
    setError(null);
    setLatest(null);
    setBaseDate(null);
    setCandlestickMA(null);
    setVolumeData(null);
    setVolumeInsight(null);
    setPriceChangeData(null);
    setStatistics(null);
    setChartError(null);
    setInstitutional(null);
    setIndicators(null);
    setChipsVolume(null);
    setChipsError(null);
    setHistory(null);
    setHistoryPage(1);
    setHistoryError(null);
    chartReq.current += 1;
    chipsReq.current += 1;
    historyReq.current += 1;
    setStartDate(d.start);
    setEndDate(d.end);
    setMaPeriods(DEFAULT_MA_PERIODS);
  }, [symbol]);

  useEffect(() => {
    const sym = symbol.trim();
    if (!isStockSymbol(sym)) {
      setLoading(false);
      setError(sym ? '請輸入有效的股票代號' : null);
      return;
    }
    const id = ++initReq.current;
    let cancelled = false;
    const alive = () => !cancelled && id === initReq.current;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const raw = await fetchLatestPrice(sym);
        if (!alive()) return;
        if (!isValidDailyPrice(raw)) {
          setError('無法取得報價資料');
          return;
        }
        setLatest(toDailyQuote(raw));

        const fallback = getDefaultDateRange();
        let sd = fallback.start;
        let ed = fallback.end;
        try {
          const range = await fetchDateRange(sym);
          if (range.max_date) {
            ed = range.max_date;
            sd = shiftYmdMonths(ed, -3);
          }
        } catch {
          /* 取不到可用區間就用今天往前 3 個月 */
        }
        if (!alive()) return;
        setStartDate(sd);
        setEndDate(ed);
        setBaseDate(ed);
        setHistoryPage(1);
        setRangeReady(true);
      } catch (err) {
        if (alive()) setError(errorMessage(err, '載入失敗'));
      } finally {
        if (alive()) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol]);

  const loadChart = useCallback(async (sym: string, sd: string, ed: string, ma: string, withChange: boolean) => {
    const id = ++chartReq.current;
    setChartError(null);
    setChartLoading(true);
    setVolumeInsight(null);
    try {
      const tasks: Promise<unknown>[] = [
        fetchCandlestickMA(sym, sd, ed, ma),
        fetchVolume(sym, sd, ed),
        fetchStatistics(sym, sd, ed),
        fetchHistory(sym, { end_date: ed, limit: 60 }),
      ];
      if (withChange) tasks.push(fetchPriceChange(sym, sd, ed));
      const [kma, vol, stats, volumeHistory, change] = await Promise.allSettled(tasks);
      if (id !== chartReq.current) return;

      setCandlestickMA(kma.status === 'fulfilled' ? (kma.value as CandlestickWithMAResponse) : null);
      setVolumeInsight(volumeHistory.status === 'fulfilled'
        ? buildVolumeInsight((volumeHistory.value as HistoricalPriceList).data, ed) : null);
      if (vol.status === 'fulfilled') setVolumeData(vol.value as VolumeAnalysisResponse);
      if (stats.status === 'fulfilled') setStatistics(toPriceStats(stats.value as Parameters<typeof toPriceStats>[0]));
      if (!withChange) setPriceChangeData(null);
      else if (change?.status === 'fulfilled') setPriceChangeData(change.value as PriceChangeResponse);

      const results = [kma, vol, stats, volumeHistory, change].filter(Boolean) as PromiseSettledResult<unknown>[];
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length === results.length) {
        const msg = errorMessage(rejected[0]?.reason, '圖表資料載入失敗');
        setChartError(msg);
        toast.error(msg);
      }
    } finally {
      if (id === chartReq.current) setChartLoading(false);
    }
  }, []);

  /** 籌碼與指標：三支有型別的端點各自成功就各自顯示，全部失敗才算錯誤（決議 D3） */
  const loadChips = useCallback(async (sym: string, sd: string, ed: string) => {
    const id = ++chipsReq.current;
    setChipsError(null);
    setChipsLoading(true);
    try {
      const [inst, tech, chips] = await Promise.allSettled([
        fetchInstitutionalTrades(sym, sd, ed),
        fetchTechnicalIndicators(sym, sd, ed),
        fetchVolumeWithChips(sym, sd, ed),
      ]);
      if (id !== chipsReq.current) return;
      setInstitutional(inst.status === 'fulfilled' ? mapInstitutionalTrades(inst.value) : null);
      setIndicators(tech.status === 'fulfilled' ? mapTechnicalIndicators(tech.value) : null);
      setChipsVolume(chips.status === 'fulfilled' ? chips.value.data ?? [] : null);
      if (inst.status === 'rejected' && tech.status === 'rejected' && chips.status === 'rejected') {
        setChipsError(errorMessage(inst.reason, '籌碼資料載入失敗'));
      }
    } finally {
      if (id === chipsReq.current) setChipsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (sym: string, page: number) => {
    const id = ++historyReq.current;
    setHistoryError(null);
    try {
      const res = await fetchHistory(sym, { skip: (page - 1) * HISTORY_PAGE_SIZE, limit: HISTORY_PAGE_SIZE });
      if (id !== historyReq.current) return;
      setHistory({ total: res.total, rows: (res.data ?? []).map(toDailyQuote) });
    } catch (err) {
      if (id !== historyReq.current) return;
      const msg = errorMessage(err, '無法載入歷史資料');
      setHistoryError(msg);
      toast.error(msg);
      setHistory(null);
    }
  }, []);

  const ready = isStockSymbol(symbol) && !loading && rangeReady;

  useEffect(() => {
    if (ready) void loadChart(symbol, startDate, endDate, maPeriods, showPriceChange);
    return () => { chartReq.current += 1; };
  }, [ready, symbol, startDate, endDate, maPeriods, showPriceChange, loadChart]);

  useEffect(() => {
    if (ready) void loadChips(symbol, startDate, endDate);
  }, [ready, symbol, startDate, endDate, loadChips]);

  useEffect(() => {
    if (isStockSymbol(symbol) && !loading) void loadHistory(symbol, historyPage);
  }, [symbol, loading, historyPage, loadHistory]);

  const priceChart = useMemo(() => (candlestickMA ? candlestickMaToPriceChart(candlestickMA) : null), [candlestickMA]);

  const reloadCharts = useCallback(() => {
    if (ready) void loadChart(symbol, startDate, endDate, maPeriods, showPriceChange);
  }, [ready, symbol, startDate, endDate, maPeriods, showPriceChange, loadChart]);

  const reloadChips = useCallback(() => {
    if (ready) void loadChips(symbol, startDate, endDate);
  }, [ready, symbol, startDate, endDate, loadChips]);

  const widenDateRange = useCallback(() => setStartDate((start) => shiftYmdMonths(start, -6)), []);

  return {
    symbol,
    loading,
    error,
    latest,
    baseDate,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    maPeriods,
    setMaPeriods,
    showPriceChange,
    setShowPriceChange,
    chartLoading,
    chartError,
    priceChart,
    volumeData,
    volumeInsight,
    priceChangeData,
    statistics,
    chipsLoading,
    chipsError,
    institutional,
    institutionalLatest: lastItem(institutional),
    indicators,
    indicatorLatest: lastItem(indicators),
    chipsVolume,
    history,
    historyPage,
    setHistoryPage,
    historyError,
    historyPageSize: HISTORY_PAGE_SIZE,
    reloadCharts,
    reloadChips,
    widenDateRange,
  };
}

export type UseStockDashboardResult = ReturnType<typeof useStockDashboard>;
