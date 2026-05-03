import assert from 'node:assert/strict';

import { WEIGHT_GROUPS, normalizePreview } from '../components/core-mode/CoreModeWeightPanel';
import {
  applyManualWeightChange,
  applyWeightStrategyToParams,
  CORE_PARAM_KEYS,
  detectWeightStrategy,
} from '../lib/coreModeWeights';
import type { CoreModeParams } from '../lib/types/coreMode';

function makeBaseParams(): CoreModeParams {
  return {
    breakout_lookback: 30,
    momentum_window: 20,
    state_threshold: 0.15,
    shape_threshold: 0.15,
    trend_threshold: 0.18,
    max_pullback_depth: 0.12,
    hard_stop_pct: 0.08,
    trailing_stop_pct: 0.1,
    technical_ma_weight: 0.4,
    technical_macd_weight: 0.25,
    technical_rsi_weight: 0.2,
    technical_kd_weight: 0.15,
    weighted_technical_weight: 0.38,
    weighted_institutional_weight: 0.3,
    weighted_news_weight: 0.15,
    weighted_momentum_weight: 0.17,
    state_weighted_score_weight: 0.55,
    state_momentum_weight: 0.25,
    state_institutional_weight: 0.2,
    trend_state_weight: 0.45,
    trend_shape_weight: 0.35,
    trend_breakout_weight: 0.2,
    shape_breakout_weight: 0.35,
    shape_slope_weight: 0.25,
    shape_efficiency_weight: 0.25,
    shape_pullback_weight: 0.15,
  };
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

function run(): void {
  const base = makeBaseParams();

  const shapeGroup = WEIGHT_GROUPS.find((item) => item.title === 'trend_shape_score 權重');
  assert.ok(shapeGroup, '應存在 trend_shape_score 權重群組');
  assert.deepEqual(shapeGroup?.keys, [
    'shape_breakout_weight',
    'shape_slope_weight',
    'shape_efficiency_weight',
    'shape_pullback_weight',
  ]);

  const preview = normalizePreview(
    {
      ...base,
      shape_breakout_weight: 2,
      shape_slope_weight: 2,
      shape_efficiency_weight: 0,
      shape_pullback_weight: 0,
    },
    shapeGroup!.keys
  );
  const byKey = Object.fromEntries(preview.map((item) => [item.key, item.value]));
  assert.ok(nearlyEqual(byKey.shape_breakout_weight, 0.5));
  assert.ok(nearlyEqual(byKey.shape_slope_weight, 0.5));
  assert.ok(nearlyEqual(byKey.shape_efficiency_weight, 0.0));
  assert.ok(nearlyEqual(byKey.shape_pullback_weight, 0.0));

  const edited = applyManualWeightChange(base, 'shape_breakout_weight', 0.5);
  assert.equal(edited.strategy, 'custom');
  assert.equal(edited.params.shape_breakout_weight, 0.5);

  const switched = applyWeightStrategyToParams(base, 'momentum_first');
  for (const key of CORE_PARAM_KEYS) {
    assert.equal(switched[key], base[key], `策略切換不應修改核心參數 ${String(key)}`);
  }

  assert.equal(switched.shape_breakout_weight, base.shape_breakout_weight);
  assert.equal(switched.shape_slope_weight, base.shape_slope_weight);
  assert.equal(switched.shape_efficiency_weight, base.shape_efficiency_weight);
  assert.equal(switched.shape_pullback_weight, base.shape_pullback_weight);
  assert.equal(detectWeightStrategy(switched), 'momentum_first');
}

run();
console.log('coreModePhase15 frontend checks passed');
