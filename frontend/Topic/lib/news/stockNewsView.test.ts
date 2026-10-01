import assert from 'node:assert/strict';
import { parseStockNewsView, stockNewsReturnHref, stockNewsViewHref, STOCK_NEWS_VIEW_PARAM } from './stockNewsView';

const view = { version: 1 as const, symbol: '2330', relation: 'market_context' as const, page: 2,
  filters: { stock: 'wrong', direction: 'negative' as const, topic: 'AI & hardware', start_time: '2026-09-01T09:00', token: 'not-public' } };
const path = stockNewsViewHref('/stock/2330?range=month#details', view);
const clean = parseStockNewsView(new URL(path, 'http://test.local').searchParams.get(STOCK_NEWS_VIEW_PARAM), '2330');
assert.deepEqual(clean, { version: 1, symbol: '2330', relation: 'market_context', page: 2,
  filters: { stock: '2330', relation: 'market_context', direction: 'negative', topic: 'AI & hardware', start_time: '2026-09-01T09:00' } });
assert.ok(!path.includes('not-public'));
assert.equal(stockNewsViewHref(path, null), '/stock/2330?range=month#details');
assert.equal(stockNewsReturnHref(path, '2330'), path);
for (const wrong of ['//evil.example/stock/2330', '/stock/2454', '/stock/2330', '/\\evil.example']) {
  assert.equal(stockNewsReturnHref(wrong, '2330'), null);
}
assert.equal(stockNewsReturnHref(path, '2454'), null);
for (const invalid of [null, 'broken', 'x'.repeat(4001), { ...view, version: 2 }, { ...view, symbol: '2454' },
  { ...view, page: 0 }, { ...view, page: 1.5 }, { ...view, page: 100001 }, { ...view, relation: 'unknown' },
  { ...view, filters: { direction: 'unknown' } }, { ...view, filters: { topic: 'bad\nvalue' } },
  { ...view, filters: { start_time: '2026-09-30', end_time: '2026-09-01' } }, { ...view, filters: [] }]) {
  assert.equal(parseStockNewsView(typeof invalid === 'object' ? JSON.stringify(invalid) : invalid, '2330'), null);
}
console.log('Stock news route state and safe return checks passed.');
