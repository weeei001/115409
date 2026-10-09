import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
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
import { ApiRequestError } from '../api/client';
import { userFacingMessage } from '../api/errorDetail';
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
import { isTaiwanStockCode, isValidDailyPrice } from '../utils/stockValidation';
import { buildVolumeInsight, type VolumeInsight } from '../charts/volumeInsight';

export const HISTORY_PAGE_SIZE = 30;
export const DEFAULT_MA_PERIODS = '5,10,20,60';


/**
 * 報價載入失敗的種類（P1-17）：後端 404 是「沒有儲存這個代號的價格資料」，重試沒有用，改給搜尋；
 * 其餘（5xx、逾時、斷線沒有 status、回傳的價格資料不合法）都可以重試
 */
export type StockLoadErrorKind = 'not-found' | 'retryable';
export const stockLoadErrorKind = (reason: unknown): StockLoadErrorKind =>
  reason instanceof ApiRequestError && reason.status === 404 ? 'not-found' : 'retryable';

/** 個股頁的期間快選，和首頁觀測台同一組（useTerminalData 的 CHART_RANGES）；K 線、法人、指標都跟著同一段期間（04-S3） */
export const STOCK_RANGE_PRESETS = [
  { key: '3M', label: '3 個月', months: 3 },
  { key: '6M', label: '6 個月', months: 6 },
  { key: '1Y', label: '1 年', months: 12 },
] as const;
export type StockRangePresetKey = (typeof STOCK_RANGE_PRESETS)[number]['key'];

/** 目前的起訖日剛好是哪一個快選（以資料最後一天為結束日往前推）；自訂區間回傳 null */
export function stockRangePreset(startDate: string, endDate: string, baseDate: string | null): StockRangePresetKey | null {
  if (!baseDate || endDate !== baseDate) return null;
  return STOCK_RANGE_PRESETS.find((p) => shiftYmdMonths(baseDate, -p.months) === startDate)?.key ?? null;
}

export interface HistoryPage {
  total: number;
  rows: DailyQuote[];
}

export function useStockDashboard(symbol: string) {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDateValue] = useState(defaults.start);
  const [endDate, setEndDateValue] = useState(defaults.end);
  /** 資料最後一天：區間預設與 AI 卡片的日期標示用，不跟著圖表結束日變動（AI 簡報請求已不帶 as_of_date，見決議 D9） */
  const [baseDate, setBaseDate] = useState<string | null>(null);
  const [maPeriods, setMaPeriods] = useState(DEFAULT_MA_PERIODS);
  const [showPriceChange, setShowPriceChange] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<StockLoadErrorKind | null>(null);
  /** 報價載入失敗時按「重試」加一，重跑下面的初次載入 */
  const [loadAttempt, setLoadAttempt] = useState(0);
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
  /** 三支端點各自的錯誤：只有一支失敗時，那一塊要顯示錯誤與重試，不是「沒有資料」 */
  const [institutionalError, setInstitutionalError] = useState<string | null>(null);
  const [indicatorsError, setIndicatorsError] = useState<string | null>(null);
  const [chipsVolumeError, setChipsVolumeError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryPage | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const initReq = useRef(0);
  const chartReq = useRef(0);
  const chipsReq = useRef(0);
  const historyReq = useRef(0);
  const historyRange = useRef('');

  const setStartDate = useCallback((value: SetStateAction<string>) => {
    setHistoryPage(1);
    setStartDateValue(value);
  }, []);
  const setEndDate = useCallback((value: SetStateAction<string>) => {
    setHistoryPage(1);
    setEndDateValue(value);
  }, []);

  // 換股票：清空所有資料，避免短暫顯示上一檔
  useLayoutEffect(() => {
    const d = getDefaultDateRange();
    setRangeReady(false);
    setLoading(isTaiwanStockCode(symbol.trim()));
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
    setInstitutionalError(null);
    setIndicatorsError(null);
    setChipsVolumeError(null);
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
    if (!isTaiwanStockCode(sym)) {
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
      setErrorKind(null);
      try {
        const raw = await fetchLatestPrice(sym);
        if (!alive()) return;
        if (!isValidDailyPrice(raw)) {
          setError('無法取得報價資料');
          setErrorKind('retryable');
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
        if (alive()) {
          setError(userFacingMessage(err, '載入失敗'));
          setErrorKind(stockLoadErrorKind(err));
        }
      } finally {
        if (alive()) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, loadAttempt]);

  const retry = useCallback(() => setLoadAttempt((n) => n + 1), []);

  const loadChart = useCallback(async (sym: string, sd: string, ed: string, ma: string, withChange: boolean) => {
    const id = ++chartReq.current;
    setChartError(null);
    setChartLoading(true);
    setCandlestickMA(null);
    setVolumeData(null);
    setVolumeInsight(null);
    setPriceChangeData(null);
    setStatistics(null);
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
      setVolumeData(vol.status === 'fulfilled' ? vol.value as VolumeAnalysisResponse : null);
      setStatistics(stats.status === 'fulfilled' ? toPriceStats(stats.value as Parameters<typeof toPriceStats>[0]) : null);
      setPriceChangeData(withChange && change?.status === 'fulfilled' ? change.value as PriceChangeResponse : null);

      const results = [kma, vol, stats, volumeHistory, change].filter(Boolean) as PromiseSettledResult<unknown>[];
      const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (rejected.length === results.length) {
        const msg = userFacingMessage(rejected[0]?.reason, '圖表資料載入失敗');
        setChartError(msg);
        toast.error(msg);
      }
    } finally {
      if (id === chartReq.current) setChartLoading(false);
    }
  }, []);

  /** 籌碼與指標：三支有型別的端點各自成功就各自顯示，失敗的那一支各自記錯誤（決議 D3） */
  const loadChips = useCallback(async (sym: string, sd: string, ed: string) => {
    const id = ++chipsReq.current;
    setInstitutionalError(null);
    setIndicatorsError(null);
    setChipsVolumeError(null);
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
      setInstitutionalError(inst.status === 'rejected' ? userFacingMessage(inst.reason, '法人資料載入失敗') : null);
      setIndicatorsError(tech.status === 'rejected' ? userFacingMessage(tech.reason, '技術指標載入失敗') : null);
      setChipsVolumeError(chips.status === 'rejected' ? userFacingMessage(chips.reason, '價量籌碼資料載入失敗') : null);
    } finally {
      if (id === chipsReq.current) setChipsLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async (sym: string, sd: string, ed: string, page: number) => {
    const id = ++historyReq.current;
    setHistoryError(null);
    setHistoryLoading(true);
    try {
      const res = await fetchHistory(sym, { start_date: sd, end_date: ed, skip: (page - 1) * HISTORY_PAGE_SIZE, limit: HISTORY_PAGE_SIZE });
      if (id !== historyReq.current) return;
      setHistory({ total: res.total, rows: (res.data ?? []).map(toDailyQuote) });
    } catch (err) {
      if (id !== historyReq.current) return;
      const msg = userFacingMessage(err, '無法載入歷史資料');
      setHistoryError(msg);
      toast.error(msg);
      setHistory((previous) => previous ? { total: previous.total, rows: [] } : null);
    } finally {
      if (id === historyReq.current) setHistoryLoading(false);
    }
  }, []);

  const ready = isTaiwanStockCode(symbol.trim()) && !loading && rangeReady;

  // A new query must not paint statistics or details from the previous range.
  useLayoutEffect(() => {
    chartReq.current += 1;
    setCandlestickMA(null);
    setVolumeData(null);
    setVolumeInsight(null);
    setPriceChangeData(null);
    setStatistics(null);
    setChartError(null);
    setChartLoading(ready);
  }, [ready, symbol, startDate, endDate, maPeriods, showPriceChange]);

  // Clear the previous range/page before painting and reject its late response.
  useLayoutEffect(() => {
    historyReq.current += 1;
    const range = JSON.stringify([ready, symbol, startDate, endDate]);
    const sameRange = range === historyRange.current;
    historyRange.current = range;
    // Keep only the count when paging so controls and the expanded table stay mounted.
    setHistory((previous) => sameRange && previous ? { total: previous.total, rows: [] } : null);
    setHistoryError(null);
    setHistoryLoading(ready);
  }, [ready, symbol, startDate, endDate, historyPage]);

  useEffect(() => {
    if (ready) void loadChart(symbol, startDate, endDate, maPeriods, showPriceChange);
    return () => { chartReq.current += 1; };
  }, [ready, symbol, startDate, endDate, maPeriods, showPriceChange, loadChart]);

  useEffect(() => {
    if (ready) void loadChips(symbol, startDate, endDate);
  }, [ready, symbol, startDate, endDate, loadChips]);

  useEffect(() => {
    if (ready) void loadHistory(symbol, startDate, endDate, historyPage);
    return () => { historyReq.current += 1; };
  }, [ready, symbol, startDate, endDate, historyPage, loadHistory]);

  const priceChart = useMemo(() => (candlestickMA ? candlestickMaToPriceChart(candlestickMA) : null), [candlestickMA]);

  const reloadCharts = useCallback(() => {
    if (ready) void loadChart(symbol, startDate, endDate, maPeriods, showPriceChange);
  }, [ready, symbol, startDate, endDate, maPeriods, showPriceChange, loadChart]);

  const reloadChips = useCallback(() => {
    if (ready) void loadChips(symbol, startDate, endDate);
  }, [ready, symbol, startDate, endDate, loadChips]);

  const widenDateRange = useCallback(() => setStartDate((start) => shiftYmdMonths(start, -6)), []);
  /** 套用期間快選：結束日固定在資料最後一天（baseDate），往前推 n 個月 */
  const applyRangePreset = useCallback(
    (key: StockRangePresetKey) => {
      const preset = STOCK_RANGE_PRESETS.find((p) => p.key === key);
      if (!preset || !baseDate) return;
      setEndDate(baseDate);
      setStartDate(shiftYmdMonths(baseDate, -preset.months));
    },
    [baseDate, setStartDate, setEndDate],
  );

  return {
    symbol,
    loading,
    error,
    errorKind,
    retry,
    latest,
    baseDate,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    rangePreset: stockRangePreset(startDate, endDate, baseDate),
    applyRangePreset,
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
    institutionalError,
    indicatorsError,
    chipsVolumeError,
    institutional,
    institutionalLatest: lastItem(institutional),
    indicators,
    indicatorLatest: lastItem(indicators),
    chipsVolume,
    history,
    historyPage,
    setHistoryPage,
    historyError,
    historyLoading,
    historyPageSize: HISTORY_PAGE_SIZE,
    reloadCharts,
    reloadChips,
    widenDateRange,
  };
}

export type UseStockDashboardResult = ReturnType<typeof useStockDashboard>;
