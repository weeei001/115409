import assert from 'node:assert/strict';

import { buildMlSettingsPayload, collectMlValidationWarnings, PHASE3_DATASET_NOTICE } from '../lib/coreModeMlValidation';
import type { CoreModeMlValidation } from '../lib/types/coreMode';

function run(): void {
  const payload = buildMlSettingsPayload({
    enabled: true,
    enable_model_training: false,
    n_splits: 4,
    test_size: 50,
    gap: 20,
    prediction_horizon: 15,
    max_train_size: '120',
    target_mode: 'future_quality',
    model_type: 'random_forest',
    future_quality_threshold: 0.72,
  });

  assert.equal(payload.target_mode, 'future_quality');
  assert.equal(payload.future_quality_threshold, 0.72);

  const validation: CoreModeMlValidation = {
    enabled: true,
    mode: 'time_series_split_rule_based',
    n_splits: 4,
    test_size: 50,
    gap: 20,
    effective_gap: 20,
    prediction_horizon: 15,
    fold_metrics: [],
    aggregate_metrics: {
      fold_ac_mean: 0.0,
      fold_ac_std: 0.0,
      fold_return_mean: 0.0,
      fold_return_std: 0.0,
      fold_mdd_mean: 0.0,
      fold_mdd_std: 0.0,
      fold_trade_count_mean: 0.0,
      stability_score: 0.0,
    },
    dataset_summary: {
      enabled: true,
      target_mode: 'future_quality',
      prediction_horizon: 15,
      future_quality_threshold: 0.72,
      target_warning: null,
      unsupported_target_mode: null,
      sample_count: 100,
      feature_count: 28,
      positive_count: 56,
      negative_count: 44,
      positive_rate: 0.56,
      dropped_feature_names: ['breakout_lookback', 'momentum_window'],
      feature_names: ['trend_score', 'state_score'],
      warnings: ['news_score is constant'],
    },
    warnings: ['news_score is constant', 'gap auto bumped'],
  };

  const warnings = collectMlValidationWarnings(validation);
  assert.deepEqual(warnings, ['news_score is constant', 'gap auto bumped']);
  assert.equal(validation.dataset_summary?.future_quality_threshold, 0.72);
  assert.equal(PHASE3_DATASET_NOTICE.includes('future_quality'), true);
}

run();
console.log('coreModePhase35 frontend checks passed');
