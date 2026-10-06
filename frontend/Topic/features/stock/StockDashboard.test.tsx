import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InstitutionalDay, PriceChartData, TechnicalDay } from '../../lib/types/view';
import { macdSignal } from '../../lib/utils/indicatorSignals';
import { StockKpiStrip } from './StockKpiStrip';
import { IndicatorSignalsCard } from './cards/IndicatorSignalsCard';
import { LatestInstitutionalCard } from './cards/LatestInstitutionalCard';

const text = (html: string) => html.replace(/<[^>]+>/g, '');

const priceChart = {
  candles: [
    { time: '2026-07-02', open: 100, high: 105, low: 99, close: 100, volume: 1 },
    { time: '2026-10-02', open: 110, high: 112, low: 108, close: 110, volume: 1 },
  ],
} as unknown as PriceChartData;
const institutional: InstitutionalDay = {
  date: '2026-10-02',
  foreign_buy: null, foreign_sell: null, foreign_net: -14_906_600,
  investment_trust_buy: null, investment_trust_sell: null, investment_trust_net: 0,
  dealer_buy: null, dealer_sell: null, dealer_net: 0,
  total_institutional_buy: null, total_institutional_sell: null, total_institutional_net: -14_907_700,
};
const technical = { date: '2026-10-02', rsi10: 49.234, kd_k9: 51.44, kd_d9: 58.06, macd_hist: 0.2334 } as TechnicalDay;

// 04-S2：KPI 列只放區間數字；法人合計、RSI、MACD 柱只在「法人與指標」出現一次
{
  const kpi = text(renderToStaticMarkup(<StockKpiStrip priceChart={priceChart} chartState="ready" />));
  assert.match(kpi, /近 2 個交易日漲跌幅/);
  assert.match(kpi, /\+10\.00%/);
  for (const duplicated of ['法人合計', 'RSI', 'MACD']) assert.ok(!kpi.includes(duplicated), `KPI strip must not repeat ${duplicated}`);
  const empty = text(renderToStaticMarkup(<StockKpiStrip priceChart={null} />));
  assert.match(empty, /區間最高--/, 'Missing values use --');
}

// 04-U7、05：指標名稱帶參數、判讀用「偏多／偏空／中性」；按鈕和抽屜標題用同一組字
{
  const card = text(renderToStaticMarkup(<IndicatorSignalsCard latest={technical} onOpenDetail={() => {}} />));
  assert.match(card, /RSI（10）49\.2/);
  assert.match(card, /MACD 柱（12, 26, 9）\+0\.233/);
  assert.match(card, /KD（9）K 51\.4 \/ D 58\.1/);
  assert.match(card, /偏多/);
  assert.ok(!card.includes('動能'), 'MACD verdicts no longer say 多方動能／空方動能');
  assert.match(card, /技術指標明細/);
  assert.equal(macdSignal(-0.1).label, '偏空');
  assert.equal(macdSignal(0).label, '中性');

  const chips = text(renderToStaticMarkup(<LatestInstitutionalCard latest={institutional} onOpenDetail={() => {}} />));
  assert.match(chips, /籌碼明細/);
  assert.ok(!chips.includes('詳細籌碼分析'));
}

// 區塊順序（法人與指標在 AI 分析之前）與期間快選要渲染整個 StockDashboard，
// 它經由 PriceChart 載入只有 ESM 的 lightweight-charts，tsx 測試載不到（動態 import 也一樣），改在瀏覽器驗證。

console.log('Stock dashboard tests passed: no duplicated KPIs, indicator labels with parameters, button labels.');
