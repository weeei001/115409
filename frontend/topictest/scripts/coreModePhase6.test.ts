import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildMlSettingsPayload, toWarningBadgeItems } from '../lib/coreModeMlValidation';

function run(): void {
  const payload = buildMlSettingsPayload({
    enabled: true,
    enable_model_training: false,
    enable_candidate_ranking: false,
    n_splits: 4,
    test_size: 40,
    gap: 20,
    prediction_horizon: 20,
    target_mode: 'future_quality',
    model_type: 'random_forest',
    candidate_ranking_model_type: 'random_forest',
    candidate_ranking_score_mode: 'balanced_score',
    candidate_ranking_top_n: 5,
    future_quality_threshold: 0.55,
    max_train_size: '',
  });
  assert.equal(payload.enable_candidate_ranking, false);
  assert.equal(payload.enable_model_training, false);

  const badges = toWarningBadgeItems([
    '尚未啟用功能',
    '樣本不足，可能不穩定',
    '模型訓練失敗',
  ]);
  assert.deepEqual(
    badges.map((item) => item.level),
    ['info', 'warning', 'danger']
  );

  const pageSource = fs.readFileSync(path.resolve(__dirname, '../pages/core-mode.tsx'), 'utf-8');
  const weightPanelSource = fs.readFileSync(path.resolve(__dirname, '../components/core-mode/CoreModeWeightPanel.tsx'), 'utf-8');

  assert.equal(pageSource.includes('啟用 ML candidate ranking'), true);
  assert.equal(pageSource.includes('ML 驗證細節'), true);
  assert.equal(pageSource.includes('自動套用 top1'), false);
  assert.equal(pageSource.includes('覆蓋 system preset'), false);
  assert.equal(weightPanelSource.includes('trend_shape_score 權重'), true);
}

run();
console.log('coreModePhase6 frontend checks passed');
