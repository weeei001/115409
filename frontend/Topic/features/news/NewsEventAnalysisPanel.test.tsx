import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { NewsEventAnalysisPanel } from './NewsEventAnalysisPanel';
import type { NewsEventAnalysis, NewsImpact } from '../../lib/types/api';

const impact = (target_type: NewsImpact['target_type'], reason: string): NewsImpact => ({
  event_key: 'event-1', target_type, target_id: target_type === 'company' ? '2330' : target_type,
  target_name: target_type === 'company' ? 'TSMC' : target_type,
  direction: 'positive', importance: 'high', basis: target_type === 'industry' ? 'inferred' : 'reported',
  reason, evidence: [{ field: 'content', quote: `evidence-${reason}` }],
});
const analysis: NewsEventAnalysis = {
  status: 'success', analyzed_at: '2026-10-02T00:00:00Z',
  events: [
    { key: 'event-1', summary: 'Shared event', statement_type: 'forecast', speaker: 'Speaker', topics: ['ai'], evidence: [{ field: 'title', quote: 'Event evidence' }] },
    { key: 'event-2', summary: 'Unimpacted event', statement_type: 'fact', topics: [], evidence: [{ field: 'content', quote: 'Unimpacted evidence' }] },
  ],
  impacts: [impact('market', 'market-reason'), impact('industry', 'industry-reason'), impact('company', 'company-first'), impact('company', 'company-second')],
};
const html = renderToStaticMarkup(<NewsEventAnalysisPanel analysis={analysis} />);
for (const [label, count] of [['大盤', 1], ['產業', 1], ['個股', 2]] as const) {
  assert.match(html, new RegExp(`<h3[^>]*>${label}<span[^>]*>${count} 筆影響</span></h3>`));
}
// 3 個分類 + 3 個影響對象（大盤、產業、TSMC 兩筆歸併為一個）+ 其他事件 + 標籤判讀說明
assert.equal((html.match(/<details\b/g) ?? []).length, 8);
assert.equal((html.match(/查看 TSMC 個股/g) ?? []).length, 1, 'A company appears once, with all its impacts listed under it');
// 有影響的分類預設展開（影響標籤一進來就看得到）；影響對象、其他事件、說明維持收合
assert.equal((html.match(/<details[^>]*\bopen(?:=|\s|>)/g) ?? []).length, 3);
// 個股列帶代號
assert.match(html, /<span class="mr-1\.5 font-mono tabular-nums">2330<\/span>TSMC/);
assert.ok(html.includes('標籤怎麼判讀') && html.includes('不是股價預測'));
// 分析時間：24 小時制、台灣時間
assert.ok(html.includes('分析時間：2026/10/02 08:00'));
for (const item of analysis.impacts) {
  assert.equal(html.split(`</span>${item.reason}</p>`).length - 1, 1, 'Each impact, including repeated targets, is preserved exactly once');
  assert.ok(html.includes(`evidence-${item.reason}`));
}
assert.equal((html.match(/Shared event/g) ?? []).length, 4, 'Every impact retains its event context');
for (const text of ['原文提到：', 'AI 推論：', '以下事件目前看不出對台股的影響', '預測', 'Speaker', 'Event evidence', '其他事件', 'Unimpacted event', 'Unimpacted evidence', 'href="/stock/2330"']) assert.ok(html.includes(text));
for (const [status, text] of [['pending', '尚待處理'], ['failed', '分析失敗'], ['skipped', '資料不足']] as const) {
  assert.ok(renderToStaticMarkup(<NewsEventAnalysisPanel analysis={{ ...analysis, status }} />).includes(text));
}
assert.ok(renderToStaticMarkup(<NewsEventAnalysisPanel analysis={{ status: 'success', events: [], impacts: [] }} />).includes('沒有可確認'));
assert.ok(renderToStaticMarkup(<NewsEventAnalysisPanel analysis={{ ...analysis, events: [] }} />).includes('company-first'), 'Impacts remain visible when event context is missing');
// 0 筆的分類不做成展開列，併成一行
const companyOnly = renderToStaticMarkup(<NewsEventAnalysisPanel analysis={{ ...analysis, impacts: analysis.impacts.filter((item) => item.target_type === 'company') }} />);
assert.ok(companyOnly.includes('大盤、產業</span>：沒有判讀出相關影響'));
assert.doesNotMatch(companyOnly, /<h3[^>]*>(大盤|產業)<span/);
assert.match(companyOnly, /<h3[^>]*>個股<span[^>]*>2 筆影響<\/span><\/h3>/);
const foreignHtml = renderToStaticMarkup(<NewsEventAnalysisPanel analysis={{ ...analysis, impacts: [
  { ...impact('company', 'foreign-company'), target_id: '005930-KR', target_name: '三星電子' },
  { ...impact('company', 'local-company'), target_id: '5007', target_name: '三星科技' },
] }} />);
assert.ok(foreignHtml.includes('三星電子') && foreignHtml.includes('此市場暫不支援個股分析'));
assert.ok(!foreignHtml.includes('href="/stock/005930') && foreignHtml.includes('href="/stock/5007"'));
console.log('News analysis categories, collapsed details, complete evidence, and status checks passed.');
