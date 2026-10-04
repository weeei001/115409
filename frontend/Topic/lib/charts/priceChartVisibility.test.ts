import assert from 'node:assert/strict';
import { getNextPriceChartSeriesVisibility } from './priceChart';

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
