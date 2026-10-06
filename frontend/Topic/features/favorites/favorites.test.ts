import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { addedMessage, favoriteLabel, latestQuoteDate, quotesFromSeries, removedMessage } from './favoriteFeedback';

// P1-29：收盤與漲跌由每日收盤序列算出；只看這一檔有收盤的日子
const quotes = quotesFromSeries({
  symbols: ['2330', '2317', '9999'],
  data: [
    { date: '2026-10-02', prices: { '2330': 1460, '2317': 210, '9999': null } },
    { date: '2026-09-30', prices: { '2330': 1440, '2317': 212, '9999': null } },
    { date: '2026-10-01', prices: { '2330': 1450, '2317': null, '9999': null } },
  ],
});
assert.deepEqual(quotes['2330'], { close: 1460, change: 10, changePercent: (10 / 1450) * 100, date: '2026-10-02' });
assert.equal(quotes['2317'].close, 210);
assert.equal(quotes['2317'].change, -2, 'A gap day is skipped: change is against the previous available close');
assert.equal(quotes['2317'].date, '2026-10-02');
assert.deepEqual(quotes['9999'], { close: null, change: null, changePercent: null, date: null });
const single = quotesFromSeries({ symbols: ['2330'], data: [{ date: '2026-10-02', prices: { '2330': 100 } }] });
assert.deepEqual(single['2330'], { close: 100, change: null, changePercent: null, date: '2026-10-02' });

assert.equal(latestQuoteDate(quotes), '2026-10-02');
assert.equal(latestQuoteDate({}), null);

// P2-114：提示用語依 05（取消收藏、復原）
assert.equal(favoriteLabel('2317', '鴻海'), '2317 鴻海');
assert.equal(favoriteLabel('2317', ' '), '2317');
assert.equal(removedMessage('2317', '鴻海'), '已取消收藏 2317 鴻海');
assert.equal(addedMessage('2330'), '已加入收藏 2330');

// P2-115～P2-117：清單與搜尋的用語
const list = readFileSync(join(__dirname, 'FavoriteList.tsx'), 'utf8');
const search = readFileSync(join(__dirname, 'FavoriteStockSearch.tsx'), 'utf8');
const toggle = readFileSync(join(__dirname, 'FavoriteToggle.tsx'), 'utf8');
assert.ok(list.includes('aria-label={`取消收藏 ${label}`}') && !list.includes('移除收藏'));
assert.ok(!list.includes('收盤與漲跌請到個股頁查看') && !list.includes('收盤與走勢') && list.includes('看行情'));
assert.ok(!list.includes('hideQuote'), 'Favorite rows show close and change');
assert.ok(search.includes('搜尋股票後直接加入收藏清單。') && !search.includes('關注清單'));
assert.ok(toggle.includes("title={pressed ? '取消收藏' : '加入收藏'}"), 'Star has a tooltip');

console.log('Favorites quote and feedback checks passed.');
