import assert from 'node:assert/strict';
import type { StockInfo } from '@/lib/types/api';
import { focusLeftCombobox, searchStockOptions, stockSearchStatus } from './StockSearch';

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

// Tab 離開（relatedTarget 在元件外或為 null）就關；焦點移到清單本身（元件內）不關（P1-20）
const inside = { id: 'option' };
const root = { contains: (node: unknown) => node === inside };
assert.equal(focusLeftCombobox(root, null), true, 'Blur to nowhere closes the list');
assert.equal(focusLeftCombobox(root, { id: 'next-field' } as unknown as EventTarget), true, 'Tab to the next field closes the list');
assert.equal(focusLeftCombobox(root, inside as unknown as EventTarget), false, 'Focus moving into the listbox keeps it open');

// 多個代號的提示只在有傳 bulkHint 的地方出現（P2-064）
assert.equal(stockSearchStatus({ query: '台', matches: 3, total: 40 }), null);
assert.equal(stockSearchStatus({ query: '台', matches: 3, total: 40, bulkHint: '可貼上多個代號' }), '可貼上多個代號');
assert.equal(stockSearchStatus({ query: '2330 2317', matches: 0, total: 40 }), '按 Enter 套用貼上的多個股票代號。');
assert.equal(stockSearchStatus({ query: '', matches: 0, total: 0 }), '目前沒有可搜尋的股票。');
assert.equal(stockSearchStatus({ query: '不存在', matches: 0, total: 40 }), '找不到「不存在」；可改用股票代號或公司名稱。');

console.log('Stock search ranking and metadata checks passed.');
