import assert from 'node:assert/strict';
import type { StockInfo } from '@/lib/types/api';
import { searchStockOptions } from './StockSearch';

const stocks: StockInfo[] = [
  { symbol: '2330', name: '台積電', industry: '半導體業' },
  { symbol: '2454', name: '聯發科', industry: '半導體業' },
  { symbol: '2881', name: '富邦金', industry: '金融保險業' },
];

assert.deepEqual(searchStockOptions(stocks.map((stock) => stock.symbol), stocks, '2330').map((stock) => stock.symbol), ['2330']);
assert.deepEqual(searchStockOptions(stocks.map((stock) => stock.symbol), stocks, '台積').map((stock) => stock.symbol), ['2330']);
assert.deepEqual(searchStockOptions(stocks.map((stock) => stock.symbol), stocks, '金融').map((stock) => stock.symbol), ['2881']);
assert.deepEqual(searchStockOptions(['2454', '2330'], stocks, '').map((stock) => stock.symbol), ['2454', '2330']);
assert.equal(searchStockOptions(['9999'], stocks, '9999')[0].name, '');
assert.deepEqual(searchStockOptions(stocks.map((stock) => stock.symbol), stocks, '不存在'), []);
console.log('Stock search ranking and metadata checks passed.');
