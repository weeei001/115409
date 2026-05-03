import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert.equal(pageSource.includes('自動找最佳參數'), true);
  assert.equal(pageSource.includes('模式'), true);
  assert.equal(pageSource.includes('股票代號'), true);
  assert.equal(pageSource.includes('回測期間（開始）'), true);
  assert.equal(pageSource.includes('回測期間（結束）'), true);
  assert.equal(pageSource.includes('搜尋目標'), true);
  assert.equal(pageSource.includes('搜尋品質'), true);
  assert.equal(pageSource.includes('輸出 Top N'), true);
  assert.equal(pageSource.includes('開始自動搜尋最佳參數'), true);

  assert.equal(pageSource.includes('使用 ML 預篩'), true);
  assert.equal(pageSource.includes('使用 TimeSeriesSplit 穩定性驗證'), true);
  assert.equal(pageSource.includes('使用 Holdout 驗證'), true);
  assert.equal(pageSource.includes('強制最低交易次數'), true);
  assert.equal(pageSource.includes('啟用自適應搜尋'), true);
  assert.equal(pageSource.includes('啟用 Final Holdout 未知區驗證'), true);

  assert.equal(
    pageSource.includes('一般使用者不需要手動調整參數；系統會依據勾選的驗證方式與搜尋品質自動設定細節。'),
    true
  );
  assert.equal(pageSource.includes('Final Holdout 是最後未知區驗證，不參與 validation_score 排名。'), true);
  assert.equal(pageSource.includes('ML 預篩只用來縮小候選範圍，最終仍以 validation_score 排名。'), true);
  assert.equal(pageSource.includes('自適應搜尋會多輪逼近最佳參數，可能需要較長時間。'), true);

  const mainFormMatch = pageSource.match(
    /<h2 className="text-base font-bold">自動找最佳參數<\/h2>([\s\S]*?)開始自動搜尋最佳參數/
  );
  assert.ok(mainFormMatch, '找不到自動搜尋主表單區塊');
  const mainForm = mainFormMatch[1];

  assert.equal(mainForm.includes('candidate_pool_size'), false);
  assert.equal(mainForm.includes('ml_prefilter_top_n'), false);
  assert.equal(mainForm.includes('final_verify_top_n'), false);
  assert.equal(mainForm.includes('max_iterations'), false);
  assert.equal(mainForm.includes('candidates_per_iteration'), false);
  assert.equal(mainForm.includes('verify_top_n_per_iteration'), false);
  assert.equal(mainForm.includes('keep_elite_n'), false);
  assert.equal(mainForm.includes('patience'), false);
  assert.equal(mainForm.includes('min_improvement'), false);
  assert.equal(mainForm.includes('train_ratio'), false);
  assert.equal(mainForm.includes('validation_ratio'), false);
  assert.equal(mainForm.includes('final_holdout_ratio'), false);
  assert.equal(mainForm.includes('min_final_holdout_days'), false);

  assert.equal(pageSource.includes('<option value="standard">標準</option>'), true);
  assert.equal(pageSource.includes('<option value="precise">精準</option>'), true);
  assert.equal(pageSource.includes('<option value="deep">深度</option>'), true);

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
}

run();
console.log('coreModePhase84 checkbox-only auto search ui checks passed');
