import assert from 'node:assert/strict';

import { buildMlSettingsPayload, collectMlValidationWarnings } from '../lib/coreModeMlValidation';
import type { CoreModeMlValidation } from '../lib/types/coreMode';

function run(): void {
  const payload = buildMlSettingsPayload({
    enabled: true,
    enable_model_training: true,
    n_splits: 4,
    test_size: 40,
    gap: 20,
    prediction_horizon: 20,
    target_mode: 'future_quality',
    model_type: 'logistic_regression',
    future_quality_threshold: 0.6,
    max_train_size: '160',
  });

  assert.equal(payload.enable_model_training, true);
  assert.equal(payload.model_type, 'logistic_regression');
  assert.equal(payload.max_train_size, 160);

  const validation: CoreModeMlValidation = {
    enabled: true,
    mode: 'time_series_split_rule_based',
    n_splits: 4,
    test_size: 40,
    gap: 20,
    effective_gap: 20,
    prediction_horizon: 20,
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
    warnings: ['rule warning'],
    ml_model_validation: {
      enabled: true,
      model_type: 'random_forest',
      target_mode: 'future_quality',
      metrics: {
        accuracy_mean: 0.63,
        accuracy_std: 0.04,
        precision_mean: 0.61,
        recall_mean: 0.59,
        f1_mean: 0.6,
        fold_count: 3,
      },
      fold_metrics: [
        {
          fold_index: 1,
          train_start: '2024-01-01',
          train_end: '2024-05-01',
          test_start: '2024-05-22',
          test_end: '2024-07-01',
          sample_count: 40,
          positive_count: 23,
          negative_count: 17,
          accuracy: 0.65,
          precision: 0.64,
          recall: 0.61,
          f1: 0.62,
          confusion_matrix: [
            [10, 7],
            [7, 16],
          ],
        },
      ],
      feature_importance: [
        { feature: 'trend_score', importance: 0.21 },
        { feature: 'state_score', importance: 0.19 },
      ],
      warnings: ['model warning'],
    },
  };

  const warnings = collectMlValidationWarnings(validation);
  assert.deepEqual(warnings, ['rule warning', 'model warning']);
  assert.equal(validation.ml_model_validation?.metrics?.fold_count, 3);
  assert.equal(validation.ml_model_validation?.feature_importance?.length, 2);
}

run();
console.log('coreModePhase4 frontend checks passed');
