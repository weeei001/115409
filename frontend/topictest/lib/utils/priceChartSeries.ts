import type { CandlestickData, Time } from 'lightweight-charts';
import type { ChartCandle } from '../types/priceChart';

function toBusinessDay(dateText: string): Time {
  const [year, month, day] = dateText.split('-').map((v) => Number(v));
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
