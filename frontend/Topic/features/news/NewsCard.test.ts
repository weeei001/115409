import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { News } from '../../lib/types/api';
import { NewsCard } from './NewsCard';
import { NewsArticle } from './NewsArticle';
import { buildArticleParagraphs } from './articleParagraphs';
import { parseRelatedStocks, taiwanStockCode, taiwanStockHref, UNSUPPORTED_STOCK_MARKET_MESSAGE } from '../../lib/news/newsLinks';

const news: News = {
  article_id: 'saved-article', source: 'cnyes', source_group: 'cnyes', stock_id: null,
  title: 'Saved title', pub_time: null, url: 'https://example.com/original', tags: null,
  content: 'Saved body', created_at: null,
  event_analysis: { status: 'success', events: [], impacts: [{
    event_key: 'event-1', target_type: 'company', target_id: '2330', direction: 'positive',
    importance: 'high', basis: 'reported', reason: 'STALE_IMPACT_REASON', evidence: [],
  }] },
};
for (const status of ['conflict', 'superseded', 'historical'] as const) {
  const html = renderToStaticMarkup(React.createElement(NewsCard, {
    news: { ...news, source_state: { status, eligible: false, revision_id: 'a'.repeat(64) } }, targetStock: '2330',
  }));
  assert.ok(html.includes('不套用現行 AI 影響'));
  assert.ok(!html.includes('STALE_IMPACT_REASON'));
  assert.ok(html.includes('https://example.com/original'));
  if (status === 'historical') assert.ok(html.includes(`revision_id=${'a'.repeat(64)}`));
}
const activeHtml = renderToStaticMarkup(React.createElement(NewsCard, { news, targetStock: '2330' }));
assert.ok(activeHtml.includes('bg-up-muted text-up-emphasis border-up/30'));
assert.doesNotMatch(activeHtml, /emerald|rose|slate|amber|zinc/);
// 列表每個影響對象只給一個方向標籤：正負對立時顯示一次中性的「正負並存」，不重複堆疊
const base = news.event_analysis!.impacts[0];
const mixedHtml = renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news, event_analysis: { status: 'success', events: [], impacts: [
  { ...base, event_key: 'e1', direction: 'negative' }, { ...base, event_key: 'e2', direction: 'negative' }, { ...base, event_key: 'e3', direction: 'positive', importance: 'low' },
] } } }));
assert.equal((mixedHtml.match(/正負並存/g) ?? []).length, 1);
assert.ok(!mixedHtml.includes('負向') && !mixedHtml.includes('正向'));
assert.ok(mixedHtml.includes('項事件') && (mixedHtml.match(/高重要性/g) ?? []).length === 1);
// 列尾不放沒有文字的圖示鈕：展開與原始來源各只有一個有文字的入口；站內連結不用外連箭頭
const listHtml = renderToStaticMarkup(React.createElement(NewsCard, { news }));
assert.equal((listHtml.match(/https:\/\/example\.com\/original/g) ?? []).length, 1);
assert.equal((listHtml.match(/aria-expanded=/g) ?? []).length, 1);
assert.ok(listHtml.includes('展開內文') && listHtml.includes('查看原始來源'));
assert.ok(!listHtml.includes('lucide-arrow-up-right'));
// 影響對象的個股代號連到個股頁，觸控目標 44px
assert.ok(/href="\/stock\/2330"[^>]*min-h-11|min-h-11[^>]*href="\/stock\/2330"/.test(listHtml) || /<a[^>]*class="[^"]*min-h-11[^"]*"[^>]*href="\/stock\/2330"/.test(listHtml));

for (const identifier of ['5007', '5007.TW', '5007.TWO', '5007-TW', 'TWSE:5007', 'TPEx:5007']) {
  assert.equal(taiwanStockCode(identifier), '5007');
  assert.equal(taiwanStockHref(identifier), '/stock/5007');
}
for (const identifier of ['005930-KR', '5007.US', 'KR:5007', 'AAPL-US', 'tw_stock']) {
  assert.equal(taiwanStockCode(identifier), null);
  assert.equal(taiwanStockHref(identifier), null);
}
const foreignNews: News = { ...news, stock_id: '005930-KR', tags: '005930-KR,5007.TWO', event_analysis: { status: 'pending', events: [], impacts: [] } };
assert.deepEqual(parseRelatedStocks(foreignNews), ['005930-KR', '5007']);
assert.deepEqual(parseRelatedStocks(foreignNews, true), ['5007']);
for (const layout of ['stack', 'ledger'] as const) {
  const html = renderToStaticMarkup(React.createElement(NewsCard, { news: foreignNews, layout }));
  assert.ok(html.includes('005930-KR') && html.includes(UNSUPPORTED_STOCK_MARKET_MESSAGE));
  assert.ok(!html.includes('href="/stock/005930') && html.includes('href="/stock/5007"'));
}
const foreignImpactHtml = renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news,
  event_analysis: { status: 'success', events: [], impacts: [{ ...base, target_id: '005930-KR', target_name: '三星電子' }] },
} }));
assert.ok(foreignImpactHtml.includes('三星電子') && foreignImpactHtml.includes(UNSUPPORTED_STOCK_MARKET_MESSAGE));
assert.ok(!foreignImpactHtml.includes('href="/stock/005930'));
const articleHtml = renderToStaticMarkup(React.createElement(NewsArticle, {
  news: foreignNews, stockCodes: ['005930-KR', '5007.TWO'], selectedStock: '',
  model: buildArticleParagraphs(foreignNews.content ?? '', []), activeQuotes: new Set<string>(),
  pressedQuotes: new Set<string>(), scrollRequest: 0,
}));
assert.ok(articleHtml.includes(UNSUPPORTED_STOCK_MARKET_MESSAGE));
assert.ok(!articleHtml.includes('href="/stock/005930') && articleHtml.includes('href="/stock/5007"'));
console.log('NewsCard version state tests passed');
