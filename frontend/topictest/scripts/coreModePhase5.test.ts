import assert from 'node:assert/strict';

import { buildMlSettingsPayload, collectMlValidationWarnings } from '../lib/coreModeMlValidation';
import type { CoreModeMlValidation } from '../lib/types/coreMode';

function run(): void {
  const payload = buildMlSettingsPayload({
    enabled: true,
    enable_model_training: true,
    enable_candidate_ranking: true,
    n_splits: 5,
    test_size: 40,
    gap: 20,
    prediction_horizon: 20,
    target_mode: 'future_quality',
    model_type: 'random_forest',
    candidate_ranking_model_type: 'gradient_boosting',
    candidate_ranking_score_mode: 'balanced_score',
    candidate_ranking_top_n: 99,
    future_quality_threshold: 0.55,
    max_train_size: '200',
  });

  assert.equal(payload.enable_candidate_ranking, true);
  assert.equal(payload.candidate_ranking_model_type, 'gradient_boosting');
  assert.equal(payload.candidate_ranking_score_mode, 'balanced_score');
  assert.equal(payload.candidate_ranking_top_n, 20);

  const validation: CoreModeMlValidation = {
    enabled: true,
    mode: 'time_series_split_rule_based',
    warnings: ['rule warning'],
    ml_model_validation: {
      enabled: true,
      warnings: ['model warning'],
    },
    ml_candidate_ranking: {
      enabled: true,
      model_type: 'random_forest',
      score_mode: 'balanced_score',
      top_n: 5,
      candidate_count: 12,
      ranked_candidates: [
        {
          rank: 1,
          predicted_score: 0.72,
          verified_score: 0.68,
          verified_summary: {
            ac: 0.61,
            cumulative_return: 0.16,
            max_drawdown: -0.09,
            trade_count: 18,
            win_rate: 0.57,
          },
          params: {},
          warnings: ['candidate warning'],
        },
      ],
      warnings: ['ranking warning'],
    },
  };

  const warnings = collectMlValidationWarnings(validation);
  assert.deepEqual(warnings, ['rule warning', 'model warning', 'ranking warning', 'candidate warning']);
}

run();
console.log('coreModePhase5 frontend checks passed');

