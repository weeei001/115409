import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppliedNewsFilters, NEWS_DATE_PRESETS, NewsFilters, matchNewsDatePreset, newsDatePresetRange, newsDraftTimeError } from './NewsFilters';
import { groupNewsIndustries, newsIndustryOption, newsIndustryText, summarizeNewsFilters } from '../../lib/utils/newsFilters';

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
  '影響範圍：產業','影響方向：正負並存','重要性：高','關聯類型：市場脈絡','產業：TWSE:24','主題：<img src=x> AI']);
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
// 草稿不合法時篩選面板不讓套用（P0-1）：只填「起」而且晚於現在、起晚於迄
assert.equal(newsDraftTimeError({ start_time: '2027-01-01T09:00' }, now), '開始時間不能晚於現在，請重新選擇。');
assert.equal(newsDraftTimeError({ start_time: '2026-10-03T09:00', end_time: '2026-10-01T09:00' }, now), '開始時間不能晚於結束時間，請重新選擇。');
assert.equal(newsDraftTimeError({ start_time: '2026-10-01T09:00' }, now), null);
assert.equal(newsDraftTimeError({}, now), null);
// 產業下拉選單（P1-01）：選項來自 /news/industries，畫面顯示中文產業名，依上市／上櫃分組
const industries = [
  { id: 'TPEx:24', name: '上櫃 · 半導體業' }, { id: 'TWSE:01', name: '上市 · 水泥工業' },
  { id: 'TWSE:24', name: '上市 · 半導體業' }, { id: 'X:1', name: '其他產業' },
];
assert.deepEqual(newsIndustryOption(industries[2]), { id: 'TWSE:24', name: '半導體業', market: '上市' });
assert.deepEqual(groupNewsIndustries(industries).map((group) => [group.market, group.options.map((option) => option.name)]),
  [['上市', ['水泥工業', '半導體業']], ['上櫃', ['半導體業']], ['其他', ['其他產業']]]);
assert.equal(newsIndustryText('TWSE:24', industries), '半導體業（上市）');
assert.equal(newsIndustryText('TWSE:99', industries), 'TWSE:99', 'unknown codes fall back to the code');
assert.deepEqual(summarizeNewsFilters({ industry: ' TPEx:24 ' }, false, industries), ['產業：半導體業（上櫃）']);
assert.ok(!summarizeNewsFilters({ industry: 'TWSE:24' }, false, industries).some((text) => text.includes('TWSE')));

// 用語統一（05）：近 1 日、影響範圍「個股」、關聯類型「直接關聯」
assert.deepEqual(NEWS_DATE_PRESETS.map((preset) => preset.label), ['近 1 日', '近 3 日', '近 7 日']);
assert.deepEqual(summarizeNewsFilters({ scope: 'company', relation: 'direct' }), ['影響範圍：個股', '關聯類型：直接關聯']);
console.log('Applied news filter naming, summaries, and safe literal rendering checks passed.');
