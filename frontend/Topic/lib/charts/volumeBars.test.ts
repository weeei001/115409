import assert from 'node:assert/strict';
import { toVolumeHistogramData, volumeBarColor } from './priceChart';
import { getChartPalette } from './theme';

// DESIGN.md §8：成交量柱依收盤對前一日收盤上色，漲 up、跌 down、平盤 flat（台股紅漲綠跌）
const palette = getChartPalette(false);
assert.equal(volumeBarColor(101, 100, palette), palette.volumeUp);
assert.equal(volumeBarColor(99, 100, palette), palette.volumeDown);
assert.equal(volumeBarColor(100, 100, palette), palette.volumeFlat);
assert.equal(volumeBarColor(100, null, palette), palette.volumeFlat, 'No previous close is flat');
assert.equal(volumeBarColor(null, 100, palette), palette.volumeFlat, 'No candle that day is flat');

const candles = [
  { time: '2026-09-29', open: 10, high: 11, low: 9, close: 10 },
  { time: '2026-09-30', open: 10, high: 12, low: 10, close: 11 },
  { time: '2026-10-01', open: 11, high: 11, low: 9, close: 9 },
  { time: '2026-10-02', open: 9, high: 10, low: 9, close: 9 },
];
const volume = [
  { time: '2026-09-29', value: 1000 },
  { time: '2026-09-30', value: 2000 },
  { time: '2026-10-01', value: 3000 },
  { time: '2026-10-02', value: 4000 },
  // 沒有對應 K 棒的日子
  { time: '2026-10-05', value: 5000 },
];
const bars = toVolumeHistogramData(candles, volume, palette);
assert.deepEqual(bars, [
  { time: { year: 2026, month: 9, day: 29 }, value: 1000, color: palette.volumeFlat },
  { time: { year: 2026, month: 9, day: 30 }, value: 2000, color: palette.volumeUp },
  { time: { year: 2026, month: 10, day: 1 }, value: 3000, color: palette.volumeDown },
  { time: { year: 2026, month: 10, day: 2 }, value: 4000, color: palette.volumeFlat },
  { time: { year: 2026, month: 10, day: 5 }, value: 5000, color: palette.volumeFlat },
]);

// 夜海用同一套規則、各自的色值
const dark = getChartPalette(true);
assert.deepEqual(toVolumeHistogramData(candles, volume, dark).map((bar) => bar.color), [dark.volumeFlat, dark.volumeUp, dark.volumeDown, dark.volumeFlat, dark.volumeFlat]);
assert.deepEqual(toVolumeHistogramData([], [], palette), []);

console.log('Volume bar colour checks passed: up/down/flat against the previous close, first bar flat.');
