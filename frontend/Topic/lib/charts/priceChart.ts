import type { BusinessDay, CandlestickData, Time } from 'lightweight-charts';
import type { ChartCandle } from '../types/view';

/** lightweight-charts 的 Time → YYYY-MM-DD（K 線與觀測台共用） */
export function timeToYmd(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function toBusinessDay(dateText: string): BusinessDay {
  const [year, month, day] = dateText.split('-').map(Number);
  return { year, month, day };
}

export function toCandlestickSeriesData(candles: ChartCandle[]): CandlestickData<Time>[] {
  return candles.map((item) => ({
    time: toBusinessDay(item.time),
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }));
}

export const PRICE_CHART_SERIES_KEYS = ['candles', 'close', 'MA5', 'MA10', 'MA20', 'MA60'] as const;
export type PriceChartSeriesKey = (typeof PRICE_CHART_SERIES_KEYS)[number];
export type PriceChartSeriesVisibility = Record<PriceChartSeriesKey, boolean>;

export const DEFAULT_PRICE_CHART_SERIES_VISIBILITY: PriceChartSeriesVisibility = {
  candles: true,
  close: true,
  MA5: true,
  MA10: true,
  MA20: true,
  MA60: true,
};

export function getNextPriceChartSeriesVisibility(
  current: PriceChartSeriesVisibility,
  key: PriceChartSeriesKey,
): PriceChartSeriesVisibility {
  return { ...current, [key]: !current[key] };
}
