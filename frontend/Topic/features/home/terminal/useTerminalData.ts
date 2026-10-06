import { useCallback, useEffect, useMemo, useState } from 'react';
import { closeChange, fetchCloseSeries, lastCloseChange, type CloseSeries } from '@/lib/api/closeSeries';
import {
  fetchCandlestickMA,
  fetchInstitutionalTrades,
  fetchLatestPrice,
  fetchStatistics,
  fetchStockInfos,
  fetchTechnicalIndicators,
  fetchVolumeWithChips,
} from '@/lib/api/stock';
import { fetchBenchmarkHistory } from '@/lib/api/benchmark';
import { userFacingMessage } from '@/lib/api/errorDetail';
import { candlestickMaToPriceChart, lastItem, mapInstitutionalTrades, mapTechnicalIndicators, toDailyQuote, toPriceStats } from '@/lib/mappers/stock';
import { useFavorites } from '@/lib/favorites/FavoritesContext';
import { dedupeFetch } from '@/lib/utils/inFlight';
import { shiftYmdMonths, toYmdLocal } from '@/lib/utils/date';
import type { ChipsVolumeData, StockInfo } from '@/lib/types/api';
import type { DailyQuote, InstitutionalDay, PriceChartData, PriceStats, TechnicalDay } from '@/lib/types/view';
import type { BeaconJourneyProps } from '../journey/types';

/** idle＝還沒有東西可以抓（例如股票清單沒載入，所以沒有選中的股票） */
export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Loadable<T> {
  status: LoadStatus;
  data: T | null;
  error: string | null;
  reload: () => void;
}

export interface WatchRow {
  symbol: string;
  name: string;
  industry: string | null;
  close: number | null;
  change: number | null;
  changePercent: number | null;
  /** 這一檔最後一筆收盤的日期 */
  date: string | null;
  /** 由舊到新的收盤序列（走勢線用） */
  closes: number[];
  favorite: boolean;
}

export interface BoardData {
  close: number;
  change: number | null;
  changePercent: number | null;
  date: string;
  closes: number[];
}

export const CHART_RANGES = [
  { key: '3M', label: '3 個月', months: 3 },
  { key: '6M', label: '6 個月', months: 6 },
  { key: '1Y', label: '1 年', months: 12 },
] as const;
export type ChartRangeKey = (typeof CHART_RANGES)[number]['key'];

/** 觀測台 K 線要的均線；和圖例一致 */
export const TERMINAL_MA_PERIODS = '5,20,60';
const WATCH_LOOKBACK_MONTHS = 2;
const DETAIL_LOOKBACK_MONTHS = 3;
const CACHE_MS = 60_000;
/** 資料庫沒有收藏、也沒有這一檔時的預設選擇 */
const DEFAULT_SYMBOL = '2330';

/**
 * deps 變了就重抓；舊請求的結果會被丟掉。
 * owner 是這份資料屬於哪一檔：換了一檔就不沿用上一檔的資料（同一檔換區間時保留舊資料到新資料進來），
 * effect 還沒跑的那一次 render 也當成載入中，面板不會在新股票名稱下畫出上一檔的資料。
 */
function useLoadable<T>(fn: (() => Promise<T>) | null, deps: readonly unknown[], fallbackMessage: string, owner?: string | null): Loadable<T> {
  const [state, setState] = useState<{ status: LoadStatus; data: T | null; error: string | null; owner?: string | null }>({ status: fn ? 'loading' : 'idle', data: null, error: null, owner });
  const [attempt, setAttempt] = useState(0);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!fn) {
      setState({ status: 'idle', data: null, error: null, owner });
      return;
    }
    let active = true;
    setState((prev) => ({ status: 'loading', data: prev.owner === owner ? prev.data : null, error: null, owner }));
    fn()
      .then((data) => {
        if (active) setState({ status: 'ready', data, error: null, owner });
      })
      .catch((err) => {
        if (active) setState({ status: 'error', data: null, error: userFacingMessage(err, fallbackMessage), owner });
      });
    return () => {
      active = false;
    };
    // 依賴刻意不含 fn：fn 每次 render 都是新的函式，由呼叫端傳入的 deps 決定何時重抓
  }, [...deps, attempt]);

  if (state.owner !== owner) return { status: fn ? 'loading' : 'idle', data: null, error: null, reload };
  return { status: state.status, data: state.data, error: state.error, reload };
}

/**
 * 首頁觀測台的全部資料。只用 lib/api 現有的呼叫；每個面板各自載入、各自有載入／錯誤狀態，
 * 都是資料庫最近儲存的收盤資料，不是即時行情。
 */
export function useTerminalData() {
  const favorites = useFavorites();
  const today = useMemo(() => toYmdLocal(), []);

  const infos = useLoadable<StockInfo[]>(() => fetchStockInfos(), [], '無法載入股票清單');
  const stockInfos = useMemo(() => infos.data ?? [], [infos.data]);
  const symbolKey = stockInfos.map((s) => s.symbol).join(',');

  const industryCount = useMemo(() => {
    const set = new Set(stockInfos.map((s) => s.industry).filter((v): v is string => Boolean(v)));
    return set.size || null;
  }, [stockInfos]);

  const boardState = useLoadable<BoardData | null>(
    async () => {
      const start = shiftYmdMonths(today, -WATCH_LOOKBACK_MONTHS);
      const res = await dedupeFetch(`terminal-board ${start} ${today}`, () => fetchBenchmarkHistory(start, today), CACHE_MS);
      const closes = res.data.map((d) => d.close).filter((v) => Number.isFinite(v));
      const last = res.data[res.data.length - 1];
      if (!last) return null;
      const prev = res.data.length > 1 ? res.data[res.data.length - 2].close : null;
      return { close: last.close, ...closeChange(last.close, prev), date: last.date, closes };
    },
    [today],
    '無法載入大盤資料',
  );

  // /stocks/compare/multiple：每 10 檔一次，取多檔的每日收盤，整理成每檔一條由舊到新的序列
  const watchState = useLoadable<Record<string, CloseSeries>>(
    symbolKey ? () => fetchCloseSeries(symbolKey.split(','), shiftYmdMonths(today, -WATCH_LOOKBACK_MONTHS), today, 'terminal-watch') : null,
    [symbolKey, today],
    '觀測清單載入失敗',
  );

  const favoriteSet = useMemo(
    () => new Set(favorites.status === 'ready' ? favorites.items.map((item) => item.symbol) : []),
    [favorites.status, favorites.items],
  );

  const watchRows = useMemo<WatchRow[]>(() => {
    const series = watchState.data;
    return stockInfos.map((info) => {
      const s = series?.[info.symbol];
      return {
        symbol: info.symbol,
        name: info.name,
        industry: info.industry ?? null,
        ...lastCloseChange(s?.closes ?? []),
        date: s?.date ?? null,
        closes: s?.closes ?? [],
        favorite: favoriteSet.has(info.symbol),
      };
    });
  }, [stockInfos, watchState.data, favoriteSet]);

  /** 各檔最後收盤日不一致時要在畫面上說明 */
  const watchDates = useMemo(() => Array.from(new Set(watchRows.map((r) => r.date).filter((d): d is string => Boolean(d)))).sort(), [watchRows]);

  const [picked, setPicked] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (picked && stockInfos.some((s) => s.symbol === picked)) return picked;
    const fav = watchRows.find((r) => r.favorite);
    if (fav) return fav.symbol;
    if (stockInfos.some((s) => s.symbol === DEFAULT_SYMBOL)) return DEFAULT_SYMBOL;
    return stockInfos[0]?.symbol ?? null;
  }, [picked, stockInfos, watchRows]);
  const selectedInfo = useMemo(() => stockInfos.find((s) => s.symbol === selected) ?? null, [stockInfos, selected]);

  const [range, setRange] = useState<ChartRangeKey>('3M');
  const rangeMonths = CHART_RANGES.find((r) => r.key === range)?.months ?? 3;
  const detailStart = shiftYmdMonths(today, -DETAIL_LOOKBACK_MONTHS);

  const quote = useLoadable<DailyQuote>(selected ? async () => toDailyQuote(await fetchLatestPrice(selected)) : null, [selected], '無法載入報價', selected);
  const priceChart = useLoadable<PriceChartData | null>(
    selected
      ? async () => candlestickMaToPriceChart(await fetchCandlestickMA(selected, shiftYmdMonths(today, -rangeMonths), today, TERMINAL_MA_PERIODS))
      : null,
    [selected, rangeMonths, today],
    '無法載入 K 線資料',
    selected,
  );
  const stats = useLoadable<PriceStats>(
    selected ? async () => toPriceStats(await fetchStatistics(selected, shiftYmdMonths(today, -rangeMonths), today)) : null,
    [selected, rangeMonths, today],
    '無法載入區間統計',
    selected,
  );
  const institutional = useLoadable<InstitutionalDay | null>(
    selected ? async () => lastItem(mapInstitutionalTrades(await fetchInstitutionalTrades(selected, detailStart, today))) : null,
    [selected, detailStart, today],
    '無法載入法人資料',
    selected,
  );
  const technical = useLoadable<TechnicalDay | null>(
    selected ? async () => lastItem(mapTechnicalIndicators(await fetchTechnicalIndicators(selected, detailStart, today))) : null,
    [selected, detailStart, today],
    '無法載入技術指標',
    selected,
  );
  const chips = useLoadable<ChipsVolumeData[]>(
    selected ? async () => (await fetchVolumeWithChips(selected, detailStart, today)).data : null,
    [selected, detailStart, today],
    '無法載入量與籌碼資料',
    selected,
  );

  const board: BeaconJourneyProps['board'] = boardState.data
    ? { close: boardState.data.close, change: boardState.data.change, date: boardState.data.date }
    : null;

  const monitor = useMemo<BeaconJourneyProps['monitor']>(() => {
    const row = watchRows.find((r) => r.symbol === selected);
    if (!row || row.closes.length < 2 || !row.date) return null;
    return { symbol: row.symbol, name: row.name, closes: row.closes, date: row.date };
  }, [watchRows, selected]);

  return {
    infos,
    stockInfos,
    industryCount,
    boardState,
    board,
    watchState,
    watchRows,
    watchDates,
    selected,
    selectedInfo,
    select: setPicked,
    range,
    setRange,
    quote,
    priceChart,
    stats,
    institutional,
    technical,
    chips,
    monitor,
  };
}

export type TerminalData = ReturnType<typeof useTerminalData>;
