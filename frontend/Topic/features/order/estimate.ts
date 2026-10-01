import type { HistoricalPriceList } from '../../lib/types/api';

export type OrderEstimateState =
  | { kind: 'unavailable'; reason: string }
  | { kind: 'loading' }
  | { kind: 'estimate'; price: string; date: string; lots: number; shares: number; amount: number };

export function orderEstimateInput(symbol: string, date: string, quantity: string, today: string): { reason: string } | { symbol: string; date: string; lots: number } {
  if (!symbol) return { reason: '請輸入股票代號與正整數張數，以查詢收盤估值。' };
  if (symbol.length > 12 || !/^[0-9A-Z.]+$/.test(symbol)) return { reason: '股票代號格式不正確，無法估算。' };
  const lots = Number(quantity);
  if (!/^\d+$/.test(quantity) || !Number.isSafeInteger(lots) || lots <= 0 || !Number.isSafeInteger(lots * 1000)) {
    return { reason: '請輸入可估算的正整數張數（每張 1,000 股）。' };
  }
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date > today) {
    return { reason: '請選擇有效且不晚於今日的模擬下單日。' };
  }
  return { symbol, date, lots };
}

/** Same close × integer lots × 1,000 and positive ROUND_HALF_UP as orders.service. */
export function estimateAmount(price: string, lots: number): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!match || price.length > 40 || !Number.isSafeInteger(lots) || lots <= 0) return null;
  const decimals = match[2] ?? '';
  const divisor = BigInt(10) ** BigInt(decimals.length);
  const numerator = BigInt(match[1] + decimals) * BigInt(lots) * BigInt(1000);
  if (numerator <= BigInt(0)) return null;
  const rounded = (numerator * BigInt(2) + divisor) / (divisor * BigInt(2));
  return rounded <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(rounded) : null;
}

export function estimateFromHistory(history: HistoricalPriceList, symbol: string, date: string, lots: number, today: string): OrderEstimateState {
  const row = history.data?.find((item) => item.symbol === symbol && item.date === date);
  if (!row || row.close === null) return { kind: 'unavailable', reason: date === today
    ? '今日尚無可用收盤行情，可能尚未收盤、非交易日或資料尚未匯入，目前無法估算。'
    : '指定日無可用收盤行情，可能為非交易日、無此代號或資料尚未匯入；不會改用其他日期價格。' };
  const amount = typeof row.close === 'string' ? estimateAmount(row.close, lots) : null;
  if (amount === null) return { kind: 'unavailable', reason: '收盤價格或估算金額不在可用範圍，目前無法估算。' };
  return { kind: 'estimate', price: row.close!, date: row.date, lots, shares: lots * 1000, amount };
}
