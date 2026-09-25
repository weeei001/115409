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
  { industry: '半導體業', symbols: ['2330', '2454'] },
  { industry: '金融保險業', symbols: ['2881'] },
]);
assert.deepEqual(searchIndustryOptions(options, '半導').map((option) => option.industry), ['半導體業']);
assert.deepEqual(searchIndustryOptions(options, '').map((option) => option.industry), ['半導體業', '金融保險業']);
assert.deepEqual(buildIndustryOptions(stocks, ['9999']), []);
console.log('Industry search grouping and ranking checks passed.');
