import type { BusinessDay, CandlestickData, Time } from 'lightweight-charts';
import type { ChartCandle } from '../types/view';

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

export function getPriceChartSeriesVisibilityOptions(): Array<{
  key: PriceChartSeriesKey;
  label: string;
  kind: 'candlestick' | 'line';
}> {
  return [
    { key: 'candles', label: 'K 線', kind: 'candlestick' },
    { key: 'close', label: '收盤價', kind: 'line' },
    { key: 'MA5', label: 'MA5', kind: 'line' },
    { key: 'MA10', label: 'MA10', kind: 'line' },
    { key: 'MA20', label: 'MA20', kind: 'line' },
    { key: 'MA60', label: 'MA60', kind: 'line' },
  ];
}

export function getNextPriceChartSeriesVisibility(
  current: PriceChartSeriesVisibility,
  key: PriceChartSeriesKey,
): PriceChartSeriesVisibility {
  return { ...current, [key]: !current[key] };
}
