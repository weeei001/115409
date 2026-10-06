import assert from 'node:assert/strict';
import { HOME_NEWS_VIEW_PARAM, homeNewsSyncHref, homeNewsViewHref, parseHomeNewsView } from './homeNewsView';
import { newsDetailBreadcrumbs } from './newsLinks';

// 首頁新聞的頁碼與篩選寫進網址，上一頁回來時還原（03-F14）
const path = homeNewsViewHref('/#terminal', {
  page: 2,
  filters: { keyword: '台積電', relation: 'direct', direction: 'negative', start_time: '2026-09-01T09:00', stock: '2330', token: 'not-public' } as never,
});
assert.ok(path.startsWith('/?newsView=') && path.endsWith('#terminal'));
assert.ok(!path.includes('not-public') && !path.includes('2330'));
assert.deepEqual(parseHomeNewsView(new URL(path, 'http://test.local').searchParams.get(HOME_NEWS_VIEW_PARAM)), {
  version: 1, page: 2, filters: { keyword: '台積電', relation: 'direct', direction: 'negative', start_time: '2026-09-01T09:00' },
});
// 第 1 頁、沒有篩選：不寫參數；原本有的也拿掉
assert.equal(homeNewsViewHref('/', { page: 1, filters: {} }), '/');
assert.equal(homeNewsViewHref(path, { page: 1, filters: { keyword: '  ' } }), '/#terminal');
assert.equal(homeNewsViewHref('/?x=1', { page: 3, filters: {} }), `/?x=1&newsView=${encodeURIComponent('{"version":1,"page":3,"filters":{}}')}`);
for (const invalid of [null, 'broken', 'x'.repeat(4001), { version: 2, page: 1, filters: {} }, { version: 1, page: 0, filters: {} },
  { version: 1, page: 1.5, filters: {} }, { version: 1, page: 2, filters: [] }, { version: 1, page: 2 },
  { version: 1, page: 2, filters: { relation: 'unknown' } }, { version: 1, page: 2, filters: { keyword: 'bad\nvalue' } },
  { version: 1, page: 2, filters: { start_time: '2026-09-30', end_time: '2026-09-01' } }]) {
  assert.equal(parseHomeNewsView(typeof invalid === 'object' && invalid ? JSON.stringify(invalid) : invalid), null);
}

// 只在首頁自己的路由寫回：退場動畫期間 router 已經是新聞頁，不能把參數接到新聞頁網址上
const page2 = { page: 2, filters: {} };
assert.equal(homeNewsSyncHref({ pathname: '/news/[id]', asPath: '/news/abc' }, '/', page2), null);
assert.ok(homeNewsSyncHref({ pathname: '/', asPath: '/' }, '/', page2)?.startsWith('/?newsView='));
assert.equal(homeNewsSyncHref({ pathname: '/', asPath: '/' }, '/', { page: 1, filters: {} }), null, '網址已經一致就不 replace');
const synced = homeNewsSyncHref({ pathname: '/', asPath: '/' }, '/', page2)!;
assert.equal(homeNewsSyncHref({ pathname: '/', asPath: synced }, '/', page2), null);

// 新聞頁的麵包屑：從首頁進來（沒有 stock）不放個股層；從個股頁進來連回原本的相關新聞列表（04-N2）
assert.deepEqual(newsDetailBreadcrumbs('', null).map((item) => item.label), ['首頁', '新聞內容與事件影響']);
assert.deepEqual(newsDetailBreadcrumbs('2330', null), [
  { label: '首頁', href: '/' }, { label: '2330', href: '/stock/2330' }, { label: '新聞內容與事件影響' },
]);
assert.equal(newsDetailBreadcrumbs('2330', '/stock/2330?newsView=x')[1].href, '/stock/2330?newsView=x');
assert.equal(newsDetailBreadcrumbs('../evil', null).length, 2);
console.log('Home news route state and news breadcrumb checks passed.');
