import assert from 'node:assert/strict';
import { bulkSearchTarget, compareHref, COMPARE_URL_MAX_SYMBOLS, parseCompareQuery } from './compareQuery';

const known = ['2330', '2317', '2454', '1101'];

// P1-26：網址帶的代號與期間
assert.equal(compareHref(['2330', '2317'], { startDate: '2026-07-06', endDate: '2026-10-05' }), '/compare?s=2330,2317&from=2026-07-06&to=2026-10-05');
assert.equal(compareHref(['2330', '2317']), '/compare?s=2330,2317');
assert.deepEqual(parseCompareQuery({ s: '2330,2317', from: '2026-07-06', to: '2026-10-05' }, known), {
  symbols: ['2330', '2317'], startDate: '2026-07-06', endDate: '2026-10-05',
});
// 去重、轉大寫、只留清單裡有的代號；陣列參數取第一個
assert.deepEqual(parseCompareQuery({ s: ['2330 2330;9999,2454', '1101'] }, known)?.symbols, ['2330', '2454']);
assert.deepEqual(parseCompareQuery({ s: '2330,9999' })?.symbols, ['2330', '9999'], 'Without a catalog nothing is filtered');
// 期間不合法（格式、不存在的日期、起日晚於迄日、只有一邊）就用預設期間
for (const [from, to] of [['2026/07/06', '2026-10-05'], ['2026-02-31', '2026-10-05'], ['2026-10-05', '2026-07-06'], ['2026-07-06', undefined]]) {
  const query = parseCompareQuery({ s: '2330', from, to }, known);
  assert.deepEqual([query?.startDate, query?.endDate], [null, null], `${from} → ${to}`);
}
// 沒有可用代號
assert.equal(parseCompareQuery({}, known), null);
assert.equal(parseCompareQuery({ s: '' }, known), null);
assert.equal(parseCompareQuery({ s: '9999' }, known), null);
assert.equal(parseCompareQuery({ s: '<script>' }), null, 'Only symbol-shaped tokens are accepted');
assert.equal(parseCompareQuery({ s: 'x'.repeat(1001) }), null);
// 上限
const many = Array.from({ length: 40 }, (_, i) => String(1000 + i));
assert.equal(parseCompareQuery({ s: many.join(',') })?.symbols.length, COMPARE_URL_MAX_SYMBOLS);
// 寫進去的網址讀得回來
const href = compareHref(['2330', '1101'], { startDate: '2026-01-02', endDate: '2026-03-31' });
assert.deepEqual(parseCompareQuery(Object.fromEntries(new URL(href, 'http://x').searchParams), known), {
  symbols: ['2330', '1101'], startDate: '2026-01-02', endDate: '2026-03-31',
});

// P2-062：頁首、首頁搜尋貼上多個代號
assert.equal(bulkSearchTarget('2330, 2317；2454', known), '/compare?s=2330,2317,2454');
assert.equal(bulkSearchTarget('2330 9999', known), '/stock/2330');
assert.equal(bulkSearchTarget('9999', known), null);

console.log('Compare URL state checks passed.');
