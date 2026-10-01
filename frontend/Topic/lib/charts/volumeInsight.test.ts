import assert from 'node:assert/strict';
import { buildVolumeInsight } from './volumeInsight';

const history: Array<{ date: string; volume_shares: number | null }> = [];
for (let day = new Date('2026-05-01T00:00:00Z'); history.length < 80; day.setUTCDate(day.getUTCDate() + 1)) {
  if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) history.push({ date: day.toISOString().slice(0, 10), volume_shares: history.length + 1 });
}
const end = history[79].date;
const insight = buildVolumeInsight(history, end);
// Independent arithmetic-series expectations for values 61..80 and 21..80.
assert.equal(insight.ma20, 70.5);
assert.equal(insight.ma60, 50.5);
assert.equal(insight.latestVolume, 80);
assert.equal(insight.vsMa20, (80 - 70.5) / 70.5 * 100);
assert.deepEqual(buildVolumeInsight([...history].reverse(), end), insight);
assert.deepEqual(buildVolumeInsight(history.slice(-60), end), insight);
assert.equal(buildVolumeInsight(history.slice(-18), end).ma20, null);
assert.equal(buildVolumeInsight(history.slice(-18), end).ma60, null);
assert.equal(buildVolumeInsight(history.slice(-20), end).ma20, 70.5);
assert.equal(buildVolumeInsight(history.slice(-20), end).ma60, null);
assert.equal(buildVolumeInsight([], end).latestVolume, null);
assert.equal(buildVolumeInsight(history, '2026-01-01').date, null);

// An end date on the following weekend cannot add artificial trading days.
const friday = history.findLast((row) => new Date(row.date).getUTCDay() === 5)!;
const weekend = new Date(friday.date);
weekend.setUTCDate(weekend.getUTCDate() + 2);
assert.deepEqual(buildVolumeInsight(history, weekend.toISOString().slice(0, 10)), buildVolumeInsight(history, friday.date));
const missing = history.map((row, index) => ({ ...row, volume_shares: index === 79 ? null : row.volume_shares }));
assert.equal(buildVolumeInsight(missing, end).ma20, null);
assert.equal(buildVolumeInsight(missing, end).count20, 19);
assert.equal(buildVolumeInsight(missing, end).latestVolume, null);
assert.equal(buildVolumeInsight(missing, end).vsMa20, null);
assert.equal(buildVolumeInsight(history.map((row, index) => ({ ...row, volume_shares: index === 30 ? null : row.volume_shares })), end).ma20, 70.5);
for (const invalid of [NaN, Infinity, -1]) {
  assert.equal(buildVolumeInsight(history.map((row, index) => ({ ...row, volume_shares: index === 79 ? invalid : row.volume_shares })), end).ma20, null);
}
const zero = buildVolumeInsight(history.map((row) => ({ ...row, volume_shares: 0 })), end);
assert.equal(zero.ma20, 0);
assert.equal(zero.ma60, 0);
assert.equal(zero.vsMa20, null);
assert.equal(buildVolumeInsight(history.map((row, index) => ({ ...row, volume_shares: index === 79 ? 0 : 100 })), end).vsMa20, -100);
console.log('Fixed volume windows passed: full trading-day samples, independent arithmetic, weekends, missing/invalid data, and zero volume.');
