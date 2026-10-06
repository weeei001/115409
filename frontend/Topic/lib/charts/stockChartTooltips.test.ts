import assert from 'node:assert/strict';
import type { InstitutionalDay, TechnicalDay } from '../types/view';
import {
  compareLineOption,
  escapeHtml,
  institutionalFlowOption,
  institutionalTooltipLots,
  kdOption,
  recentChipsRows,
  recentInstitutionalRows,
  riskReturnScatterOption,
  rsiMacdOptions,
} from './adapters';
import { renderedText } from '../testing/markup';

type Formatter = (params: unknown) => string;
const text = (html: string) => renderedText(html);

const day = (date: string, extra: Partial<InstitutionalDay> = {}): InstitutionalDay => ({
  date,
  foreign_buy: null, foreign_sell: null, foreign_net: null,
  investment_trust_buy: null, investment_trust_sell: null, investment_trust_net: null,
  dealer_buy: null, dealer_sell: null, dealer_net: null,
  total_institutional_buy: null, total_institutional_sell: null, total_institutional_net: null,
  ...extra,
});

// ── 04-S5：tooltip 的買、賣、淨用同一個精度，相減對得上 ──
// 2317 的 2026-09-07：投信買 84,000、賣 45,000、淨 39,000 股；以前寫成「買 8萬 / 賣 5萬 / 淨 4萬」
{
  const rows = [day('2026-09-07', {
    foreign_buy: 12_345_678, foreign_sell: 2_345_678, foreign_net: 10_000_000,
    investment_trust_buy: 84_000, investment_trust_sell: 45_000, investment_trust_net: 39_000,
    dealer_buy: 0, dealer_sell: 1_500, dealer_net: -1_500,
    total_institutional_net: 10_037_500,
  })];
  const option = institutionalFlowOption(rows, false) as { tooltip: { formatter: Formatter } };
  const tip = text(option.tooltip.formatter([{ dataIndex: 0 }]));
  // P1-21：單位是張（整數），買、賣、淨各自四捨五入，相減最多差 1 張
  assert.match(tip, /投信：買 84 \/ 賣 45 \/ 淨 \+39/, tip);
  assert.match(tip, /外資：買 12,346 \/ 賣 2,346 \/ 淨 \+10,000/, tip);
  assert.match(tip, /自營：買 0 \/ 賣 2 \/ 淨 −2/, 'Net sells use U+2212');
  assert.match(tip, /（張）/, 'The unit is written once');
  assert.doesNotMatch(tip, /萬股/);
  for (const line of tip.split(/(?=外資|投信|自營)/).slice(1)) {
    const [buy, sell, net] = [...line.matchAll(/[+−]?[\d,]+/g)].map((m) => Number(m[0].replace(/,/g, '').replace('−', '-')));
    assert.ok(Math.abs(buy - sell - net) <= 1, `buy − sell must match net within 1 張: ${line}`);
  }
}
assert.equal(institutionalTooltipLots(null), '--');
assert.equal(institutionalTooltipLots(0, true), '0');
assert.equal(institutionalTooltipLots(-400, true), '不到 1', 'Under one lot: no sign (not colored either)');
assert.equal(institutionalTooltipLots(-15_147_000, true), '−15,147');

// ── 04-S3：法人圖跟著頁面期間，不再固定只畫最近 30 天 ──
{
  const rows = Array.from({ length: 63 }, (_, i) => day(`2026-07-${String((i % 28) + 1).padStart(2, '0')}-${i}`, { total_institutional_net: i }));
  assert.equal(recentInstitutionalRows(rows).length, 63);
  const option = institutionalFlowOption(rows, false) as { xAxis: { data: string[] } };
  assert.equal(option.xAxis.data.length, 63, 'Flow chart must plot every day in the page period');
  const chips = [{ date: '2026-07-03' }, { date: '2026-07-01' }, { date: '2026-07-02' }] as Parameters<typeof recentChipsRows>[0];
  assert.deepEqual(recentChipsRows(chips).map((r) => r.date), ['2026-07-01', '2026-07-02', '2026-07-03']);
}

// ── 02-F5：自訂 HTML tooltip 拼進去的代號與日期要跳脫 ──
assert.equal(escapeHtml('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
assert.equal(escapeHtml(`a&b"c'd`), 'a&amp;b&quot;c&#39;d');
assert.equal(escapeHtml(undefined), '');
{
  const evil = '<img src=x onerror=alert(1)>';
  const flow = institutionalFlowOption([day(evil, { foreign_buy: 1, foreign_sell: 1 })], false) as { tooltip: { formatter: Formatter } };
  assert.ok(!flow.tooltip.formatter([{ dataIndex: 0 }]).includes('<img'), 'Institutional tooltip must escape the date');

  const compare = compareLineOption({ dates: ['2026-07-01'], values: { [evil]: [100] } } as never, [evil], { [evil]: '#000' }, 'price', false) as { tooltip: { formatter: Formatter } };
  const compareTip = compare.tooltip.formatter([{ seriesName: evil, value: 100, color: '#000', axisValue: evil }]);
  assert.ok(!compareTip.includes('<img'), 'Compare tooltip must escape series names and dates');
  assert.match(compareTip, /&lt;img/);

  const scatter = riskReturnScatterOption([{ symbol: evil, x: 20, y: 5, color: '#000' }], false) as { tooltip: { formatter: Formatter } };
  assert.ok(!scatter.tooltip.formatter({ name: evil, value: [20, 5] }).includes('<img'), 'Scatter tooltip must escape the symbol');
}

// ── 04-U7：指標 tooltip 的小數位和卡片、抽屜讀數一致（RSI、KD 1 位，MACD 柱 3 位） ──
{
  const tech = (date: string): TechnicalDay => ({
    date, close: 100, ma5: null, ma10: null, ma20: null, ma60: null, ma120: null, ma240: null,
    rsi5: 55.555, rsi10: 49.2345, kd_k9: 74.7123, kd_d9: 65.54, macd_dif: 1.23456, macd_dea: 1.0, macd_signal: null, macd_hist: 0.23456,
    boll_upper20: null, boll_mid20: null, boll_lower20: null,
  } as TechnicalDay);
  const rows = [tech('2026-07-01'), tech('2026-07-02')];
  type Series = { name: string; tooltip?: { valueFormatter: (v: unknown) => string } };
  const { rsiOption, macdOption } = rsiMacdOptions(rows, false) as unknown as { rsiOption: { series: Series[] }; macdOption: { series: Series[] } };
  const kd = kdOption(rows, false) as unknown as { series: Series[] };
  const fmt = (series: Series[], name: string, v: number) => series.find((s) => s.name === name)?.tooltip?.valueFormatter(v);
  assert.equal(fmt(rsiOption.series, 'RSI10', 49.2345), '49.2');
  assert.equal(fmt(kd.series, 'K', 74.7123), '74.7');
  assert.equal(fmt(kd.series, 'D', 65.54), '65.5', 'K and D must use the same precision');
  assert.equal(fmt(macdOption.series, 'MACD 柱', 0.23456), '0.235');
  assert.equal(fmt(macdOption.series, 'DIF', 1.23456), '1.23');
}

console.log('Stock chart tooltip tests passed: lot arithmetic, page-period rows, HTML escaping, indicator precision.');
