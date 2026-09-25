import assert from 'node:assert/strict';
import type { BenchmarkHistoryResponse } from '../api/benchmark';
import type { MultiStockResponse } from '../types/api';
import { buildBenchmarkComparison } from './compareBenchmark';
import { buildCompareViewModel, recentCloses, toCompareChartSeries } from './compare';

const prices: MultiStockResponse = {
  start_date: '2026-09-01', end_date: '2026-09-04', symbols: ['A', 'B'],
  data: [
    { date: '2026-09-01', prices: { A: 50, B: null } },
    { date: '2026-09-02', prices: { A: 100, B: 20 } },
    { date: '2026-09-03', prices: { A: 110, B: 21 } },
    { date: '2026-09-04', prices: { A: 120, B: 22 } },
  ],
};
const benchmark: BenchmarkHistoryResponse = {
  id: 'TAIEX', name: 'TAIEX', basis: 'price_index_excluding_dividends', source: 'TWSE',
  source_url: 'https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html',
  start_date: prices.start_date, end_date: prices.end_date, total: 3,
  data: [
    { date: '2026-09-02', close: 20000 },
    { date: '2026-09-03', close: 21000 },
    { date: '2026-09-04', close: 22000 },
  ],
};
const result = buildBenchmarkComparison(prices, benchmark);
assert.ok(result.chart);
assert.equal(result.chart.start_date, '2026-09-02');
assert.deepEqual(result.chart.symbols, ['A', 'B', 'TAIEX']);
assert.ok(Math.abs(result.returnPct! - 10) < 1e-9);
const vm = buildCompareViewModel({ symbols: prices.symbols, startDate: prices.start_date, endDate: prices.end_date, chart: prices, volumeMap: {} });
assert.ok(Math.abs(vm.metricsRows[0].totalReturnPct! - result.returnPct! - 10) < 1e-9);
const series = toCompareChartSeries(result.chart, 'cumulativeReturn');
assert.equal(series.values.TAIEX[0], 0);
assert.equal(series.values.TAIEX.at(-1), result.returnPct);
assert.equal(series.values.A.at(-1), vm.metricsRows[0].totalReturnPct);

// Missing benchmark boundaries must not shorten or invalidate the stock window.
for (const missing of [null, { ...benchmark, data: [] }, { ...benchmark, data: benchmark.data.slice(1) },
  { ...benchmark, data: benchmark.data.map((row) => ({ ...row, close: Number.NaN })) }]) {
  const partial = buildBenchmarkComparison(prices, missing);
  assert.equal(partial.returnPct, null);
  assert.deepEqual(partial.chart?.symbols, ['A', 'B']);
  assert.equal(partial.chart?.start_date, '2026-09-02');
  assert.equal(partial.chart?.end_date, '2026-09-04');
  assert.ok(partial.warning);
}
const gap = buildBenchmarkComparison(prices, { ...benchmark, data: benchmark.data.filter((_, i) => i !== 1) });
assert.equal(gap.chart?.data[1].prices.TAIEX, null);
assert.equal(gap.returnPct, result.returnPct);
assert.match(gap.warning!, /斷點/);
assert.equal(buildBenchmarkComparison(null, benchmark).returnPct, null);

// A compact sparkline must not connect across gaps or draw an invalid zero price.
assert.deepEqual(recentCloses(prices, 'B'), []);
assert.deepEqual(recentCloses(prices, 'A'), [50, 100, 110, 120]);
assert.deepEqual(recentCloses({ ...prices, data: [{ date: '2026-09-01', prices: { A: 0 } }] }, 'A'), []);
console.log('Benchmark comparison checks passed: shared dates, percentage points, missing data, and sparkline gaps.');
