import assert from 'node:assert/strict';
import { hitRateSummary, hitRateText, MIN_TRACK_RECORD_SAMPLES, relativeSummary } from './trackRecord';
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

assert.equal(relativeSummary(horizon({})), null, 'older responses without the market comparison show nothing');
assert.equal(relativeSummary(horizon({ relative_calls: 0, relative_hits: 0, relative_hit_rate: null })), null);
assert.equal(relativeSummary(horizon({ relative_calls: 4, relative_hits: 1, relative_hit_rate: 0.25 })),
  '相對大盤：4 次中命中 1 次', 'small samples show counts without a rate');
assert.equal(relativeSummary(horizon({ relative_calls: 12, relative_hits: 5, relative_hit_rate: 0.4167 })),
  '相對大盤：12 次中命中 5 次（41.7%）');

console.log('Track record copy passed: empty, pending, small-sample, baseline and market comparisons.');
