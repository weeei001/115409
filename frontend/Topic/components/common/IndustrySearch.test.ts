import assert from 'node:assert/strict';
import type { StockInfo } from '@/lib/types/api';
import { buildIndustryOptions, searchIndustryOptions } from './IndustrySearch';

const stocks: StockInfo[] = [
  { symbol: '2330', name: '台積電', industry: '半導體業' },
  { symbol: '2454', name: '聯發科', industry: '半導體業' },
  { symbol: '2881', name: '富邦金', industry: '金融保險業' },
  { symbol: '9999', name: '未分類', industry: null },
];

const options = buildIndustryOptions(stocks, ['2454', '2330', '2881']);
assert.deepEqual(options, [
  { industry: '半導體業', symbols: ['2330', '2454'], allAdded: false },
  { industry: '金融保險業', symbols: ['2881'], allAdded: false },
]);
assert.deepEqual(searchIndustryOptions(options, '半導').map((option) => option.industry), ['半導體業']);
assert.deepEqual(searchIndustryOptions(options, '').map((option) => option.industry), ['半導體業', '金融保險業']);
assert.deepEqual(searchIndustryOptions(options, '  半導體業  '), [options[0]]);
assert.deepEqual(searchIndustryOptions(options, '不存在'), []);
assert.deepEqual(buildIndustryOptions([], []), []);
const oneAdded = buildIndustryOptions(stocks, ['2454', '2881'], ['2330']);
assert.deepEqual(searchIndustryOptions(oneAdded, '半導'), [{ industry: '半導體業', symbols: ['2454'], allAdded: false }]);
const allAdded = buildIndustryOptions(stocks, ['2881'], ['2330', '2454']);
assert.deepEqual(searchIndustryOptions(allAdded, '半導'), [{ industry: '半導體業', symbols: [], allAdded: true }]);
assert.deepEqual(searchIndustryOptions(allAdded, '不存在'), []);
// No price data is not the same as having selected every supported stock.
assert.equal(buildIndustryOptions(stocks, [])[0].allAdded, false);
assert.deepEqual(buildIndustryOptions(stocks, ['2330', '2454', '2881'], []), options);
const mixedCase = buildIndustryOptions([{ symbol: ' abc ', name: 'Fixture', industry: 'Technology' }], ['ABC']);
assert.deepEqual(searchIndustryOptions(mixedCase, '  TECHNOLOGY '), [{ industry: 'Technology', symbols: ['ABC'], allAdded: false }]);
assert.deepEqual(buildIndustryOptions([...stocks, stocks[0]], ['2330', '2454', '2881']), options);
console.log('Industry search grouping and ranking checks passed.');
