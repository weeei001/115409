import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type { CoreModeRunRequest } from '../lib/types/coreMode';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert.equal(pageSource.includes('自動找最佳參數'), true);
  assert.equal(pageSource.includes('正式回測確認'), true);
  assert.equal(pageSource.includes('技術驗證細節'), true);
  assert.equal(pageSource.includes('參數設定'), false);
  assert.equal(pageSource.includes("label: 'ML 驗證細節'"), false);

  const request: CoreModeRunRequest = {
    symbol: '2330',
    date_range: { start_date: '2024-01-01', end_date: '2024-12-31' },
    auto_search_settings: {
      enabled: true,
      mode: 'multi_stock_search',
      symbols: ['2330', '2317'],
      top_n: 12,
      candidate_pool_size: 300,
      ml_prefilter_top_n: 80,
      final_verify_top_n: 30,
      score_mode: 'balanced_score',
      use_ml_prefilter: true,
      use_time_series_validation: true,
      use_holdout_validation: true,
      require_min_trade_count: true,
      min_trade_count: 10,
      max_runtime_level: 'deep',
      adaptive_search_settings: {
        enabled: true,
        max_iterations: 5,
        candidates_per_iteration: 300,
        verify_top_n_per_iteration: 50,
        keep_elite_n: 10,
        patience: 2,
        min_improvement: 0.01,
        use_ml_prefilter: true,
        refinement_strength: 'medium',
      },
    },
  };
  assert.equal(request.auto_search_settings?.mode, 'multi_stock_search');
  assert.equal(request.auto_search_settings?.symbols?.length, 2);
  assert.equal(request.auto_search_settings?.max_runtime_level, 'deep');
  assert.equal(request.auto_search_settings?.adaptive_search_settings?.enabled, true);
  assert.equal(request.auto_search_settings?.adaptive_search_settings?.max_iterations, 5);

  const singleMode: CoreModeRunRequest['auto_search_settings'] = { enabled: true, mode: 'single_stock_search', symbols: ['2330'] };
  const multiMode: CoreModeRunRequest['auto_search_settings'] = { enabled: true, mode: 'multi_stock_search', symbols: ['2330', '2317'] };
  assert.equal(singleMode?.mode, 'single_stock_search');
  assert.equal(multiMode?.mode, 'multi_stock_search');

  assert.equal(pageSource.includes('predicted_score'), true);
  assert.equal(pageSource.includes('verified_score'), true);
  assert.equal(pageSource.includes('cross_stock_score'), true);
  assert.equal(pageSource.includes('source_tags'), true);
  assert.equal(pageSource.includes('啟用自適應搜尋'), true);
  assert.equal(pageSource.includes('adaptive_trace summary'), true);
  assert.equal(pageSource.includes('best_score_progression'), true);
  assert.equal(pageSource.includes('stop_reason'), true);

  const viewButtonRegex = /onClick=\{\(\) => setViewedAutoSearchParams\(\{ rank: item\.rank, params: item\.params \}\)\}/;
  assert.equal(viewButtonRegex.test(pageSource), true);

  const loadHandlerMatch = pageSource.match(/const handleLoadAutoSearchParams = \([\s\S]*?\n  \};/);
  assert.ok(loadHandlerMatch, 'missing handleLoadAutoSearchParams');
  const loadHandlerBody = loadHandlerMatch[0];
  assert.equal(loadHandlerBody.includes('const next = patchParams(params, partial);'), true);
  assert.equal(loadHandlerBody.includes('setParams(next);'), true);
  assert.equal(loadHandlerBody.includes("setActiveTab('formal_backtest');"), true);
  assert.equal(loadHandlerBody.includes('setLoadedAutoSearchParamsPendingValidation(true);'), true);
  assert.equal(loadHandlerBody.includes('setLoadedAutoSearchParamsMeta(loadedMeta);'), true);
  assert.equal(loadHandlerBody.includes('setSelectedAutoSearchResult(loadedMeta);'), true);
  assert.equal(loadHandlerBody.includes('runCoreModeBacktest'), false);
  assert.equal(loadHandlerBody.includes('saveCoreModePreset'), false);
  assert.equal(loadHandlerBody.includes('activateCoreModePreset'), false);
  assert.equal(loadHandlerBody.includes('setAutoSearchMode'), false);
  assert.equal(loadHandlerBody.includes('setMlValidationEnabled'), false);

  const runHandlerMatch = pageSource.match(/const handleRunBacktest = async \(mode: 'auto_search' \| 'formal_backtest'\) => \{([\s\S]*?)\n  \};/);
  assert.ok(runHandlerMatch, 'missing handleRunBacktest');
  const runHandlerBody = runHandlerMatch[1];
  assert.equal(runHandlerBody.includes("if (mode === 'formal_backtest' && (loadedAutoSearchParamsPendingValidation || isBacktestResultStale))"), true);
  assert.equal(runHandlerBody.includes('setLoadedAutoSearchParamsPendingValidation(false);'), true);
  assert.equal(runHandlerBody.includes('setIsBacktestResultStale(false);'), true);
  assert.equal(runHandlerBody.includes("setPresetMessage('此組參數已完成重新回測確認。');"), true);

  assert.equal(pageSource.includes('目前參數尚未重新回測確認，不建議直接儲存或啟用。仍要繼續嗎？'), true);
  assert.equal(pageSource.includes('已載入自動搜尋參數，請重新執行回測確認後再手動儲存或啟用。'), true);
  assert.equal(pageSource.includes('尚未重新回測'), true);
  assert.equal(pageSource.includes("{item.rank === 1 ? '用首選重新回測' : '用此參數重新回測'}"), true);

  assert.equal(pageSource.includes('CORE_PARAM_KEYS.map((key) => {'), false);
  assert.equal(pageSource.includes('<CoreModeWeightPanel'), false);
  assert.equal(pageSource.includes('重設為預設值'), false);
  assert.equal(pageSource.includes('權重設定'), false);
  assert.equal(pageSource.includes('onStrategyChange='), false);
  assert.equal(pageSource.includes('input type="range"'), false);

  assert.equal(pageSource.includes('TimeSeriesSplit 結果'), true);
  assert.equal(pageSource.includes('ML Dataset Summary'), true);
  assert.equal(pageSource.includes('Model Validation'), true);
  assert.equal(pageSource.includes('Candidate Ranking'), true);
}

run();
console.log('coreModePhase8 frontend checks passed');
