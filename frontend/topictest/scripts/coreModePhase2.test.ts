import assert from 'node:assert/strict';

import { buildMlSettingsPayload } from '../lib/coreModeMlValidation';
import type { CoreModeMlValidation } from '../lib/types/coreMode';

function run(): void {
  const payload = buildMlSettingsPayload({
    enabled: true,
    enable_model_training: false,
    n_splits: 5,
    test_size: 60,
    gap: 10,
    prediction_horizon: 20,
    target_mode: 'future_quality',
    model_type: 'random_forest',
    future_quality_threshold: 0.55,
    max_train_size: '180',
  });

  assert.equal(payload.enabled, true);
  assert.equal(payload.n_splits, 5);
  assert.equal(payload.test_size, 60);
  assert.equal(payload.gap, 10);
  assert.equal(payload.prediction_horizon, 20);
  assert.equal(payload.target_mode, 'future_quality');
  assert.equal(payload.future_quality_threshold, 0.55);
  assert.equal(payload.max_train_size, 180);

  const payloadWithoutMaxTrain = buildMlSettingsPayload({
    enabled: false,
    enable_model_training: true,
    n_splits: 1,
    test_size: 0,
    gap: -2,
    prediction_horizon: 0,
    target_mode: 'trade_return',
    model_type: 'logistic_regression',
    future_quality_threshold: 1.3,
    max_train_size: '',
  });
  assert.equal(payloadWithoutMaxTrain.enabled, false);
  assert.equal(payloadWithoutMaxTrain.n_splits, 2);
  assert.equal(payloadWithoutMaxTrain.test_size, 1);
  assert.equal(payloadWithoutMaxTrain.gap, 0);
  assert.equal(payloadWithoutMaxTrain.prediction_horizon, 1);
  assert.equal(payloadWithoutMaxTrain.target_mode, 'future_quality');
  assert.equal(payloadWithoutMaxTrain.future_quality_threshold, 1);
  assert.equal(payloadWithoutMaxTrain.max_train_size, undefined);

  const sampleValidation: CoreModeMlValidation = {
    enabled: true,
    mode: 'time_series_split_rule_based',
    n_splits: 3,
    test_size: 40,
    gap: 20,
    effective_gap: 20,
    prediction_horizon: 20,
    fold_metrics: [
      {
        fold_index: 1,
        train_start: '2024-01-01',
        train_end: '2024-04-30',
        test_start: '2024-05-01',
        test_end: '2024-06-30',
        gap: 20,
        effective_gap: 20,
        ac: 0.61,
        win_rate: 0.54,
        cumulative_return: 0.12,
        max_drawdown: 0.08,
        trade_count: 7,
        profit_factor: 1.3,
        expectancy: 0.011,
      },
    ],
    aggregate_metrics: {
      fold_ac_mean: 0.61,
      fold_ac_std: 0.02,
      fold_return_mean: 0.1,
      fold_return_std: 0.03,
      fold_mdd_mean: 0.09,
      fold_mdd_std: 0.01,
      fold_trade_count_mean: 6.5,
      stability_score: 0.92,
    },
    warnings: ['sample warning'],
  };

  assert.equal(sampleValidation.mode, 'time_series_split_rule_based');
  assert.equal(sampleValidation.fold_metrics?.length, 1);
  assert.equal(sampleValidation.warnings[0], 'sample warning');
}

run();
console.log('coreModePhase2 frontend checks passed');
