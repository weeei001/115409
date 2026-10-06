import { parseBulkSymbolInput } from '@/lib/utils/stockSelection';

/**
 * 多股比較的網址參數（P1-26、03-F16）：`/compare?s=2330,2317&from=2026-07-06&to=2026-10-05`。
 * 寫的是「上一次按下開始比較」的條件；上一頁、重新整理、分享連結都能重現同一組比較。
 * 頁首與首頁搜尋貼上多個代號時，也用這個網址帶進比較頁（P2-062）。
 */
export const COMPARE_SYMBOLS_PARAM = 's';
export const COMPARE_FROM_PARAM = 'from';
export const COMPARE_TO_PARAM = 'to';

/** 網址最多帶幾檔（避免貼上超長字串時一次打出大量請求） */
export const COMPARE_URL_MAX_SYMBOLS = 30;

export interface CompareQuery {
  symbols: string[];
  startDate: string | null;
  endDate: string | null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !DATE.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return null;
  // 2026-02-31 之類會被 Date 進位成別天：轉回字串比對
  return new Date(time).toISOString().slice(0, 10) === value ? value : null;
}

const first = (value: unknown): unknown => (Array.isArray(value) ? value[0] : value);

/**
 * 讀網址參數：代號去重、轉大寫，只留 knownSymbols 裡有的（清單還沒載入時傳 null，先不過濾）。
 * 日期要兩個都合法、而且起日不晚於迄日才採用，否則用頁面預設的期間。沒有代號就回 null。
 */
export function parseCompareQuery(query: Record<string, unknown>, knownSymbols: readonly string[] | null = null): CompareQuery | null {
  const raw = first(query[COMPARE_SYMBOLS_PARAM]);
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 1000) return null;
  const known = knownSymbols ? new Set(knownSymbols.map((symbol) => symbol.toUpperCase())) : null;
  const symbols: string[] = [];
  for (const symbol of parseBulkSymbolInput(raw)) {
    // 比較網址收英數 1–10 碼（比 isTaiwanStockCode 寬），有 knownSymbols 時再篩成清單裡有的代號
    if (!/^[0-9A-Z]{1,10}$/.test(symbol) || symbols.includes(symbol)) continue;
    if (known && !known.has(symbol)) continue;
    symbols.push(symbol);
    if (symbols.length >= COMPARE_URL_MAX_SYMBOLS) break;
  }
  if (!symbols.length) return null;
  const start = validDate(first(query[COMPARE_FROM_PARAM]));
  const end = validDate(first(query[COMPARE_TO_PARAM]));
  const rangeOk = start !== null && end !== null && start <= end;
  return { symbols, startDate: rangeOk ? start : null, endDate: rangeOk ? end : null };
}

/** 比較頁網址；不帶期間時用比較頁的預設期間 */
export function compareHref(symbols: readonly string[], range?: { startDate: string; endDate: string } | null): string {
  const params = new URLSearchParams();
  params.set(COMPARE_SYMBOLS_PARAM, symbols.join(','));
  if (range) {
    params.set(COMPARE_FROM_PARAM, range.startDate);
    params.set(COMPARE_TO_PARAM, range.endDate);
  }
  // 逗號不必編碼，網址比較好讀
  return `/compare?${params.toString().replace(/%2C/gi, ',')}`;
}

/**
 * 頁首、首頁搜尋按 Enter 或貼上多個代號：
 * 有效代號 2 檔以上就到比較頁並帶入全部；只有 1 檔就開個股頁；都無效回 null（P2-062、04-U4）。
 */
export function bulkSearchTarget(input: string, knownSymbols: readonly string[]): string | null {
  const known = new Set(knownSymbols.map((symbol) => symbol.toUpperCase()));
  const symbols = [...new Set(parseBulkSymbolInput(input))].filter((symbol) => known.has(symbol));
  if (symbols.length === 0) return null;
  if (symbols.length === 1) return `/stock/${symbols[0]}`;
  return compareHref(symbols.slice(0, COMPARE_URL_MAX_SYMBOLS));
}
