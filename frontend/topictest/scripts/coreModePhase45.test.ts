import assert from 'node:assert/strict';

import { collectMlValidationWarnings, normalizeFeatureImportanceItems } from '../lib/coreModeMlValidation';
import type { CoreModeMlValidation } from '../lib/types/coreMode';

function run(): void {
  const aggregatedValidation: CoreModeMlValidation = {
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
        accuracy_mean: 0.66,
        accuracy_std: 0.03,
        precision_mean: 0.64,
        recall_mean: 0.62,
        f1_mean: 0.63,
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
        {
          feature: 'trend_score',
          importance: 0.21,
          importance_mean: 0.21,
          importance_std: 0.04,
          fold_count: 3,
        },
      ],
      warnings: ['model warning'],
    },
  };

  const normalizedAggregated = normalizeFeatureImportanceItems(aggregatedValidation);
  assert.equal(normalizedAggregated.length, 1);
  assert.equal(normalizedAggregated[0].feature, 'trend_score');
  assert.equal(normalizedAggregated[0].importance_mean, 0.21);
  assert.equal(normalizedAggregated[0].importance_std, 0.04);
  assert.equal(normalizedAggregated[0].fold_count, 3);

  const legacyValidation: CoreModeMlValidation = {
    ...aggregatedValidation,
    ml_model_validation: {
      ...aggregatedValidation.ml_model_validation!,
      feature_importance: [{ feature: 'state_score', importance: 0.19 }],
      warnings: ['legacy warning'],
    },
  };
  const normalizedLegacy = normalizeFeatureImportanceItems(legacyValidation);
  assert.equal(normalizedLegacy.length, 1);
  assert.equal(normalizedLegacy[0].importance_mean, 0.19);
  assert.equal(normalizedLegacy[0].importance_std, 0);
  assert.equal(normalizedLegacy[0].fold_count, 1);

  const warnings = collectMlValidationWarnings(legacyValidation);
  assert.deepEqual(warnings, ['rule warning', 'legacy warning']);
  assert.equal(legacyValidation.ml_model_validation?.metrics?.fold_count, 3);
  assert.equal(legacyValidation.ml_model_validation?.fold_metrics?.[0]?.confusion_matrix?.length, 2);
}

run();
console.log('coreModePhase45 frontend checks passed');
