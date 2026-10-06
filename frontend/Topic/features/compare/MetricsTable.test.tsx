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
  [-12.34, '−12 元'], [-10000, '−1.00 萬元'], [-100000000, '−1.00 億元'],
];
for (const [value, expected] of fixtures) assert.equal(formatCompareAmount(value).label, expected);
// P1-27：title／sr-only 給約略值與整數元，不給浮點原值、不重複幣別
assert.equal(formatCompareAmount(10598088022.459017).detail, '約 105.98 億元（10,598,088,022 元）');
assert.equal(formatCompareAmount(69389214208.61).detail, '約 693.89 億元（69,389,214,209 元）');
assert.equal(formatCompareAmount(0.125).detail, '0 元');
assert.equal(formatCompareAmount(9999).detail, '9,999 元');
assert.equal(formatCompareAmount(-10000).detail, '約 −1.00 萬元（−10,000 元）');
assert.equal(formatCompareAmount(null).detail, '平均成交值資料未提供');

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
assert.match(html, /平均成交值（元）/);
assert.doesNotMatch(html, /TWD|新臺幣|極值/);
assert.match(html, /粗底線＝本欄較佳/);
// P2-094：排序鈕填滿表頭，至少 44 寬
assert.match(html.match(/<button[^>]*>股票/)?.[0] ?? '', /w-full min-w-11/);
assert.match(html, /693\.89 億元/);
assert.match(html, /368\.82 億元/);
assert.match(html, /title="約 693\.89 億元（69,389,214,209 元）"/);
assert.match(html, /class="sr-only">約 693\.89 億元（69,389,214,209 元）/);
// P2-098：負值用 U+2212
const negative = renderToStaticMarkup(<MetricsTable rows={[{ ...row('2330', 1), totalReturnPct: -10.87 }, row('2317', 1)]} symbolColors={{}} benchmarkReturnPct={1} />);
assert.match(negative, /−10\.87%/);
assert.match(negative, /−11\.87/);
assert.doesNotMatch(negative.replace(/<[^>]+>/g, ' '), /(^|\s)-\d/);
assert.match(html, /28,966 張/); // P1-21：平均成交量用張
assert.match(html, /2\.50%/);
assert.deepEqual(rows, before);
const calculated = buildMetricsRow('2330', null, {
  symbol: '2330', start_date: '2026-09-01', end_date: '2026-09-02',
  data: [100001, 200002].map((amount, i) => ({ date: `2026-09-0${i + 1}`, amount, volume: 10, close: 1, change: 0 })),
});
assert.equal(calculated.avgAmount, 150001.5);
formatCompareAmount(calculated.avgAmount);
assert.equal(calculated.avgAmount, 150001.5);
console.log('Comparison amount presentation checks passed: scale boundaries, U+2212 signs, rounded accessible values and unchanged raw sorting/calculation.');
