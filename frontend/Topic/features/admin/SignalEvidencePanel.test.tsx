import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SignalEvidenceItem } from '../../lib/types/api';
import { renderedText } from '../../lib/testing/markup';
import { EvidenceRow, SignalEvidencePanel } from './SignalEvidencePanel';

const item = (patch: Partial<SignalEvidenceItem>): SignalEvidenceItem => ({
  id: 'sg_01', key: 'foreign_buy_5', label: '外資連續買超 5 日', definition: '外資連續第 5 個交易日買超', reading: 'bullish',
  source: '法人籌碼', fired_on: '2025-06-05', trading_days_ago: 3,
  all_stocks: { events: 412, months: 9, avg_return_pct: 0.71, up_rate: 0.57, vs_peers_pct: 0.36, vs_peers_margin_pct: 0.52, beat_peers_rate: 0.55 },
  this_stock: { events: 0 }, ...patch,
});

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, { item: item({}), horizon: 5 })));
  assert.ok(plain.includes('sg_01') && plain.includes('外資連續買超 5 日') && plain.includes('一般解讀偏多'));
  assert.ok(plain.includes('3 個交易日前成立（2025-06-05）'));
  assert.ok(plain.includes('全部股票：412 次，之後第 5 個交易日平均 +0.71%，上漲 57%；比同期其他股票高 0.36 個百分點（誤差 ±0.52）'));
  assert.ok(plain.includes('這檔股票：還沒有已到期的紀錄'));
  assert.ok(!plain.includes('只能參考'));
}

{
  const thin = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, {
    item: item({ all_stocks: { events: 12, months: 2, avg_return_pct: 1.2, up_rate: 0.6, vs_peers_pct: 0.8, vs_peers_margin_pct: 3.1 } }), horizon: 20,
  })));
  assert.ok(thin.includes('（不到 30 次，只能參考）') && thin.includes('之後第 20 個交易日'));
  const fewMonths = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, {
    item: item({ all_stocks: { events: 300, months: 4, avg_return_pct: 0.4, up_rate: 0.5, vs_peers_pct: 0.1, vs_peers_margin_pct: 0.9 } }), horizon: 5,
  })));
  assert.ok(fewMonths.includes('（不到 6 個月，只能參考）'));
  const none = renderedText(renderToStaticMarkup(React.createElement(EvidenceRow, {
    item: item({ all_stocks: { events: 0 } }), horizon: 5,
  })));
  assert.ok(none.includes('全部股票：還沒有已到期的紀錄') && !none.includes('其他股票'), 'no comparison without outcomes');
}

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(SignalEvidencePanel, { onAccessError: () => false })));
  assert.ok(plain.includes('指定日期的證據清單') && plain.includes('產生證據清單') && plain.includes('僅使用判斷日已知資料'));
}

console.log('Signal evidence panel passed: ids, fired timing, point-in-time history and peer gap copy, thin samples.');
