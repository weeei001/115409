import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatDashboard as ChatDashboardData } from '../lib/types/chatDashboard';
import { ChatDashboard } from './ChatDashboard';

const dashboard: ChatDashboardData = {
  title: '台積電與聯發科比較',
  blocks: [
    { kind: 'metrics', title: '關鍵指標', description: '', source_ids: ['S1'], items: [
      { label: '缺少收盤價', value: null, unit: '元', date: '2026-09-11' },
      { label: '零漲跌', value: 0, unit: '%', date: '2026-09-11' },
    ] },
    { kind: 'chart', title: '收盤價走勢', description: '共同交易日', source_ids: ['S1', 'S2'],
      dates: ['2026-09-10', '2026-09-11'], unit: '元', series: [
        { name: '2330', values: [100, null] }, { name: '2454', values: [90, 0] },
      ] },
    { kind: 'table', title: '比較數值', description: '', source_ids: ['S2'],
      columns: ['股票', '報酬率'], rows: [['2330', '無資料'], ['2454', '0%']] },
    { kind: 'news', title: '相關新聞', description: '', source_ids: ['S3', 'S4'], items: [
      { title: '有效新聞', publisher: '公開來源', published_at: '2026-09-11 10:00:00', url: 'https://example.com/news', source_id: 'S3' },
      { title: '<script>alert(1)</script>', publisher: '', published_at: '', url: 'javascript:alert(1)', source_id: 'S4' },
    ] },
  ],
};

const markup = renderToStaticMarkup(<ChatDashboard dashboard={dashboard} />);
assert.match(markup, /無資料/);
assert.match(markup, /資料日期：2026-09-11/);
assert.match(markup, /單位：元/);
assert.match(markup, /<td[^>]*>無資料<\/td>/);
assert.match(markup, /<td[^>]*>0 元<\/td>/);
assert.match(markup, /<details/);
assert.match(markup, /<caption[^>]*>收盤價走勢<\/caption>/);
for (const source of ['S1', 'S2', 'S3', 'S4']) assert.ok(markup.includes(`[${source}]`));
assert.equal((markup.match(/<a /g) ?? []).length, 1);
assert.match(markup, /href="https:\/\/example.com\/news"/);
assert.doesNotMatch(markup, /href="javascript:|<script>/);
assert.match(markup, /&lt;script&gt;/);

const emptyChart = renderToStaticMarkup(<ChatDashboard dashboard={{ title: '無資料', blocks: [{
  kind: 'chart', title: '缺少行情', description: '', source_ids: ['S1'], dates: ['2026-09-11'],
  unit: '元', series: [{ name: '2330', values: [null] }],
}] }} />);
assert.doesNotMatch(emptyChart, /role="img"/);
assert.match(emptyChart, /此區間無可繪製資料/);
assert.match(emptyChart, /<td[^>]*>無資料<\/td>/);
console.log('Chat dashboard SSR checks passed: all blocks, nulls, dates, citations, and safe news links.');
