import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppliedNewsFilters, NewsFilters, matchNewsDatePreset, newsDatePresetRange } from './NewsFilters';
import { summarizeNewsFilters } from '../../lib/utils/newsFilters';

const renderTrigger = (applied: Parameters<typeof NewsFilters>[0]['applied'], draft = applied) => renderToStaticMarkup(
  <NewsFilters applied={applied} draft={draft} setDraft={() => {}} onApply={() => {}} onClearAdvanced={() => {}} />,
);
const unApplied = renderTrigger({}, { direction:'negative' });
assert.ok(unApplied.includes('aria-label="篩選新聞"'));
assert.ok(unApplied.includes('title="篩選新聞"'));
assert.ok(unApplied.includes('>篩選</span>'), 'Trigger shows a visible text label, not a bare icon');
assert.ok(!unApplied.includes('top-1.5 right-1.5'));
assert.ok(!unApplied.includes('依發布時間篩選新聞'));
const applied = renderTrigger({ direction:'negative' }, { direction:'positive' });
assert.ok(applied.includes('top-1.5 right-1.5'));
assert.deepEqual(summarizeNewsFilters({ direction:'negative' }), ['影響方向：負向']);
const filters = { keyword:'keep-keyword',stock:'2330',relation:'market_context' as const, scope:'industry' as const,
  direction:'mixed' as const,importance:'high' as const,industry:' TWSE:24 ',topic:'<img src=x> AI',
  start_time:'2026-09-01T09:00',end_time:'2026-09-30T16:00' };
assert.deepEqual(summarizeNewsFilters(filters), ['發布時間起：2026-09-01 09:00', '發布時間迄：2026-09-30 16:00',
  '影響範圍：產業','影響方向：正負並存','重要性：高','關聯類型：市場脈絡','產業代碼：TWSE:24','主題：<img src=x> AI']);
assert.deepEqual(summarizeNewsFilters({ keyword:'2330',stock:'2330',relation:'market_context' },true), []);
const html = renderToStaticMarkup(<AppliedNewsFilters applied={filters} onClearAdvanced={() => {}} />);
assert.ok(html.includes('role="status"'));
assert.ok(html.includes('已套用新聞篩選'));
assert.ok(html.includes('清除進階新聞篩選'));
assert.ok(html.includes('&lt;img src=x&gt; AI'));
assert.ok(!html.includes('<img'));
assert.ok(!html.includes('keep-keyword'));
assert.equal(renderToStaticMarkup(<AppliedNewsFilters applied={{}} onClearAdvanced={() => {}} />), '');
// 發布時間快速區間只填既有的 start_time／end_time 草稿（本地時間 datetime-local 格式）
const now = new Date(2026, 9, 3, 14, 25);
assert.deepEqual(newsDatePresetRange(1, now), { start_time: '2026-10-03T00:00', end_time: '' });
assert.deepEqual(newsDatePresetRange(7, now), { start_time: '2026-09-27T00:00', end_time: '' });
assert.equal(matchNewsDatePreset({}, now), null);
assert.equal(matchNewsDatePreset({ start_time: '2026-10-01T00:00' }, now), '3d');
assert.equal(matchNewsDatePreset({ start_time: '2026-10-01T00:00', end_time: '2026-10-02T00:00' }, now), 'custom');
assert.equal(matchNewsDatePreset({ end_time: '2026-10-02T00:00' }, now), 'custom');
console.log('Applied news filter naming, summaries, and safe literal rendering checks passed.');
