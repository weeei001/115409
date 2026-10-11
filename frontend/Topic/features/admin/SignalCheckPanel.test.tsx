import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SignalCheckResponse } from '../../lib/types/api';
import { renderedText } from '../../lib/testing/markup';
import { SignalCheckPanel, SignalTable } from './SignalCheckPanel';

const stats = (events: number, avg: number, gap: number, net: number | null = null, months = 8) => ({
  events, months, avg_return_pct: avg, up_rate: 0.55, vs_peers_pct: gap, vs_peers_margin_pct: 0.4, beat_peers_rate: 0.52, net_return_pct: net,
});
const RESULT: SignalCheckResponse = {
  symbol: null, stock_count: 40, horizon: 5, start: '2021-01-01', split: '2025-01-01', end: '2026-10-09',
  latest_date: '2026-10-09', round_trip_cost_pct: 0.585, method_note: '事件研究',
  baseline: { key: 'any_day', label: '任一天進場', definition: '每隔 5 個交易日取一天', reading: 'bullish', source: '參考',
    discovery: stats(8000, 0.3, 0.01), validation: stats(2000, 0.5, -0.02), pending: 0 },
  signals: [
    { key: 'foreign_buy_5', label: '外資連續買超 5 日', definition: '外資連續第 5 個交易日買超', reading: 'bullish', source: '法人籌碼',
      discovery: stats(420, 0.9, 0.6, 0.32), validation: stats(130, 0.2, 0.1, -0.38), pending: 3 },
    { key: 'ma20_up', label: '站上月線', definition: '收盤由 20 日均線以下轉為高於 20 日均線', reading: 'bullish', source: '價格與均線',
      discovery: stats(300, 0.4, 0.2), validation: stats(200, 0.6, -0.1), pending: 0 },
    { key: 'kd_dead_high', label: 'KD 高檔死亡交叉', definition: 'K 值由上往下穿越 D 值', reading: 'bearish', source: '技術指標',
      discovery: stats(12, -1.1, -1.4), validation: stats(500, -0.4, -0.5, null, 3), pending: 0 },
  ],
  recent: [],
};

{
  const html = renderToStaticMarkup(React.createElement(SignalTable, { result: RESULT }));
  const plain = renderedText(html);
  assert.ok(plain.includes('挑選期 2021-01-01 ~ 2024-12-31') && plain.includes('驗證期 2025-01-01 ~ 2026-10-09'));
  assert.ok(plain.includes('任一天進場') && plain.includes('參考：同期間的一般漲跌'));
  assert.ok(plain.includes('比同期其他股票高 0.60 個百分點（誤差 ±0.40）'), 'discovery gap of the foreign buying streak');
  assert.ok(plain.includes('只有挑選期明顯一致，可能是運氣'));
  assert.ok(plain.includes('兩段都和其他股票分不出差別'), 'positive gaps inside the margin are not a finding');
  assert.ok(plain.includes('贏過其他股票 52%') && plain.includes('扣成本 +0.32%'));
  assert.ok(plain.includes('樣本不足，先不判讀') && plain.includes('12 次 · 8 個月（不到 30 次）') && plain.includes('500 次 · 3 個月（不到 6 個月）'));
  assert.ok(plain.includes('另有 3 次未到期'));
  assert.ok(plain.includes('一般解讀偏多') && plain.includes('一般解讀偏空'));
  assert.ok(!plain.includes('比同期其他股票高 0.01'), 'the any-day row is not compared with itself');
  assert.ok(html.includes('text-up') && html.includes('text-down'), 'returns follow the red-up green-down tokens');
}

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(SignalCheckPanel, { onAccessError: () => false })));
  assert.ok(plain.includes('開始檢驗') && plain.includes('只用已存行情，不呼叫 AI'));
}

console.log('Signal check panel passed: periods, reference row, gaps with margins, verdicts, sample floors, colors.');
