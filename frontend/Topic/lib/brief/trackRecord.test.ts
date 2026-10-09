import assert from 'node:assert/strict';
import { hitRateSummary, hitRateText, MIN_TRACK_RECORD_SAMPLES } from './trackRecord';
import type { TrackRecordHorizon } from '../types/api';

const horizon = (patch: Partial<TrackRecordHorizon>): TrackRecordHorizon => ({
  horizon: 'short_1_5', trading_days: 5, directional_calls: 0, hits: 0,
  hit_rate: null, up_baseline_rate: null, no_call: 0, pending: 0, ...patch,
});

assert.equal(hitRateText(horizon({})), '--');
assert.equal(hitRateSummary(horizon({})), '還沒有可以評分的方向判斷');
assert.equal(hitRateSummary(horizon({ pending: 3 })), '還沒有到期的方向判斷（3 次未到期）');

const few = horizon({ directional_calls: 4, hits: 3, hit_rate: 0.75, up_baseline_rate: 0.5 });
assert.equal(hitRateText(few), '75.0%');
assert.match(hitRateSummary(few), new RegExp(`樣本不到 ${MIN_TRACK_RECORD_SAMPLES} 次，先不下結論`));
assert.doesNotMatch(hitRateSummary(few), /每次都猜漲/, 'small samples are not compared with the baseline');

const better = horizon({ directional_calls: 12, hits: 7, hit_rate: 0.5833, up_baseline_rate: 0.5 });
assert.equal(hitRateSummary(better), '12 次方向判斷中命中 7 次；比每次都猜漲（50.0%）高 8.3 個百分點');
const worse = horizon({ directional_calls: 20, hits: 8, hit_rate: 0.4, up_baseline_rate: 0.55 });
assert.match(hitRateSummary(worse), /低 15\.0 個百分點$/);
const same = horizon({ directional_calls: 10, hits: 6, hit_rate: 0.6, up_baseline_rate: 0.6 });
assert.match(hitRateSummary(same), /相同$/);

console.log('Track record copy passed: empty, pending, small-sample and baseline comparisons.');
