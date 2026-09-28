import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveMetrics, tradeSides } from './derive';
import { parseSimEvent } from './events';
import { createSseBlockParser } from './sse';
import type { SimDayEvent, SimMetrics } from './types';

const near = (actual: number | null | undefined, expected: number, message: string, epsilon = 1e-6) =>
  assert.ok(typeof actual === 'number' && Math.abs(actual - expected) < epsilon, `${message}：${actual} ≠ ${expected}`);

/** 2026-09-28 實測回應 */
const FIXTURE = readFileSync(new URL('./fixtures/sse-2330-20260827-20260902.txt', import.meta.url), 'utf8');
const parser = createSseBlockParser();
const events = [...parser.push(FIXTURE), ...parser.flush()].map(parseSimEvent);
const days = events.filter((e): e is SimDayEvent => e?.type === 'day');
const metrics = (events.find((e) => e?.type === 'done') as { metrics: SimMetrics }).metrics;
assert.equal(days.length, 5);

// 實測 5 天都是買進、持股一路增加
assert.deepEqual(tradeSides(days), ['buy', 'buy', 'buy', 'buy', 'buy']);

// 前端算的指標要和後端 metrics 對得起來（後端四捨五入到兩位小數）
{
  const d = deriveMetrics(1_000_000, days);
  assert.ok(d);
  assert.equal(d.finalValue, 989212.41);
  assert.equal(d.finalValue, metrics.final_portfolio_value);
  near(d.cumulativeReturnPct, (989212.41 / 1_000_000 - 1) * 100, '累積報酬率');
  near(d.cumulativeReturnPct, metrics.total_return_pct!, '累積報酬率對後端', 0.005);
  // 高點 1,004,697.77（9/1）→ 低點 987,539.05（9/2）
  near(d.maxDrawdownPct, (1 - 987539.05 / 1004697.77) * 100, '最大回撤');
  near(d.maxDrawdownPct, metrics.max_drawdown_pct!, '最大回撤對後端', 0.005);
  assert.equal(d.tradeCount, 5);
  assert.equal(d.tradeCount, metrics.trade_count);
  // 首日收盤 2412.9 → 末日收盤 2382.99
  near(d.buyAndHoldReturnPct, (2382.99 / 2412.9 - 1) * 100, '買進持有報酬率');
  near(d.excessReturnPct, d.cumulativeReturnPct - d.buyAndHoldReturnPct!, '相對買進持有');
}

/** 合成資料：只填計算用得到的欄位 */
function day(date: string, closePrice: number, sharesAfter: number, executedShares: number, portfolioValue: number): SimDayEvent {
  return {
    type: 'day',
    date,
    action: 'x',
    buy_pct: 0,
    sell_pct: 0,
    executed_shares: executedShares,
    cost: 0,
    close_price: closePrice,
    cash_after: 0,
    shares_after: sharesAfter,
    portfolio_value: portfolioValue,
    reason: '',
  };
}

// 持股增加＝買、減少＝賣、不變＝無；第一天和 0 股比較
{
  const series = [
    day('d1', 100, 0, 0, 1000),
    day('d2', 110, 5, 5, 1050),
    day('d3', 90, 5, 0, 950),
    day('d4', 95, 2, -3, 975),
    day('d5', 120, 0, 2, 1100),
  ];
  assert.deepEqual(tradeSides(series), [null, 'buy', null, 'sell', 'sell']);

  const d = deriveMetrics(1000, series);
  assert.ok(d);
  assert.equal(d.finalValue, 1100);
  near(d.cumulativeReturnPct, 10, '累積報酬率');
  // 高點 1050 → 低點 950
  near(d.maxDrawdownPct, (1 - 950 / 1050) * 100, '最大回撤');
  assert.equal(d.tradeCount, 3, 'executed_shares 不為 0 的天數（不論正負）');
  near(d.buyAndHoldReturnPct, 20, '買進持有報酬率');
  near(d.excessReturnPct, -10, '相對買進持有');
}

// 最大回撤從初始資金起算：一開始就跌
{
  const d = deriveMetrics(1000, [day('d1', 10, 0, 0, 900), day('d2', 10, 0, 0, 950)]);
  near(d?.maxDrawdownPct, 10, '從初始資金算起的回撤');
}

// 一路上漲沒有回撤；只有一天時買進持有為 0
{
  const d = deriveMetrics(1000, [day('d1', 10, 0, 0, 1000)]);
  assert.equal(d?.maxDrawdownPct, 0);
  assert.equal(d?.buyAndHoldReturnPct, 0);
  assert.equal(deriveMetrics(1000, [day('d1', 10, 0, 0, 1001), day('d2', 12, 0, 0, 1200)])?.maxDrawdownPct, 0);
}

// 算不出來的情況
assert.equal(deriveMetrics(1000, []), null);
assert.equal(deriveMetrics(0, [day('d1', 10, 0, 0, 1000)]), null);
{
  const d = deriveMetrics(1000, [day('d1', 0, 0, 0, 1000), day('d2', 10, 0, 0, 1000)]);
  assert.equal(d?.buyAndHoldReturnPct, null, '首日收盤不是正數時不算買進持有');
  assert.equal(d?.excessReturnPct, null);
}

console.log('ai-trade-demo derive.test.ts: ok');
