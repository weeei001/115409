import type { DailyPriceResponse } from '../types';

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
