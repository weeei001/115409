import type { DailyPriceResponse } from '../types';

/**
 * 台股代號：4–6 位數字（2330、0050、00878）。只認已整理好的字串，不幫呼叫端 trim。
 * 個股頁、新聞頁、導覽都用這一條；API 路徑的安全檢查（lib/api/stock.ts）與多股比較網址（compareQuery.ts）另有較寬的規則。
 */
export const isTaiwanStockCode = (code: string | null | undefined): code is string =>
  typeof code === 'string' && /^\d{4,6}$/.test(code);

/** 後端若回空物件或非預期形狀，避免進入畫面後無限 loading */
export function isValidDailyPrice(data: unknown): data is DailyPriceResponse {
  if (!data || typeof data !== 'object') return false;
  const o = data as Record<string, unknown>;
  return (
    typeof o.symbol === 'string' &&
    o.symbol.length > 0 &&
    typeof o.date === 'string' &&
    o.date.length > 0
  );
}
