import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SignalEvidenceItem } from '../../lib/types/api';
import { renderedText } from '../../lib/testing/markup';
import { EvidenceRow, SignalEvidencePanel } from './SignalEvidencePanel';

const item = (patch: Partial<SignalEvidenceItem>): SignalEvidenceItem => ({
  id: 'sg_01', key: 'foreign_buy_5', label: '外資連續買超 5 日', definition: '外資連續第 5 個交易日買超', reading: 'bullish',
  source: '法人籌碼', fired_on: '2025-06-05', trading_days_ago: 3,
  all_stocks: { events: 412, avg_return_pct: 0.71, up_rate: 0.57, beat_market_rate: 0.55 },
  this_stock: { events: 0 }, edge_vs_baseline_pct: 0.36, ...patch,
});

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, { item: item({}), horizon: 5 })));
  assert.ok(plain.includes('sg_01') && plain.includes('外資連續買超 5 日') && plain.includes('一般解讀偏多'));
  assert.ok(plain.includes('3 個交易日前成立（2025-06-05）'));
  assert.ok(plain.includes('全部股票：412 次，之後第 5 個交易日平均 +0.71%，上漲 57%、贏大盤 55%；比任一天進場高 0.36 個百分點'));
  assert.ok(plain.includes('這檔股票：還沒有已到期的紀錄'));
  assert.ok(!plain.includes('只能參考'));
}

{
  const thin = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, {
    item: item({ all_stocks: { events: 12, avg_return_pct: 1.2, up_rate: 0.6, beat_market_rate: 0.5 } }), horizon: 20,
  })));
  assert.ok(thin.includes('（不到 30 次，只能參考）') && thin.includes('之後第 20 個交易日'));
  const none = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, {
    item: item({ all_stocks: { events: 0 }, edge_vs_baseline_pct: null }), horizon: 5,
  })));
  assert.ok(none.includes('全部股票：還沒有已到期的紀錄') && !none.includes('任一天進場'), 'no comparison without outcomes');
}

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(SignalEvidencePanel, { onAccessError: () => false })));
  assert.ok(plain.includes('指定日期的證據清單') && plain.includes('產生證據清單') && plain.includes('觀察 5 日時，AI 回測用的是同一份統計'));
}

console.log('Signal evidence panel passed: ids, fired timing, point-in-time history copy, thin samples.');
