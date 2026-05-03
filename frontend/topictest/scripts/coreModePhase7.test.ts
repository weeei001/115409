import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import type { CoreModeRunRequest, CoreModeRunResponse } from '../lib/types/coreMode';

function run(): void {
  const request: CoreModeRunRequest = {
    symbol: '2330',
    date_range: { start_date: '2024-01-01', end_date: '2024-10-31' },
    auto_search_settings: {
      enabled: true,
      mode: 'single_stock_search',
      symbols: ['2330'],
      top_n: 10,
      candidate_pool_size: 300,
      ml_prefilter_top_n: 80,
      final_verify_top_n: 30,
      score_mode: 'balanced_score',
      use_ml_prefilter: true,
      use_time_series_validation: true,
      use_holdout_validation: true,
      require_min_trade_count: true,
      min_trade_count: 10,
      max_runtime_level: 'balanced',
    },
  };

  assert.equal(request.auto_search_settings?.enabled, true);
  assert.equal(request.auto_search_settings?.mode, 'single_stock_search');

  const response: Partial<CoreModeRunResponse> = {
    auto_search_result: {
      enabled: true,
      mode: 'single_stock_search',
      symbols: ['2330'],
      top_n: 2,
      candidate_count: 60,
      evaluated_candidate_count: 8,
      final_verified_count: 4,
      ranking_basis: 'verified_score',
      results: [
        {
          rank: 1,
          predicted_score: 0.81,
          verified_score: 0.74,
          cross_stock_score: null,
          params: {},
          source_tags: ['weighted_profile', 'local_variation'],
          summary: {
            ac: 0.62,
            cumulative_return: 0.17,
            max_drawdown: -0.09,
            trade_count: 22,
            stability_score: 0.78,
            holdout_score: 0.66,
          },
          symbol_results: [
            {
              symbol: '2330',
              success: true,
              verified_score: 0.74,
              ac: 0.62,
              cumulative_return: 0.17,
              max_drawdown: -0.09,
              trade_count: 22,
              stability_score: 0.78,
              warnings: [],
            },
          ],
          warnings: [],
        },
      ],
      warnings: ['候選參數僅供參考'],
    },
  };

  assert.equal(response.auto_search_result?.results?.[0]?.rank, 1);
  assert.equal(response.auto_search_result?.ranking_basis, 'verified_score');

  const pageSource = fs.readFileSync(path.resolve(__dirname, '../pages/core-mode.tsx'), 'utf-8');
  assert.equal(pageSource.includes('自動找最佳參數'), true);
  assert.equal(pageSource.includes('查看參數'), true);
  assert.equal(pageSource.includes('載入到表單'), true);
  assert.equal(pageSource.includes('不會自動套用'), true);
  assert.equal(pageSource.includes('不會自動儲存'), false);
}

run();
console.log('coreModePhase7 frontend checks passed');
