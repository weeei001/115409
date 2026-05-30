import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  fetchLatestPrice,
  fetchCandlestickMA,
  fetchVolume,
  fetchPriceChange,
  fetchStatistics,
  fetchHistory,
  fetchDateRange,
  fetchInstitutionalTrades,
  fetchTechnicalIndicators,
  fetchIntegratedChart,
  fetchVolumeWithChips,
} from '../api/stock';
import { mapIntegratedChartToDashboard } from '../utils/integratedChartMappers';
import type {
  DailyPriceResponse,
  CandlestickWithMAResponse,
  VolumeAnalysisResponse,
  PriceChangeResponse,
  PriceStatistics,
  HistoricalPriceList,
  ChipsVolumeChartRow,
} from '../types';
import type {
  InstitutionalTradeListResponse,
  InstitutionalTradeResponse,
  TechnicalIndicatorListResponse,
  TechnicalIndicatorResponse,
} from '../types/stockDashboard';
import { getDefaultDateRange } from '../utils/date';
import { isValidDailyPrice } from '../utils/stockValidation';
import { candlestickMaToPriceChart } from '../utils/chartAdapters';
import {
  mapInstitutionalTradesApi,
  mapInstitutionalLatestFromList,
  mapTechnicalIndicatorsApi,
  mapTechnicalLatestFromList,
} from '../utils/openapiStockMappers';
import type { PriceChartData } from '../types/priceChart';

const HISTORY_PAGE_SIZE = 30;
const DEFAULT_MA_PERIODS = '5,10,20,60';

export interface UseStockDashboardResult {
  symbol: string;
  loading: boolean;
  error: string | null;
  latest: DailyPriceResponse | null;
  startDate: string;
  endDate: string;
  setStartDate: (d: string) => void;
  setEndDate: (d: string) => void;
  maPeriods: string;
  setMaPeriods: (p: string) => void;
  chartLoading: boolean;
  chartError: string | null;
  chipsLoading: boolean;
  chipsError: string | null;
  candlestickMA: CandlestickWithMAResponse | null;
  priceChart: PriceChartData | null;
  volumeData: VolumeAnalysisResponse | null;
  priceChangeData: PriceChangeResponse | null;
  statistics: PriceStatistics | null;
  institutionalRange: InstitutionalTradeListResponse | null;
  institutionalLatest: InstitutionalTradeResponse | null;
  chipsVolumeRows: ChipsVolumeChartRow[] | null;
  indicatorsRange: TechnicalIndicatorListResponse | null;
  indicatorLatest: TechnicalIndicatorResponse | null;
  history: HistoricalPriceList | null;
  historyPage: number;
  setHistoryPage: (p: number) => void;
  historyError: string | null;
  historyPageSize: number;
  showPriceChange: boolean;
  setShowPriceChange: (v: boolean) => void;
  reloadCharts: () => void;
  reloadChips: () => void;
  widenDateRange: () => void;
}

export function useStockDashboard(symbol: string, routerReady: boolean): UseStockDashboardResult {
  const defaults = getDefaultDateRange();
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [maPeriods, setMaPeriods] = useState(DEFAULT_MA_PERIODS);
  const [showPriceChange, setShowPriceChange] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartRangeReady, setChartRangeReady] = useState(false);

  const [latest, setLatest] = useState<DailyPriceResponse | null>(null);
  const [candlestickMA, setCandlestickMA] = useState<CandlestickWithMAResponse | null>(null);
  const [volumeData, setVolumeData] = useState<VolumeAnalysisResponse | null>(null);
  const [priceChangeData, setPriceChangeData] = useState<PriceChangeResponse | null>(null);
  const [statistics, setStatistics] = useState<PriceStatistics | null>(null);
  const [institutionalRange, setInstitutionalRange] = useState<InstitutionalTradeListResponse | null>(null);
  const [institutionalLatest, setInstitutionalLatest] = useState<InstitutionalTradeResponse | null>(null);
  const [chipsVolumeRows, setChipsVolumeRows] = useState<ChipsVolumeChartRow[] | null>(null);
  const [indicatorsRange, setIndicatorsRange] = useState<TechnicalIndicatorListResponse | null>(null);
  const [indicatorLatest, setIndicatorLatest] = useState<TechnicalIndicatorResponse | null>(null);
  const [history, setHistory] = useState<HistoricalPriceList | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [chartError, setChartError] = useState<string | null>(null);
  const [chartLoading, setChartLoading] = useState(false);
  const [chipsLoading, setChipsLoading] = useState(false);
  const [chipsError, setChipsError] = useState<string | null>(null);

  const initReqIdRef = useRef(0);
  const chartReqIdRef = useRef(0);
  const chipsReqIdRef = useRef(0);
  const historyReqIdRef = useRef(0);
  const rangeFallbackRef = useRef(getDefaultDateRange());

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
    setInstitutionalRange(null);
    setInstitutionalLatest(null);
    setChipsVolumeRows(null);
    setIndicatorsRange(null);
    setIndicatorLatest(null);
    setChipsError(null);
    setHistory(null);
    setHistoryPage(1);
    setHistoryError(null);
    setChartError(null);
    chartReqIdRef.current += 1;
    chipsReqIdRef.current += 1;
    historyReqIdRef.current += 1;
    setStartDate(d.start);
    setEndDate(d.end);
    setMaPeriods(DEFAULT_MA_PERIODS);
  }, [symbol]);

  const loadChipsFallback = useCallback(async (sym: string, sd: string, ed: string) => {
    const [instResult, techResult, chipsVolResult] = await Promise.allSettled([
      fetchInstitutionalTrades(sym, sd, ed),
      fetchTechnicalIndicators(sym, sd, ed),
      fetchVolumeWithChips(sym, sd, ed),
    ]);

    if (instResult.status === 'fulfilled') {
      const mapped = mapInstitutionalTradesApi(sym, instResult.value);
      setInstitutionalRange(mapped);
      setInstitutionalLatest(mapInstitutionalLatestFromList(sym, mapped));
    } else {
      setInstitutionalRange(null);
      setInstitutionalLatest(null);
    }

    if (techResult.status === 'fulfilled') {
      const mapped = mapTechnicalIndicatorsApi(sym, techResult.value);
      setIndicatorsRange(mapped);
      setIndicatorLatest(mapTechnicalLatestFromList(sym, mapped));
    } else {
      setIndicatorsRange(null);
      setIndicatorLatest(null);
    }

    if (chipsVolResult.status === 'fulfilled') {
      setChipsVolumeRows(chipsVolResult.value.data ?? []);
    } else {
      setChipsVolumeRows(null);
    }

    if (
      instResult.status === 'rejected' &&
      techResult.status === 'rejected' &&
      chipsVolResult.status === 'rejected'
    ) {
      const msg =
        instResult.reason instanceof Error ? instResult.reason.message : '籌碼資料載入失敗';
      throw new Error(msg);
    }
  }, []);

  const loadChips = useCallback(
    async (sym: string, sd: string, ed: string) => {
      const id = ++chipsReqIdRef.current;
      setChipsError(null);
      setChipsLoading(true);
      try {
        try {
          const integrated = await fetchIntegratedChart(sym, sd, ed);
          if (id !== chipsReqIdRef.current) return;

          const slice = mapIntegratedChartToDashboard(sym, integrated);
          let indicatorsRange = slice.indicatorsRange;
          const rows = indicatorsRange?.data ?? [];
          const missingRsi = rows.length > 0 && !rows.some((r) => r.rsi10 != null || r.rsi5 != null);
          const missingBoll =
            rows.length > 0 &&
            !rows.some((r) => r.boll_mid20 != null || r.boll_upper20 != null || r.boll_lower20 != null);
          if (missingRsi || missingBoll) {
            try {
              const techApi = await fetchTechnicalIndicators(sym, sd, ed);
              indicatorsRange = mapTechnicalIndicatorsApi(sym, techApi);
            } catch {
              // 保留 integrated 部分欄位
            }
          }
          setInstitutionalRange(slice.institutionalRange);
          setInstitutionalLatest(slice.institutionalLatest);
          setIndicatorsRange(indicatorsRange);
          setIndicatorLatest(mapTechnicalLatestFromList(sym, indicatorsRange));
          setChipsVolumeRows(slice.chipsVolumeRows);
        } catch {
          if (id !== chipsReqIdRef.current) return;
          await loadChipsFallback(sym, sd, ed);
        }
      } catch (err) {
        if (id !== chipsReqIdRef.current) return;
        setInstitutionalRange(null);
        setInstitutionalLatest(null);
        setChipsVolumeRows(null);
        setIndicatorsRange(null);
        setIndicatorLatest(null);
        setChipsError(err instanceof Error ? err.message : '籌碼資料載入失敗');
      } finally {
        if (id === chipsReqIdRef.current) setChipsLoading(false);
      }
    },
    [loadChipsFallback]
  );

  const loadChartData = useCallback(
    async (sym: string, sd: string, ed: string, ma: string) => {
      const id = ++chartReqIdRef.current;
      setChartError(null);
      setChartLoading(true);
      try {
        const tasks: Promise<unknown>[] = [
          fetchCandlestickMA(sym, sd, ed, ma),
          fetchVolume(sym, sd, ed),
          fetchStatistics(sym, sd, ed),
        ];
        if (showPriceChange) {
          tasks.push(fetchPriceChange(sym, sd, ed));
        }

        const results = await Promise.allSettled(tasks);
        if (id !== chartReqIdRef.current) return;

        const kma = results[0];
        const vol = results[1];
        const stats = results[2];
        if (kma.status === 'fulfilled') setCandlestickMA(kma.value as CandlestickWithMAResponse);
        else setCandlestickMA(null);
        if (vol.status === 'fulfilled') setVolumeData(vol.value as VolumeAnalysisResponse);
        if (stats.status === 'fulfilled') setStatistics(stats.value as PriceStatistics);

        if (showPriceChange) {
          const pc = results[3];
          if (pc?.status === 'fulfilled') setPriceChangeData(pc.value as PriceChangeResponse);
        } else {
          setPriceChangeData(null);
        }

        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed === results.length) {
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
    },
    [showPriceChange]
  );

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
    if (!routerReady) return;

    const sym = symbol.trim();
    if (!sym) {
      setLoading(false);
      setError('請輸入有效的股票代號');
      setLatest(null);
      setChartRangeReady(false);
      return;
    }

    const id = ++initReqIdRef.current;
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      setError(null);
      setChartRangeReady(false);
      try {
        const latestRes = await fetchLatestPrice(sym);
        if (cancelled || id !== initReqIdRef.current) return;

        if (!isValidDailyPrice(latestRes)) {
          setLatest(null);
          setError('無法取得報價資料');
          setChartRangeReady(false);
          return;
        }
        setLatest(latestRes);

        const { start: sd0, end: ed0 } = rangeFallbackRef.current;
        let sd = sd0;
        let ed = ed0;
        try {
          const range = await fetchDateRange(sym);
          if (range.max_date) ed = range.max_date;
          const startD = new Date(ed);
          startD.setMonth(startD.getMonth() - 3);
          sd = startD.toISOString().slice(0, 10);
          if (!cancelled && id === initReqIdRef.current) {
            setStartDate(sd);
            setEndDate(ed);
          }
        } catch {
          /* defaults */
        }
        if (!cancelled && id === initReqIdRef.current) {
          setHistoryPage(1);
          setChartRangeReady(true);
        }
      } catch (err) {
        if (!cancelled && id === initReqIdRef.current) {
          setError(err instanceof Error ? err.message : '載入失敗');
          setChartRangeReady(false);
        }
      } finally {
        if (!cancelled && id === initReqIdRef.current) setLoading(false);
      }
    };

    void init();
    return () => {
      cancelled = true;
    };
  }, [symbol, routerReady]);

  useEffect(() => {
    if (!symbol || loading || !chartRangeReady) return;
    void loadChartData(symbol, startDate, endDate, maPeriods);
  }, [symbol, loading, chartRangeReady, startDate, endDate, maPeriods, showPriceChange, loadChartData]);

  useEffect(() => {
    if (!symbol || loading || !chartRangeReady) return;
    void loadChips(symbol, startDate, endDate);
  }, [symbol, loading, chartRangeReady, startDate, endDate, loadChips]);

  useEffect(() => {
    if (!symbol || loading) return;
    void loadHistory(symbol, historyPage);
  }, [historyPage, symbol, loading, loadHistory]);

  // 避免每次 render 重跑 mapper；priceChart 為下游 ECharts / lightweight-charts 的依賴，
  // reference 變動會觸發 setOption / setData，可能造成個股頁延遲。
  const priceChart = useMemo(
    () => (candlestickMA ? candlestickMaToPriceChart(candlestickMA) : null),
    [candlestickMA],
  );

  const reloadCharts = useCallback(() => {
    if (!symbol || loading || !chartRangeReady) return;
    void loadChartData(symbol, startDate, endDate, maPeriods);
  }, [symbol, loading, chartRangeReady, startDate, endDate, maPeriods, loadChartData]);

  const reloadChips = useCallback(() => {
    if (!symbol || loading || !chartRangeReady) return;
    void loadChips(symbol, startDate, endDate);
  }, [symbol, loading, chartRangeReady, startDate, endDate, loadChips]);

  const widenDateRange = useCallback(() => {
    const start = new Date(startDate);
    start.setMonth(start.getMonth() - 6);
    setStartDate(start.toISOString().slice(0, 10));
  }, [startDate]);

  return {
    symbol,
    loading,
    error,
    latest,
    startDate,
    endDate,
    setStartDate,
    setEndDate,
    maPeriods,
    setMaPeriods,
    chartLoading,
    chartError,
    chipsLoading,
    chipsError,
    candlestickMA,
    priceChart,
    volumeData,
    priceChangeData,
    statistics,
    institutionalRange,
    institutionalLatest,
    chipsVolumeRows,
    indicatorsRange,
    indicatorLatest,
    history,
    historyPage,
    setHistoryPage,
    historyError,
    historyPageSize: HISTORY_PAGE_SIZE,
    showPriceChange,
    setShowPriceChange,
    reloadCharts,
    reloadChips,
    widenDateRange,
  };
}
