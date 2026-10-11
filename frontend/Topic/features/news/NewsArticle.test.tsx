import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { News } from '../../lib/types/api';
import { NewsArticle } from './NewsArticle';

const news: News = {
  article_id: 'a1', source: 'cnyes', source_group: 'cnyes', stock_id: null, title: 'Title',
  pub_time: '2026-10-05T14:30:00Z', url: null, tags: null, content: null, created_at: null,
  event_analysis: { status: 'pending', events: [], impacts: [] },
};
const render = (item: News) => renderToStaticMarkup(
  <NewsArticle news={item} stockCodes={[]} selectedStock="" model={{ paragraphs: [], quotes: [] }}
    activeQuotes={new Set()} pressedQuotes={new Set()} scrollRequest={0} />,
);

// meta 列：中文來源名稱＋24 小時制的台灣時間（P0-5、P2-026），不露出後端代碼
const html = render(news);
assert.ok(html.includes('鉅亨網 · 2026/10/05 22:30'));
assert.ok(!html.includes('CNYES') && !html.includes('下午'));
// Article metadata only describes the current content.
assert.ok(!html.includes('擷取的版本'));

// 對照不到的來源：meta 只留時間
const unknown = render({ ...news, source: 'mystery_feed' });
assert.ok(unknown.includes('>2026/10/05 22:30</p>') && !unknown.includes('mystery_feed'));
console.log('NewsArticle current content metadata checks passed.');
