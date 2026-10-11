import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SignalCheckResponse } from '../../lib/types/api';
import { renderedText } from '../../lib/testing/markup';
import { SignalCheckPanel, SignalTable } from './SignalCheckPanel';

const stats = (events: number, avg: number, net: number | null = null) => ({
  events, avg_return_pct: avg, up_rate: 0.55, beat_market_rate: 0.5, avg_excess_pct: 0.1, net_return_pct: net,
});
const RESULT: SignalCheckResponse = {
  symbol: null, stock_count: 40, horizon: 5, start: '2021-01-01', split: '2025-01-01', end: '2026-10-09',
  latest_date: '2026-10-09', round_trip_cost_pct: 0.585, method_note: '事件研究',
  baseline: { key: 'any_day', label: '任一天進場', definition: '每隔 5 個交易日取一天', reading: 'bullish', source: '對照組',
    discovery: stats(8000, 0.3), validation: stats(2000, 0.5), pending: 0 },
  signals: [
    { key: 'foreign_buy_5', label: '外資連續買超 5 日', definition: '外資連續第 5 個交易日買超', reading: 'bullish', source: '法人籌碼',
      discovery: stats(420, 0.9, 0.32), validation: stats(130, 0.2, -0.38), pending: 3 },
    { key: 'kd_dead_high', label: 'KD 高檔死亡交叉', definition: 'K 值由上往下穿越 D 值', reading: 'bearish', source: '技術指標',
      discovery: stats(12, -1.1), validation: stats(5, -0.4), pending: 0 },
  ],
  recent: [],
};

{
  const html = renderToStaticMarkup(React.createElement(SignalTable, { result: RESULT }));
  const plain = renderedText(html);
  assert.ok(plain.includes('挑選期 2021-01-01 ~ 2024-12-31') && plain.includes('驗證期 2025-01-01 ~ 2026-10-09'));
  assert.ok(plain.includes('任一天進場') && plain.includes('對照組'));
  assert.ok(plain.includes('比任一天進場高 0.60 個百分點'), 'discovery edge of the foreign buying streak');
  assert.ok(plain.includes('只有挑選期一致，可能是運氣'));
  assert.ok(plain.includes('扣成本 +0.32%'));
  assert.ok(plain.includes('樣本不足，先不判讀') && plain.includes('12 次（不到 30 次）'));
  assert.ok(plain.includes('另有 3 次未到期'));
  assert.ok(plain.includes('一般解讀偏多') && plain.includes('一般解讀偏空'));
  assert.ok(html.includes('text-up') && html.includes('text-down'), 'returns follow the red-up green-down tokens');
}

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(SignalCheckPanel, { onAccessError: () => false })));
  assert.ok(plain.includes('開始檢驗') && plain.includes('只用已存行情，不呼叫 AI'));
}

console.log('Signal check panel passed: periods, baseline row, verdicts, sample floor, colors.');
