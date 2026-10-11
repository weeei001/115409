import assert from 'node:assert/strict';
import type { SignalPeriodStats, SignalStats } from '../types/api';
import { dayBefore, firedText, historyText, MIN_SIGNAL_EVENTS, MIN_SIGNAL_MONTHS, peersText, periodReading, signalVerdict, thinReason } from './signalCheck';

const period = (gap: number | null, margin: number | null = 0.4, events = 40, months = 8): SignalPeriodStats => ({
  events, months, avg_return_pct: 0.5, vs_peers_pct: gap, vs_peers_margin_pct: margin,
});
const signal = (reading: 'bullish' | 'bearish', early: SignalPeriodStats, late: SignalPeriodStats): SignalStats => ({
  key: 'k', label: 'k', definition: '', reading, source: '', discovery: early, validation: late, pending: 0,
});

assert.equal(peersText(period(0.11, 0.48)), '比同期其他股票高 0.11 個百分點（誤差 ±0.48）');
assert.equal(peersText(period(-0.3, null)), '比同期其他股票低 0.30 個百分點', 'one month: no range to show');
assert.equal(peersText(period(null)), '沒有同期其他股票可以比較');

assert.equal(thinReason(period(1)), null);
assert.equal(thinReason(period(1, 0.4, MIN_SIGNAL_EVENTS - 1)), `不到 ${MIN_SIGNAL_EVENTS} 次`);
assert.equal(thinReason(period(1, 0.4, 400, MIN_SIGNAL_MONTHS - 1)), `不到 ${MIN_SIGNAL_MONTHS} 個月`,
  'hundreds of events in a few months are still a few market stretches');

// 誤差範圍整段在一般解讀那一側才算一致，整段在另一側算相反，跨過 0 分不出差別
assert.equal(periodReading(period(0.5, 0.4), 'bullish'), 'agrees');
assert.equal(periodReading(period(0.3, 0.4), 'bullish'), 'unclear', 'a positive average inside the margin is not evidence');
assert.equal(periodReading(period(-0.5, 0.4), 'bullish'), 'opposes');
assert.equal(periodReading(period(-0.5, 0.4), 'bearish'), 'agrees');
assert.equal(periodReading(period(0.5, null), 'bullish'), null);

assert.equal(signalVerdict(signal('bullish', period(0.8), period(0.9))), 'both');
assert.equal(signalVerdict(signal('bullish', period(0.8), period(0.2))), 'discovery_only');
assert.equal(signalVerdict(signal('bullish', period(0.1), period(0.9))), 'validation_only');
assert.equal(signalVerdict(signal('bearish', period(-0.6), period(-0.9))), 'both');
assert.equal(signalVerdict(signal('bullish', period(0.1), period(-0.2))), 'unclear');
assert.equal(signalVerdict(signal('bearish', period(0.6), period(0.1))), 'opposes');
assert.equal(signalVerdict(signal('bearish', period(0.6), period(0.9))), 'both_oppose', 'both periods clearly against the reading');
assert.equal(signalVerdict(signal('bullish', period(0.8), period(-0.9))), 'mixed');
assert.equal(signalVerdict(signal('bullish', period(5, 0.4, MIN_SIGNAL_EVENTS - 1), period(5))), 'thin',
  'a few lucky events are not judged');
assert.equal(signalVerdict(signal('bullish', period(null), period(0.9))), 'thin');

assert.equal(dayBefore('2025-01-01'), '2024-12-31');
assert.equal(dayBefore('2024-03-01'), '2024-02-29');

assert.equal(firedText({ trading_days_ago: 0, fired_on: '2025-06-10' }), '判斷日當天成立');
assert.equal(firedText({ trading_days_ago: 3, fired_on: '2025-06-05' }), '3 個交易日前成立（2025-06-05）');
assert.equal(historyText({ events: 0 }, 5), '還沒有已到期的紀錄');
assert.equal(historyText({ events: 412, avg_return_pct: -0.71, up_rate: 0.5712 }, 5),
  '412 次，之後第 5 個交易日平均 −0.71%，上漲 57%', 'minus is U+2212 like the rest of the site');

console.log('Signal check passed: gap vs other stocks with margin, sample floors, verdicts by range, evidence copy.');
