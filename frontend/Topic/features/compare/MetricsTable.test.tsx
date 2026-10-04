import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CompareMetricsRow } from '@/lib/types/compare';
import { buildMetricsRow, sortMetricsRows } from '@/lib/utils/compare';
import { formatCompareAmount, MetricsTable } from './MetricsTable';

const fixtures: Array<[number | null, string]> = [
  [null, '--'], [NaN, '--'], [Infinity, '--'], [-Infinity, '--'],
  [0, '0 元'], [12.34, '12 元'], [9999, '9,999 元'],
  [10000, '1.00 萬元'], [12345, '1.23 萬元'], [99999999, '10000.00 萬元'],
  [100000000, '1.00 億元'], [69389214208.61, '693.89 億元'], [36881779273.11, '368.82 億元'],
  [-12.34, '-12 元'], [-10000, '-1.00 萬元'], [-100000000, '-1.00 億元'],
];
for (const [value, expected] of fixtures) assert.equal(formatCompareAmount(value).label, expected);
assert.equal(formatCompareAmount(69389214208.61).detail, '新臺幣 69,389,214,208.61 元（TWD）');
assert.equal(formatCompareAmount(0.125).detail, '新臺幣 0.125 元（TWD）');
assert.equal(formatCompareAmount(null).detail, '平均金額資料未提供');

const row = (symbol: string, amount: number | null): CompareMetricsRow => ({
  symbol, avgAmount: amount, avgVolume: 28966200, totalReturnPct: 2.5,
  volatilityPct: null, maxDrawdownPct: null, winRatePct: null, maxDailyGainPct: null, maxDailyLossPct: null,
});
// These round to the same display string. Sorting must still distinguish the raw values.
const rows = [row('A', 100000002), row('B', 100000001), row('C', null), row('D', -10000)];
const before = structuredClone(rows);
assert.equal(formatCompareAmount(rows[0].avgAmount).label, formatCompareAmount(rows[1].avgAmount).label);
assert.deepEqual(sortMetricsRows(rows, { key: 'avgAmount', direction: 'asc' }).map((r) => r.symbol), ['D', 'B', 'A', 'C']);
assert.deepEqual(sortMetricsRows(rows, { key: 'avgAmount', direction: 'desc' }).map((r) => r.symbol), ['A', 'B', 'D', 'C']);
const html = renderToStaticMarkup(<MetricsTable rows={[row('2330', 69389214208.61), row('2454', 36881779273.11)]} symbolColors={{}} />);
assert.match(html, /平均金額（TWD）/);
assert.match(html, /693\.89 億元/);
assert.match(html, /368\.82 億元/);
assert.match(html, /title="新臺幣 69,389,214,208\.61 元（TWD）"/);
assert.match(html, /class="sr-only">新臺幣 69,389,214,208\.61 元（TWD）/);
assert.match(html, /2896\.62 萬股/);
assert.match(html, /2\.50%/);
assert.deepEqual(rows, before);
const calculated = buildMetricsRow('2330', null, {
  symbol: '2330', start_date: '2026-09-01', end_date: '2026-09-02',
  data: [100001, 200002].map((amount, i) => ({ date: `2026-09-0${i + 1}`, amount, volume: 10, close: 1, change: 0 })),
});
assert.equal(calculated.avgAmount, 150001.5);
formatCompareAmount(calculated.avgAmount);
assert.equal(calculated.avgAmount, 150001.5);
console.log('Comparison amount presentation checks passed: TWD, scale boundaries, signs, exact accessible values and unchanged raw sorting/calculation.');
