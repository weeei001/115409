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
  assert.ok(html.includes('不套用現行 AI 影響'));
  assert.ok(!html.includes('STALE_IMPACT_REASON'));
  assert.ok(html.includes('https://example.com/original'));
  if (status === 'historical') assert.ok(html.includes(`revision_id=${'a'.repeat(64)}`));
}
console.log('NewsCard version state tests passed');
