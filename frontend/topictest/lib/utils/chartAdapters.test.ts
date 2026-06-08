import assert from 'node:assert/strict';
import { candlestickMaToPriceChart } from './chartAdapters';
import { toCandlestickSeriesData } from './priceChartSeries';
import type { CandlestickWithMAResponse } from '../types';
import type { ChartPoint } from '../types/priceChart';

const sample: CandlestickWithMAResponse = {
  symbol: '2330',
  start_date: '2026-06-01',
  end_date: '2026-06-03',
  dates: ['2026-06-01', '2026-06-02', '2026-06-03'],
  candlestick: [
    {
      date: '2026-06-01',
      open: 100,
      high: 105,
      low: 99,
      close: 104,
      volume: 1000,
      amount: 104000,
      change: 0,
    },
    {
      date: '2026-06-02',
      open: 104,
      high: 108,
      low: 103,
      close: 107,
      volume: 1100,
      amount: 117700,
      change: 3,
    },
    {
      date: '2026-06-03',
      open: 107,
      high: 109,
      low: 106,
      close: 108,
      volume: 1200,
      amount: 129600,
      change: 1,
    },
  ],
  moving_averages: {
    MA5: [null, 105, 106],
    MA10: [null, null, 105.5],
    MA20: [null, null, 104.5],
    MA60: [null, null, null],
  },
};

const chart = candlestickMaToPriceChart(sample);
assert.ok(chart);

const overlays = chart.overlays as Record<string, ChartPoint[]>;
assert.deepEqual(Object.keys(overlays), ['MA5', 'MA10', 'MA20', 'MA60']);
assert.equal(overlays.MA5[1].value, 105);
assert.equal(overlays.MA10[2].value, 105.5);
assert.equal(overlays.MA20[2].value, 104.5);
assert.equal(overlays.MA60[2].value, null);

assert.deepEqual(toCandlestickSeriesData(chart.candles), [
  { time: { year: 2026, month: 6, day: 1 }, open: 100, high: 105, low: 99, close: 104 },
  { time: { year: 2026, month: 6, day: 2 }, open: 104, high: 108, low: 103, close: 107 },
  { time: { year: 2026, month: 6, day: 3 }, open: 107, high: 109, low: 106, close: 108 },
]);

console.log('chartAdapters MA overlay and candlestick series tests passed');
