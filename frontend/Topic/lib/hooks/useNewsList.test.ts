import assert from 'node:assert/strict';
import { buildFetchParams, newsListErrorKind, withFixedNewsFilters } from './useNewsList';
import { ApiRequestError } from '../api/client';
import { parseNewsTime, validateNewsTimeRange } from '../utils/newsFilters';
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

// The home list has no fixed relation, so a relation restored from ?newsView= survives; a fixed one still wins.
assert.deepEqual(withFixedNewsFilters({ relation: 'market_context', topic: 'ai' }, {}),
  { relation: 'market_context', topic: 'ai', stock: undefined });
assert.equal(withFixedNewsFilters({ relation: 'market_context' }, { fixedStock: '2330', fixedRelation: 'direct' }).relation, 'direct');
assert.equal(withFixedNewsFilters(undefined, {}).relation, undefined);
assert.equal(buildFetchParams(1, 8, { start_time: '2026-09-25', end_time: '2026-09-01' }, {}).error !== null, true);

// Start time later than min(end, now) is rejected before the request (backend: end = min(end_time, now)).
const now = new Date('2026-10-06T10:00:00+08:00');
assert.equal(validateNewsTimeRange('2026-10-01T09:00:00', undefined, now), null, 'past start, open end');
assert.equal(validateNewsTimeRange('2026-10-06T10:00:00', undefined, now), null, 'start equal to now');
assert.equal(validateNewsTimeRange('2027-01-01T09:00:00', undefined, now), '開始時間不能晚於現在，請重新選擇。', 'future start, open end (05-D1)');
assert.equal(validateNewsTimeRange('2027-01-01T09:00:00', '2027-02-01T09:00:00', now), '開始時間不能晚於現在，請重新選擇。', 'start and end both in the future');
assert.equal(validateNewsTimeRange('2026-10-05T09:00:00', '2026-10-01T09:00:00', now), '開始時間不能晚於結束時間，請重新選擇。');
assert.equal(validateNewsTimeRange('2026-10-01', '2026-10-05', now), null, 'date-only values');
assert.equal(validateNewsTimeRange(undefined, '2026-10-05T09:00:00', now), null, 'end only');
assert.equal(validateNewsTimeRange('not-a-date', undefined, now), '時間格式不正確，請重新選擇。');
// Values without a zone are Taiwan time, like the backend, whatever the browser zone is.
assert.equal(parseNewsTime('2026-10-06T10:00'), Date.parse('2026-10-06T10:00:00+08:00'));
assert.equal(parseNewsTime('2026-10-06'), Date.parse('2026-10-06T00:00:00+08:00'));
assert.notEqual(validateNewsTimeRange('2026-10-06T10:01', undefined, now), null, 'one minute after now');
const future = buildFetchParams(1, 8, { start_time: '2027-01-01T09:00' }, { fixedStock: '2330', retrieval: true }, now);
assert.equal(future.error, '開始時間不能晚於現在，請重新選擇。');
assert.deepEqual(future.params, {});
assert.equal(buildFetchParams(1, 8, { start_time: '2026-10-01T09:00' }, {}, now).error, null);

// Only filter problems offer「清除篩選」; offline, timeouts and 5xx keep「重試」.
assert.equal(newsListErrorKind(new ApiRequestError('x', 400)), 'filter');
assert.equal(newsListErrorKind(new ApiRequestError('x', 422)), 'filter');
assert.equal(newsListErrorKind(new ApiRequestError('x', 500)), 'request');
assert.equal(newsListErrorKind(new ApiRequestError('x', 404)), 'request');
assert.equal(newsListErrorKind(new ApiRequestError('x')), 'request', 'no response (offline, timeout)');
assert.equal(newsListErrorKind(new Error('x')), 'request');

const news = { target_industries: ['24'], event_analysis: { status: 'success', impacts: [
  { target_type: 'industry', target_id: 'shipping' },
  { target_type: 'industry', target_id: '24' },
] as NewsImpact[] } } as News;
assert.deepEqual(visibleImpacts(news, '2330', 'industry_context').map(item => item.target_id), ['24']);
assert.deepEqual(visibleImpacts({ ...news, target_industries: undefined }, '2330', 'industry_context'), []);
console.log('News filters and company industry context checks passed.');
