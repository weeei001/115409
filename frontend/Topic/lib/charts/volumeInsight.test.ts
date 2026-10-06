import assert from 'node:assert/strict';
import { buildVolumeInsight, volumeState, volumeVsMa20Text } from './volumeInsight';

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
// P1-02: the readout row and 量能狀態 share one classifier (±5% = 接近均量), so 0.9% below is never 量縮.
assert.equal(volumeVsMa20Text(99.1, 100), '接近均量（低於 20 日均量 0.9%）');
assert.equal(volumeVsMa20Text(105, 100), '接近均量（高於 20 日均量 5.0%）');
assert.equal(volumeVsMa20Text(106, 100), '量增（高於 20 日均量 6.0%）');
assert.equal(volumeVsMa20Text(93.8, 100), '量縮（低於 20 日均量 6.2%）');
assert.equal(volumeVsMa20Text(100, 100), '接近均量（與 20 日均量相差不到 0.1%）');
assert.equal(volumeVsMa20Text(100.04, 100), '接近均量（與 20 日均量相差不到 0.1%）');
for (const [volume, ma20] of [[null, 100], [100, null], [100, 0], [NaN, 100], [-1, 100]] as const) {
  assert.equal(volumeVsMa20Text(volume, ma20), '無 20 日均量可比較');
}
assert.equal(insight.state, volumeState(insight.vsMa20));
assert.equal(insight.state, '量增');
const near = buildVolumeInsight(history.map((row, index) => ({ ...row, volume_shares: index === 79 ? 99.1 : 100 })), end);
assert.equal(near.state, '接近均量');
assert.equal(volumeVsMa20Text(near.latestVolume, near.ma20).startsWith(near.state), true);
assert.equal(zero.state, '資料不足或無法比較');
console.log('Fixed volume windows passed: full trading-day samples, independent arithmetic, weekends, missing/invalid data, zero volume, and one shared 量能 label.');
