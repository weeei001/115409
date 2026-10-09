import assert from 'node:assert/strict';
import type { News } from '../types/api';
import { DIRECTION_TONE, visibleImpacts } from './newsImpact';
import { toneBadge } from './tone';

const news = {
  article_id: 'example',
  target_industries: ['TWSE:24'],
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

// 台股慣例：正向＝漲（紅）、負向＝跌（綠），其餘中性；ImpactDirectionTag 把 DIRECTION_TONE 傳給 Badge（emphasis）
assert.equal(DIRECTION_TONE.positive, 'up');
assert.equal(DIRECTION_TONE.negative, 'down');
assert.equal(toneBadge(DIRECTION_TONE.positive, { emphasis: true }), 'bg-up-muted text-up-emphasis border-up/30');
assert.equal(toneBadge(DIRECTION_TONE.negative, { emphasis: true }), 'bg-down-muted text-down-emphasis border-down/30');
for (const direction of ['neutral', 'mixed', 'uncertain'] as const) {
  assert.equal(DIRECTION_TONE[direction], 'neutral');
  assert.equal(toneBadge(DIRECTION_TONE[direction], { emphasis: true }), 'bg-muted text-subtle border-border');
}
