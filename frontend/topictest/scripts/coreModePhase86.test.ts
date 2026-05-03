import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  const requiredCheckboxLabels = [
    '\u4f7f\u7528 ML \u9810\u7be9',
    '\u4f7f\u7528 TimeSeriesSplit \u7a69\u5b9a\u6027\u9a57\u8b49',
    '\u4f7f\u7528 Holdout \u9a57\u8b49',
    '\u5f37\u5236\u6700\u4f4e\u4ea4\u6613\u6b21\u6578',
    '\u555f\u7528\u81ea\u9069\u61c9\u641c\u5c0b',
    '\u555f\u7528 Final Holdout \u672a\u77e5\u5340\u9a57\u8b49',
  ];
  for (const label of requiredCheckboxLabels) {
    assert.equal(pageSource.includes(label), true, `\u7f3a\u5c11 checkbox \u6587\u6848\uff1a${label}`);
  }

  const hiddenNumericFieldNames = [
    'candidate_pool_size',
    'ml_prefilter_top_n',
    'final_verify_top_n',
    'max_iterations',
    'candidates_per_iteration',
    'verify_top_n_per_iteration',
    'keep_elite_n',
    'patience',
    'min_improvement',
    'train_ratio',
    'validation_ratio',
    'final_holdout_ratio',
    'min_final_holdout_days',
  ];
  const mainFormMatch = pageSource.match(
    /<h2 className="text-base font-bold">\u81ea\u52d5\u627e\u6700\u4f73\u53c3\u6578<\/h2>([\s\S]*?)\u958b\u59cb\u81ea\u52d5\u641c\u5c0b\u6700\u4f73\u53c3\u6578/
  );
  assert.ok(mainFormMatch, '\u627e\u4e0d\u5230\u81ea\u52d5\u641c\u5c0b\u4e3b\u8868\u55ae\u5340\u584a');
  const mainForm = mainFormMatch[1];
  for (const fieldName of hiddenNumericFieldNames) {
    assert.equal(mainForm.includes(fieldName), false, `\u4e3b\u8868\u55ae\u4ecd\u66b4\u9732\u6280\u8853\u6b04\u4f4d\uff1a${fieldName}`);
  }

  assert.equal(pageSource.includes('<option value="standard">\u6a19\u6e96</option>'), true);
  assert.equal(pageSource.includes('<option value="precise">\u7cbe\u6e96</option>'), true);
  assert.equal(pageSource.includes('<option value="deep">\u6df1\u5ea6</option>'), true);

  assert.equal(pageSource.includes('candidate_pool_size: 150'), true);
  assert.equal(pageSource.includes('ml_prefilter_top_n: 40'), true);
  assert.equal(pageSource.includes('final_verify_top_n: 15'), true);
  assert.equal(pageSource.includes('candidate_pool_size: 300'), true);
  assert.equal(pageSource.includes('ml_prefilter_top_n: 80'), true);
  assert.equal(pageSource.includes('final_verify_top_n: 30'), true);
  assert.equal(pageSource.includes('candidate_pool_size: 800'), true);
  assert.equal(pageSource.includes('ml_prefilter_top_n: 200'), true);
  assert.equal(pageSource.includes('final_verify_top_n: 60'), true);

  assert.equal(pageSource.includes('candidate_pool_size: autoSearchCandidatePoolSize,'), true);
  assert.equal(pageSource.includes('ml_prefilter_top_n: autoSearchMlPrefilterTopN,'), true);
  assert.equal(pageSource.includes('final_verify_top_n: autoSearchFinalVerifyTopN,'), true);
  assert.equal(pageSource.includes('adaptive_search_settings: {'), true);
  assert.equal(pageSource.includes('final_holdout_settings: {'), true);
  assert.equal(pageSource.includes('const [autoSearchTrainRatio, setAutoSearchTrainRatio] = useState(0.6);'), true);
  assert.equal(pageSource.includes('const [autoSearchValidationRatio, setAutoSearchValidationRatio] = useState(0.2);'), true);
  assert.equal(pageSource.includes('const [autoSearchFinalHoldoutRatio, setAutoSearchFinalHoldoutRatio] = useState(0.2);'), true);
  assert.equal(pageSource.includes('Final Holdout 分割（預設 60/20/20）：'), true);

  assert.equal(pageSource.includes('Train ${(autoSearchTrainRatio * 100).toFixed(0)}% / Validation ${(autoSearchValidationRatio * 100).toFixed('), true);
  assert.equal(pageSource.includes('ML \u9810\u7be9\u53ea\u7528\u4f86\u7e2e\u5c0f\u5019\u9078\u7bc4\u570d\uff0c\u6700\u7d42\u4ecd\u4ee5 validation_score \u6392\u540d\u3002'), true);
  assert.equal(pageSource.includes('Final Holdout \u662f\u6700\u5f8c\u672a\u77e5\u5340\u9a57\u8b49\uff0c\u4e0d\u53c3\u8207 validation_score \u6392\u540d\u3002'), true);
  assert.equal(
    pageSource.includes('\u4e00\u822c\u4f7f\u7528\u8005\u4e0d\u9700\u8981\u624b\u52d5\u8abf\u6574\u53c3\u6578\uff1b\u7cfb\u7d71\u6703\u4f9d\u64da\u52fe\u9078\u7684\u9a57\u8b49\u65b9\u5f0f\u8207\u641c\u5c0b\u54c1\u8cea\u81ea\u52d5\u8a2d\u5b9a\u7d30\u7bc0\u3002'),
    true
  );
}

run();
console.log('coreModePhase86 checkbox-only auto search ui prompt checks passed');
