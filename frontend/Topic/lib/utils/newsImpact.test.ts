import assert from 'node:assert/strict';
import type { News } from '../types';
import { visibleImpacts } from './newsImpact';

const news = {
  article_id: 'example',
  event_analysis: {
    status: 'success',
    events: [],
    impacts: [
      { event_key: '1', target_type: 'market', target_id: 'TW', direction: 'uncertain' },
      { event_key: '1', target_type: 'industry', target_id: 'TWSE:24', direction: 'negative' },
      { event_key: '1', target_type: 'company', target_id: '2330', direction: 'positive' },
    ],
  },
} as unknown as News;

assert.equal(visibleImpacts(news).length, 3);
assert.deepEqual(visibleImpacts(news, '2330').map((impact) => impact.target_id), ['2330']);
assert.deepEqual(visibleImpacts(news, '2330', 'industry_context').map((impact) => impact.target_id), ['TWSE:24']);
assert.deepEqual(visibleImpacts(news, '2330', 'market_context').map((impact) => impact.target_id), ['TW']);
assert.deepEqual(visibleImpacts(news, '2317'), []);
news.event_analysis!.status = 'pending';
assert.deepEqual(visibleImpacts(news), []);
