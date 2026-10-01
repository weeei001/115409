import assert from 'node:assert/strict';
import type { StockInfo } from '@/lib/types/api';
import { buildIndustryOptions, searchIndustryOptions } from './IndustrySearch';

const stocks: StockInfo[] = [
  { symbol: '2330', name: '台積電', industry: '半導體業' },
  { symbol: '2454', name: '聯發科', industry: '半導體業' },
  { symbol: '2881', name: '富邦金', industry: '金融保險業' },
  { symbol: '9999', name: '未分類', industry: null },
];

const supported = ['2454', '2330', '2881'];
const options = buildIndustryOptions(stocks, supported);
assert.deepEqual(options, [
  { industry: '半導體業', symbols: ['2330', '2454'], allAdded: false },
  { industry: '金融保險業', symbols: ['2881'], allAdded: false },
]);
assert.deepEqual(searchIndustryOptions(options, '半導').map((option) => option.industry), ['半導體業']);
assert.deepEqual(searchIndustryOptions(options, '').map((option) => option.industry), ['半導體業', '金融保險業']);
assert.deepEqual(searchIndustryOptions(options, '  半導體業  '), [options[0]]);
assert.deepEqual(searchIndustryOptions(options, '不存在'), []);
assert.deepEqual(buildIndustryOptions([], []), []);
const oneAdded = buildIndustryOptions(stocks, supported, ['2330']);
assert.deepEqual(searchIndustryOptions(oneAdded, '半導'), [{ industry: '半導體業', symbols: ['2454'], allAdded: false }]);
const allAdded = buildIndustryOptions(stocks, supported, ['2330', '2454']);
assert.deepEqual(searchIndustryOptions(allAdded, '半導'), [{ industry: '半導體業', symbols: [], allAdded: true }]);
assert.deepEqual(searchIndustryOptions(allAdded, '不存在'), []);
// No price data is not the same as having selected every supported stock.
assert.deepEqual(buildIndustryOptions(stocks, []), []);
assert.deepEqual(buildIndustryOptions(stocks, ['2330', '2454', '2881'], []), options);
const mixedCase = buildIndustryOptions([{ symbol: ' abc ', name: 'Fixture', industry: 'Technology' }], ['ABC']);
assert.deepEqual(searchIndustryOptions(mixedCase, '  TECHNOLOGY '), [{ industry: 'Technology', symbols: ['ABC'], allAdded: false }]);
assert.deepEqual(buildIndustryOptions([...stocks, stocks[0]], ['2330', '2454', '2881']), options);
const unsupported: StockInfo[] = [
  { symbol: '9998', name: 'Unsupported same-industry fixture', industry: '半導體業' },
  { symbol: '7777', name: 'Unsupported industry fixture', industry: '未支援產業' },
];
assert.deepEqual(buildIndustryOptions([...stocks, ...unsupported], supported), options);
assert.deepEqual(searchIndustryOptions(buildIndustryOptions([...stocks, ...unsupported], supported, ['2330', '2454']), '半導'),
  [{ industry: '半導體業', symbols: [], allAdded: true }]);
assert.deepEqual(buildIndustryOptions(unsupported, supported, ['9998', '7777']), []);
assert.deepEqual(buildIndustryOptions([...stocks, ...unsupported], supported, ['9998', '7777']), options);
assert.deepEqual(searchIndustryOptions(buildIndustryOptions([...stocks, ...unsupported], supported, ['2330', '9998']), '半導'),
  [{ industry: '半導體業', symbols: ['2454'], allAdded: false }]);
console.log('Industry search grouping and ranking checks passed.');
