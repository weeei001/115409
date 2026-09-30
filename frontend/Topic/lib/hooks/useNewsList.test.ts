import assert from 'node:assert/strict';
import { buildFetchParams } from './useNewsList';
import { visibleImpacts } from '../utils/newsImpact';
import type { News, NewsImpact } from '../types/api';

const { params, error } = buildFetchParams(2, 8, {
  start_time: '2026-09-01T09:00', end_time: '2026-09-24T16:00',
  direction: 'negative', importance: 'high', scope: 'industry', industry: '24', topic: 'ai',
}, { fixedStock: '2330', fixedRelation: 'industry_context', retrieval: true });
assert.equal(error, null);
assert.equal(params.page, 2);
assert.equal(params.direction, 'negative');
assert.equal(params.importance, 'high');
assert.equal(params.relation, 'industry_context');
assert.equal(params.stock, '2330');
assert.ok(params.start_time?.includes('2026-09-01'));
assert.equal(buildFetchParams(1, 8, { start_time: '2026-09-25', end_time: '2026-09-01' }, {}).error !== null, true);
const news = { target_industries: ['24'], event_analysis: { status: 'success', impacts: [
  { target_type: 'industry', target_id: 'shipping' },
  { target_type: 'industry', target_id: '24' },
] as NewsImpact[] } } as News;
assert.deepEqual(visibleImpacts(news, '2330', 'industry_context').map(item => item.target_id), ['24']);
assert.deepEqual(visibleImpacts({ ...news, target_industries: undefined }, '2330', 'industry_context'), []);
console.log('News filters and company industry context checks passed.');
