import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ChatDashboard as ChatDashboardData, DashboardChart } from '../../lib/types/chatDashboard';
import { buildChatChartOption, ChatDashboard, chatChartRebaseIndex } from './ChatDashboard';

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

// 圖例裡的每一檔都要真的有線：每個圖例項目都對應一條 data 非空、且至少有一個數值的序列；數值軸自動縮放，不設固定上下限
type BuiltSeries = { name: string; data: Array<number | null> };
function assertEveryLegendEntryDrawn(block: DashboardChart, isDark: boolean) {
  const view = buildChatChartOption(block, isDark);
  const option = view.option as unknown as { legend: { data: Array<{ name: string }> }; series: BuiltSeries[]; yAxis: Record<string, unknown> };
  const legendNames = option.legend.data.map((entry) => entry.name);
  assert.ok(legendNames.length > 0, 'legend must list the plotted series');
  for (const name of legendNames) {
    const series = option.series.find((s) => s.name === name);
    assert.ok(series, `legend entry ${name} has no series`);
    assert.ok(series.data.length > 0, `legend entry ${name} has an empty data array`);
    assert.ok(series.data.some((v) => typeof v === 'number' && Number.isFinite(v)), `legend entry ${name} has no drawable value`);
  }
  assert.equal(option.yAxis.scale, true);
  assert.equal(option.yAxis.min, undefined);
  assert.equal(option.yAxis.max, undefined);
  return { view, option, legendNames };
}

const comparedChart = dashboard.blocks[1] as DashboardChart;
for (const isDark of [false, true]) {
  const { view, legendNames } = assertEveryLegendEntryDrawn(comparedChart, isDark);
  assert.deepEqual(legendNames, ['2330', '2454']);
  assert.equal(view.rebaseIndex, null);
}

// 兩檔價位相差超過 3 倍：改畫以第一個共同日期為 100，兩條線都從 100 出發
const farApart: DashboardChart = { kind: 'chart', title: '收盤價走勢', description: '', source_ids: ['S1', 'S2'], unit: '元',
  dates: ['2026-09-30', '2026-10-01', '2026-10-02'],
  series: [{ name: '0050', values: [null, 200, 202] }, { name: '2330', values: [2480, 2510, 2490] }, { name: '9999', values: [null, null, null] }] };
const rebased = assertEveryLegendEntryDrawn(farApart, false);
assert.equal(rebased.view.rebaseIndex, 1);
assert.deepEqual(rebased.legendNames, ['0050', '2330']);
assert.deepEqual(rebased.view.missing, ['9999']);
for (const series of rebased.option.series) assert.equal(series.data[1], 100);
assert.equal(rebased.option.series[0].data[2], 101);
const rebasedMarkup = renderToStaticMarkup(<ChatDashboard dashboard={{ title: '指數化', blocks: [farApart] }} />);
assert.match(rebasedMarkup, /以 2026-10-01 為 100（原始單位：元）/);
assert.match(rebasedMarkup, /9999 無可繪製資料/);
// 原始數值仍在資料表
assert.match(rebasedMarkup, /<td[^>]*>2,510 元<\/td>/);
const firstRowBase = renderToStaticMarkup(<ChatDashboard dashboard={{ title: '指數化', blocks: [{ ...farApart, series: [{ name: '0050', values: [198, 200, 202] }, farApart.series[1]] }] }} />);
assert.match(firstRowBase, /以第一筆為 100/);
// 約 2 倍（2330 約 2,510、2454 約 4,980）也指數化，避免兩條都被壓成平線；相近的價位不指數化
assert.equal(chatChartRebaseIndex({ ...farApart, series: [{ name: '2330', values: [2480, 2510] }, { name: '2454', values: [4920, 4980] }] }), 0);
assert.equal(chatChartRebaseIndex({ ...farApart, series: [{ name: '2330', values: [2480, 2510] }, { name: '2317', values: [2000, 2010] }] }), null);
// 含負值（例如買賣超）不做指數化
assert.equal(chatChartRebaseIndex({ ...farApart, series: [{ name: 'A', values: [-10, 5, 8] }, { name: 'B', values: [100, 120, 90] }] }), null);
console.log('Chat dashboard SSR checks passed: all blocks, nulls, dates, citations, safe news links, every legend entry drawn, rebasing.');
