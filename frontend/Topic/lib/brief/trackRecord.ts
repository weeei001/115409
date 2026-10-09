import type { TrackRecordHorizon, TrackRecordOutcome } from '../types/api';
import type { ForwardViewKey } from '../types/textBrief';
import { fmtPercent } from '../utils/format';
import { FORWARD_VIEWS } from './textBriefLabels';

/** 區間標籤和 AI 摘要的前瞻區間同一組字（短線 1–5 日…） */
export const HORIZON_LABEL = Object.fromEntries(FORWARD_VIEWS) as Record<ForwardViewKey, string>;

/** 少於這麼多次方向判斷時不下結論：幾次猜對猜錯看不出 AI 有沒有用 */
export const MIN_TRACK_RECORD_SAMPLES = 10;

export const TRACK_RESULT_LABEL: Record<TrackRecordOutcome['result'], string> = {
  hit: '命中',
  miss: '未命中',
  no_call: '未表態',
  pending: '未到期',
};

export const hasEnoughSamples = (horizon: TrackRecordHorizon): boolean =>
  horizon.directional_calls >= MIN_TRACK_RECORD_SAMPLES;

/** 命中率讀數：「58.3%」；沒有已到期的方向判斷時「--」 */
export function hitRateText(horizon: TrackRecordHorizon): string {
  return fmtPercent(horizon.hit_rate, { fromRatio: true, decimals: 1 });
}

/** 讀數下的一行：樣本數，以及和「每次都猜漲」的比較 */
export function hitRateSummary(horizon: TrackRecordHorizon): string {
  const n = horizon.directional_calls;
  if (n === 0) {
    return horizon.pending > 0 ? `還沒有到期的方向判斷（${horizon.pending} 次未到期）` : '還沒有可以評分的方向判斷';
  }
  const counts = `${n} 次方向判斷中命中 ${horizon.hits} 次`;
  if (n < MIN_TRACK_RECORD_SAMPLES) return `${counts}；樣本不到 ${MIN_TRACK_RECORD_SAMPLES} 次，先不下結論`;
  if (horizon.hit_rate == null || horizon.up_baseline_rate == null) return counts;
  // 以四捨五入後的百分點比較，畫面上的兩個數字和這句話才對得起來
  const gap = Math.round(horizon.hit_rate * 1000) / 10 - Math.round(horizon.up_baseline_rate * 1000) / 10;
  const baseline = fmtPercent(horizon.up_baseline_rate, { fromRatio: true, decimals: 1 });
  if (Math.abs(gap) < 0.05) return `${counts}；和每次都猜漲（${baseline}）相同`;
  return `${counts}；比每次都猜漲（${baseline}）${gap > 0 ? '高' : '低'} ${Math.abs(gap).toFixed(1)} 個百分點`;
}
