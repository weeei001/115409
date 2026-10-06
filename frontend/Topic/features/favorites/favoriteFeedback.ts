import { toast } from 'sonner';
import { closeSeriesFromMultiStock, fetchCloseSeries, lastCloseChange, type CloseSeries } from '@/lib/api/closeSeries';
import type { MultiStockResponse } from '@/lib/types/api';

/** 「2317 鴻海」；沒有名稱就只寫代號 */
export const favoriteLabel = (symbol: string, name?: string | null) => (name?.trim() ? `${symbol} ${name.trim()}` : symbol);

/** 取消收藏成功後的提示：「已取消收藏 2317 鴻海」＋「復原」（P2-114，用語依 05） */
export function removedMessage(symbol: string, name?: string | null): string {
  return `已取消收藏 ${favoriteLabel(symbol, name)}`;
}

export function addedMessage(symbol: string, name?: string | null): string {
  return `已加入收藏 ${favoriteLabel(symbol, name)}`;
}

/** 取消收藏後顯示可復原的提示；按「復原」就加回去（收藏日期會變成重新加入的時間） */
export function toastRemoved(symbol: string, name: string | null | undefined, undo: (symbol: string) => Promise<boolean>) {
  toast(removedMessage(symbol, name), {
    action: {
      label: '復原',
      onClick: () => {
        void undo(symbol).then((ok) => {
          if (ok) toast.success(addedMessage(symbol, name));
        });
      },
    },
  });
}

export interface FavoriteQuote {
  close: number | null;
  change: number | null;
  changePercent: number | null;
  /** 這一檔最後一筆收盤的日期 */
  date: string | null;
}

/** 每檔收盤序列 → 最後一筆收盤、與前一筆收盤的漲跌 */
function toQuotes(series: Record<string, CloseSeries>): Record<string, FavoriteQuote> {
  return Object.fromEntries(Object.entries(series).map(([symbol, s]) => [symbol, { ...lastCloseChange(s.closes), date: s.date }]));
}

/**
 * /stocks/compare/multiple 的每日收盤 → 每檔最後一筆收盤、與前一筆收盤的漲跌（P1-29）。
 * 和首頁觀測清單同一個 helper（lib/api/closeSeries）：只看這一檔有收盤的日子，不補值。
 */
export function quotesFromSeries(response: Pick<MultiStockResponse, 'symbols' | 'data'>): Record<string, FavoriteQuote> {
  return toQuotes(closeSeriesFromMultiStock(response));
}

/** 清單共同的資料日：取最新的一個；和它不同的列才另外標日期 */
export function latestQuoteDate(quotes: Record<string, FavoriteQuote>): string | null {
  const dates = Object.values(quotes).map((quote) => quote.date).filter((date): date is string => Boolean(date)).sort();
  return dates[dates.length - 1] ?? null;
}

/** 收藏清單的收盤與漲跌：每 10 檔一次請求；全部失敗才算失敗，部分失敗的那幾檔顯示 -- */
export async function fetchFavoriteQuotes(symbols: string[], start: string, end: string): Promise<Record<string, FavoriteQuote>> {
  return toQuotes(await fetchCloseSeries(symbols, start, end, 'favorite-quotes'));
}
