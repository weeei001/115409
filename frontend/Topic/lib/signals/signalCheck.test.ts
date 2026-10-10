import assert from 'node:assert/strict';
import type { SignalPeriodStats, SignalStats } from '../types/api';
import { dayBefore, edgeText, edgeVsBaseline, firedText, historyText, MIN_SIGNAL_EVENTS, signalVerdict } from './signalCheck';

const period = (avg: number | null, events = 40): SignalPeriodStats => ({ events, avg_return_pct: avg });
const signal = (reading: 'bullish' | 'bearish', early: SignalPeriodStats, late: SignalPeriodStats): SignalStats => ({
  key: 'k', label: 'k', definition: '', reading, source: '', discovery: early, validation: late, pending: 0,
});
const baseline = signal('bullish', period(0.3, 900), period(0.5, 300));

assert.equal(edgeVsBaseline(period(0.72), period(0.3)), 0.42);
assert.equal(edgeVsBaseline(period(null), period(0.3)), null);
assert.equal(edgeText(0.42), '比任一天進場高 0.42 個百分點');
assert.equal(edgeText(-0.1), '比任一天進場低 0.10 個百分點');
assert.equal(edgeText(0), '和任一天進場相同');
assert.equal(edgeText(null), '無法和任一天進場比較');

// 偏多：兩段都比任一天進場好才算一致；偏空反過來
assert.equal(signalVerdict(signal('bullish', period(0.8), period(0.9)), baseline), 'both');
assert.equal(signalVerdict(signal('bullish', period(0.8), period(0.2)), baseline), 'discovery_only');
assert.equal(signalVerdict(signal('bullish', period(0.1), period(0.9)), baseline), 'validation_only');
assert.equal(signalVerdict(signal('bearish', period(-0.5), period(0.1)), baseline), 'both');
assert.equal(signalVerdict(signal('bearish', period(0.6), period(0.6)), baseline), 'neither');
assert.equal(signalVerdict(signal('bullish', period(5, MIN_SIGNAL_EVENTS - 1), period(5)), baseline), 'thin',
  'a few lucky events are not judged');
assert.equal(signalVerdict(signal('bullish', period(null), period(0.9)), baseline), 'thin');

assert.equal(dayBefore('2025-01-01'), '2024-12-31');
assert.equal(dayBefore('2024-03-01'), '2024-02-29');

assert.equal(firedText({ trading_days_ago: 0, fired_on: '2025-06-10' }), '判斷日當天成立');
assert.equal(firedText({ trading_days_ago: 3, fired_on: '2025-06-05' }), '3 個交易日前成立（2025-06-05）');
assert.equal(historyText({ events: 0 }, 5), '還沒有已到期的紀錄');
assert.equal(historyText({ events: 412, avg_return_pct: -0.71, up_rate: 0.5712, beat_market_rate: 0.55 }, 5),
  '412 次，之後第 5 個交易日平均 −0.71%，上漲 57%、贏大盤 55%', 'minus is U+2212 like the rest of the site');

console.log('Signal check passed: edge vs any day, verdicts with sample floor, period labels, evidence copy.');
