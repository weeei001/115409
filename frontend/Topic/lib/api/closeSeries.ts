import type { MultiStockResponse } from '@/lib/types/api';
import { dedupeFetch } from '@/lib/utils/inFlight';
import { fetchMultipleStocks } from './stock';

/** 一檔的每日收盤：由舊到新，只收這一檔有收盤的日子（不補值） */
export interface CloseSeries {
  closes: number[];
  /** 這一檔最後一筆收盤的日期 */
  date: string | null;
}

/** 收盤與前一筆收盤的漲跌 */
export interface CloseChange {
  change: number | null;
  changePercent: number | null;
}

/** 每次 /stocks/compare/multiple 最多帶幾檔 */
export const CLOSE_SERIES_BATCH = 10;
const CACHE_MS = 60_000;

/** 漲跌與漲跌幅；缺任一邊就是 null，前一筆收盤為 0 時不算漲跌幅 */
export function closeChange(close: number | null, prev: number | null): CloseChange {
  const change = close != null && prev != null ? close - prev : null;
  return { change, changePercent: change != null && prev ? (change / prev) * 100 : null };
}

/** 序列的最後一筆收盤，以及與前一筆收盤的漲跌（首頁觀測清單、收藏清單，P1-29） */
export function lastCloseChange(closes: number[]): CloseChange & { close: number | null } {
  const n = closes.length;
  const close = n ? closes[n - 1] : null;
  const prev = n > 1 ? closes[n - 2] : null;
  return { close, ...closeChange(close, prev) };
}

/** /stocks/compare/multiple 的每日收盤 → 每檔一條由舊到新的收盤序列 */
export function closeSeriesFromMultiStock(response: Pick<MultiStockResponse, 'symbols' | 'data'>): Record<string, CloseSeries> {
  const days = [...response.data].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out: Record<string, CloseSeries> = {};
  for (const symbol of response.symbols) {
    const series: CloseSeries = { closes: [], date: null };
    for (const day of days) {
      const price = day.prices[symbol];
      if (price == null || !Number.isFinite(price)) continue;
      series.closes.push(price);
      series.date = day.date;
    }
    out[symbol] = series;
  }
  return out;
}

/**
 * 多檔的每日收盤序列：每 10 檔一次 /stocks/compare/multiple（同一組請求 60 秒內共用結果）。
 * 全部批次都失敗才丟出第一個錯誤；部分失敗時，失敗那幾批的股票不在結果裡（畫面顯示 --）。
 * cacheKey 區分呼叫端（首頁觀測台、收藏清單各自快取）。
 */
export async function fetchCloseSeries(symbols: string[], start: string, end: string, cacheKey: string): Promise<Record<string, CloseSeries>> {
  const groups: string[][] = [];
  for (let i = 0; i < symbols.length; i += CLOSE_SERIES_BATCH) groups.push(symbols.slice(i, i + CLOSE_SERIES_BATCH));
  const results = await Promise.allSettled(
    groups.map((group) => dedupeFetch(`${cacheKey} ${group.join(',')} ${start} ${end}`, () => fetchMultipleStocks(group.join(','), start, end), CACHE_MS)),
  );
  if (results.length && results.every((result) => result.status === 'rejected')) throw (results[0] as PromiseRejectedResult).reason;
  return Object.assign({}, ...results.map((result) => (result.status === 'fulfilled' ? closeSeriesFromMultiStock(result.value) : {})));
}
