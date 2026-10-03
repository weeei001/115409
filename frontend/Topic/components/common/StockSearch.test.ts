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
const catalog: StockInfo[] = Array.from({ length: 35 }, (_, index) => ({
  symbol: String(1000 + index), name: `Company ${index}`, industry: 'Technology',
}));
const catalogSymbols = catalog.map((stock) => stock.symbol);
assert.equal(searchStockOptions(catalogSymbols, catalog, '1034')[0].symbol, '1034');
assert.equal(searchStockOptions(catalogSymbols, catalog, 'Company 34')[0].symbol, '1034');
assert.equal(searchStockOptions(catalogSymbols, catalog, '', catalog.length).length, 35);
assert.equal(searchStockOptions(catalogSymbols, catalog, 'Technology', catalog.length).length, 35);
console.log('Stock search ranking and metadata checks passed.');
