import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { News } from '../../lib/types/api';
import { NewsCard } from './NewsCard';

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
  assert.ok(html.includes('這個版本不顯示 AI 影響分析'));
  assert.ok(html.includes('查看原文與版本狀態') && !html.includes('#analysis'));
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
// 來源顯示中文名稱（P0-5）；對照不到就不顯示，不露出後端代碼
const pubTime = new Date(Date.now() - 5 * 60_000).toISOString();
assert.match(renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news, pub_time: pubTime } })), /5 分鐘前 · 鉅亨網/);
assert.ok(!listHtml.includes('CNYES') && !listHtml.includes('>cnyes'));
const unknownSource = renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news, source: 'mystery_feed', pub_time: pubTime } }));
assert.ok(unknownSource.includes('5 分鐘前</p>') && !unknownSource.includes('mystery_feed'));
// 有分析：動作連到新聞頁的分析區（#analysis）
assert.ok(listHtml.includes('href="/news/saved-article#analysis"') && listHtml.includes('查看事件影響分析'));
// 沒有分析（排隊、失敗、略過、沒有分析）：標「尚無分析」，動作改成「查看內文」，不帶錨點
for (const event_analysis of [undefined, { status: 'pending' as const, events: [], impacts: [] }, { status: 'failed' as const, events: [], impacts: [] }]) {
  const pending = renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news, event_analysis } as News, layout: 'ledger' }));
  assert.ok(pending.includes('尚無分析') && pending.includes('查看內文'));
  assert.ok(!pending.includes('查看事件影響分析') && !pending.includes('#analysis'));
  const drawer = renderToStaticMarkup(React.createElement(NewsCard, { news: { ...news, event_analysis } as News, targetStock: '2330' }));
  assert.ok(drawer.includes('· 尚無分析'));
}
console.log('NewsCard version state tests passed');
