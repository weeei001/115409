import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { curveReturn, presetText, returnGapText, tradeText } from '../../lib/backtest/aiBacktest';
import type { AIBacktestResult, BacktestGroupResult } from '../../lib/types/api';
import { signedText } from '../../lib/utils/format';
import { renderedElements, renderedText } from '../../lib/testing/markup';
import { AIBacktestPanel, BacktestResults } from './AIBacktestPanel';

assert.equal(presetText('standard'), '偏多 100%、溫和偏多 70%、中性 不調整、溫和偏空 30%、偏空 0%');
assert.equal(returnGapText(8.4, 6.3, '買進持有'), '比買進持有高 2.10 個百分點');
assert.equal(returnGapText(1, 1, '加權指數'), '和加權指數相同');
assert.equal(returnGapText(1, null, '加權指數'), '沒有加權指數可比較');
assert.equal(curveReturn([1_000_000, 1_084_000], 1_000_000), 8.4);
assert.equal(curveReturn([], 1_000_000), null);
assert.equal(signedText(-1.2, 2, '%'), '−1.20%');
assert.equal(tradeText(0.7, 120, '2025-01-03'), '目標持股 70%，2025-01-03 開盤買進 120 股');
assert.equal(tradeText(0, -1200, '2025-01-03'), '目標持股 0%，2025-01-03 開盤賣出 1,200 股');
assert.equal(tradeText(null, 0, '2025-01-03'), '不調整持股');
assert.equal(tradeText(1, 0, null), '期間最後一次判斷，沒有隔日可以成交');

const tiers = (counts: number[]) => (['bullish', 'mildly_bullish', 'neutral', 'mildly_bearish', 'bearish'] as const)
  .map((stance, index) => ({ stance, count: counts[index], avg_forward_pct: counts[index] ? 0.5 - index * 0.3 : null, hit_rate: counts[index] && stance !== 'neutral' ? 0.55 : null }));
const group = (key: BacktestGroupResult['key'], label: string, total: number, patch: Partial<BacktestGroupResult> = {}): BacktestGroupResult => ({
  key, label, final_value: 1_000_000 * (1 + total / 100), total_return_pct: total, max_drawdown_pct: 4.2, trades: 18, costs_paid: 9_876,
  avg_exposure: 0.62, directional_calls: 40, hit_rate: 0.55, beat_market_rate: 0.5, failed_calls: 0, tiers: tiers([5, 20, 10, 10, 5]),
  citations: [], equity: [1_000_000, 1_000_000 * (1 + total / 100)], ...patch,
});
const RESULT: AIBacktestResult = {
  symbol: '2330', start: '2025-01-01', end: '2025-12-31', preset: 'standard', initial_cash: 1_000_000, decision_every: 5,
  model_name: 'gemma', dates: ['2025-01-02', '2025-12-31'], buy_and_hold: [1_000_000, 1_121_000],
  market_index: [1_000_000, 1_096_000], method_note: '研究用的模擬',
  groups: [
    group('rule', '純規則', 7.9, { citations: [{ key: 'foreign_buy_5', label: '外資連續買超 5 日', available: 12, cited: 12, avg_edge_pct: 0.3 }] }),
    group('ai_plain', 'AI 不給訊號', 4.2, { failed_calls: 2 }),
    group('ai_signals', 'AI 給訊號', 9.1, { citations: [{ key: 'foreign_buy_5', label: '外資連續買超 5 日', available: 12, cited: 7, avg_edge_pct: 0.3, cited_hit_rate: 0.71 }] }),
  ],
  decisions: [{
    date: '2025-01-02', execution_date: '2025-01-03', forward_return_pct: 2.3, market_return_pct: 0.8, active_signals: ['foreign_buy_5'],
    groups: {
      rule: { stance: 'mildly_bullish', signal_keys: ['foreign_buy_5'], reason: '證據清單中，歷史上勝過任一天進場的訊號 1 個、輸給的 0 個', target_exposure: 0.7, traded_shares: 120 },
      ai_plain: { stance: null, failed: true, reason: '模型沒有回傳可用的判斷，這次不調整持股。' },
      ai_signals: { stance: 'bullish', signal_keys: ['foreign_buy_5'], reason: '外資連買且歷史優勢為正。', target_exposure: 1, traded_shares: 172 },
    },
  }],
};

{
  const html = renderToStaticMarkup(React.createElement(BacktestResults, { result: RESULT }));
  const plain = renderedText(html);
  assert.ok(plain.includes('基準：買進持有 +12.10% · 加權指數 +9.60%'));
  assert.ok(plain.includes('+9.10%') && plain.includes('比買進持有低 3.00 個百分點') && plain.includes('比加權指數低 0.50 個百分點'));
  assert.ok(plain.includes('模型 2 次沒有回傳可用的判斷'));
  assert.ok(plain.includes('五個等級的結果') && plain.includes('溫和偏多'));
  assert.ok(plain.includes('外資連續買超 5 日') && plain.includes('7 次（58%）') && plain.includes('71%'), 'AI cited 7 of 12 times');
  assert.ok(plain.includes('目標持股 70%，2025-01-03 開盤買進 120 股') && plain.includes('沒有判斷'));
  assert.ok(plain.includes('用到：外資連續買超 5 日'));
  assert.ok(plain.includes('+0.30 個百分點') && !plain.includes('% 點'), 'edges are percentage points');
  assert.ok(html.includes('role="img"') || html.includes('資產曲線'), 'the equity chart has a labelled container');
}

{
  // 只跑純規則時只有一組：那一格占滿整列，三欄格線不會露出灰底空格
  const groupPanelClass = (result: AIBacktestResult, label: string) => {
    const heading = renderedElements(renderToStaticMarkup(React.createElement(BacktestResults, { result })), 'h3').find((el) => renderedText(el) === label);
    return (heading?.parent?.parent as { attribs?: Record<string, string> } | null | undefined)?.attribs?.class ?? '';
  };
  assert.ok(groupPanelClass({ ...RESULT, groups: [RESULT.groups[0]] }, '純規則').includes('sm:col-span-3'), 'a rule-only run fills the row');
  assert.ok(!groupPanelClass(RESULT, '純規則').includes('sm:col-span-3'), 'three groups share the row');
}

{
  const plain = renderedText(renderToStaticMarkup(React.createElement(AIBacktestPanel, { onAccessError: () => false })));
  assert.ok(plain.includes('開始回測') && plain.includes('讀取已跑完的結果') && plain.includes('每 5 個交易日判斷一次'));
  assert.ok(plain.includes('偏多 100%、溫和偏多 70%'));
}

console.log('AI backtest panel passed: copy helpers, group summaries, rule-only layout, tiers, citations, decision log.');
