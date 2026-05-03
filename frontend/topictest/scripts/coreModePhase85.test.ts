import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  const splitTitle = '\u4e09\u6bb5\u5f0f\u8cc7\u6599\u5207\u5206 / Final Holdout Unknown Zone';
  const splitExplain =
    'TimeSeriesSplit \u662f\u591a\u500b fold \u7684\u7a69\u5b9a\u6027\u9a57\u8b49\uff1bFinal Holdout \u662f\u6700\u5f8c\u5b8c\u5168\u4fdd\u7559\u7684\u672a\u77e5\u5340\uff0c\u53ea\u5728 Top N \u78ba\u5b9a\u5f8c\u624d\u7528\u65bc\u6700\u7d42\u9a57\u8b49\u3002\u5169\u8005\u4e0d\u540c\u3002';
  const rankingExplain =
    '\u6392\u540d\u4f9d\u64da\u70ba validation_score\uff1bfinal_holdout_score \u50c5\u4f5c\u70ba\u672a\u77e5\u5340\u89c0\u5bdf\uff0c\u4e0d\u6703\u56de\u6d41\u5f71\u97ff Rank\u3002';
  const tssSubtitle =
    'TimeSeriesSplit \u7d50\u679c\uff08\u7a69\u5b9a\u6027\u9a57\u8b49\uff0c\u4e0d\u662f Final Holdout \u4e09\u6bb5\u5f0f\u5207\u5206\uff09';
  const emptyState =
    '\u5c1a\u672a\u53d6\u5f97 Final Holdout \u4e09\u6bb5\u5f0f\u5207\u5206\u8cc7\u8a0a\u3002\u8acb\u5148\u5728\u300c\u81ea\u52d5\u627e\u6700\u4f73\u53c3\u6578\u300d\u57f7\u884c\u641c\u5c0b\uff0c\u6216\u78ba\u8a8d final holdout \u5df2\u555f\u7528\u3002';
  const compatibilityExplain =
    'verified_score \u70ba\u820a\u76f8\u5bb9\u6b04\u4f4d\uff0c\u76ee\u524d\u8a9e\u610f\u7b49\u540c validation_score\uff1bfinal_holdout_score \u4e0d\u53c3\u8207\u6392\u5e8f\u3002';

  assert.equal(pageSource.includes(splitTitle), true);
  assert.equal(pageSource.includes('Train'), true);
  assert.equal(pageSource.includes('Validation'), true);
  assert.equal(pageSource.includes('Final Holdout'), true);

  assert.equal(pageSource.includes('split_summary.train_start'), true);
  assert.equal(pageSource.includes('split_summary.train_end'), true);
  assert.equal(pageSource.includes('split_summary.train_count'), true);
  assert.equal(pageSource.includes('split_summary.validation_start'), true);
  assert.equal(pageSource.includes('split_summary.validation_end'), true);
  assert.equal(pageSource.includes('split_summary.validation_count'), true);
  assert.equal(pageSource.includes('split_summary.final_holdout_start'), true);
  assert.equal(pageSource.includes('split_summary.final_holdout_end'), true);
  assert.equal(pageSource.includes('split_summary.final_holdout_count'), true);

  assert.equal(pageSource.includes(splitExplain), true);
  assert.equal(pageSource.includes(rankingExplain), true);
  assert.equal(pageSource.includes(tssSubtitle), true);
  assert.equal(pageSource.includes(emptyState), true);

  assert.equal(pageSource.includes('validation_score（verified_score 相容欄位）'), true);
  assert.equal(pageSource.includes('final_holdout_score'), true);
  assert.equal(pageSource.includes(compatibilityExplain), true);
}

run();
console.log('coreModePhase85 final holdout split summary ui checks passed');
