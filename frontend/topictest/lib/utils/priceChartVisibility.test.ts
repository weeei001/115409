import assert from 'node:assert/strict';
import {
  PRICE_CHART_SERIES_KEYS,
  getNextPriceChartSeriesVisibility,
  getPriceChartSeriesVisibilityOptions,
} from './priceChartVisibility';

const options = getPriceChartSeriesVisibilityOptions();
assert.deepEqual(
  options.map((item) => item.key),
  PRICE_CHART_SERIES_KEYS,
);
assert.ok(options.find((item) => item.key === 'close')?.label === '收盤價');

const initial = {
  candles: true,
  close: true,
  MA5: true,
  MA10: true,
  MA20: true,
  MA60: true,
};

assert.deepEqual(getNextPriceChartSeriesVisibility(initial, 'close'), {
  ...initial,
  close: false,
});

assert.deepEqual(getNextPriceChartSeriesVisibility({ ...initial, candles: false }, 'candles'), {
  ...initial,
  candles: true,
});

console.log('price chart visibility tests passed');
