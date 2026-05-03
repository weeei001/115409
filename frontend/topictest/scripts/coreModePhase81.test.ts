import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildAutoSearchRecommendationSummary,
  buildAutoSearchRecommendationTagStats,
  buildAutoSearchRecommendationTags,
  dedupeAutoSearchResultsForDisplay,
  localizeAutoSearchSourceTags,
  type AutoSearchResultItem,
} from '../lib/coreModeMlValidation';

function buildResult(options: {
  rank: number;
  predicted_score: number | null;
  verified_score: number | null;
  cross_stock_score: number | null;
  cumulative_return: number | null;
  max_drawdown: number | null;
  stability_score: number | null;
  trade_count: number | null;
  source_tags: string[];
}): AutoSearchResultItem {
  return {
    rank: options.rank,
    predicted_score: options.predicted_score,
    verified_score: options.verified_score,
    cross_stock_score: options.cross_stock_score,
    params: {},
    source_tags: options.source_tags,
    summary: {
      ac: 0.5,
      cumulative_return: options.cumulative_return,
      max_drawdown: options.max_drawdown,
      trade_count: options.trade_count,
      stability_score: options.stability_score,
      holdout_score: 0.4,
    },
    symbol_results: [],
    warnings: [],
  };
}

function run(): void {
  const sampleResults: AutoSearchResultItem[] = [
    buildResult({
      rank: 1,
      predicted_score: 0.74,
      verified_score: 0.91,
      cross_stock_score: 0.87,
      cumulative_return: 0.5,
      max_drawdown: 0.12,
      stability_score: 0.88,
      trade_count: 12,
      source_tags: ['coarse_grid', 'active_base'],
    }),
    buildResult({
      rank: 2,
      predicted_score: 0.79,
      verified_score: 0.91,
      cross_stock_score: 0.84,
      cumulative_return: 0.5,
      max_drawdown: 0.12,
      stability_score: 0.88,
      trade_count: 12,
      source_tags: ['random_perturbation'],
    }),
    buildResult({
      rank: 3,
      predicted_score: 0.73,
      verified_score: 0.89,
      cross_stock_score: 0.85,
      cumulative_return: 0.8944,
      max_drawdown: 0.2,
      stability_score: 0.75,
      trade_count: 8,
      source_tags: ['local_variation'],
    }),
    buildResult({
      rank: 4,
      predicted_score: 0.71,
      verified_score: 0.88,
      cross_stock_score: 0.9,
      cumulative_return: 0.61,
      max_drawdown: 0.1124,
      stability_score: 0.9621,
      trade_count: 15,
      source_tags: ['technical_profile'],
    }),
  ];

  const deduped = dedupeAutoSearchResultsForDisplay(sampleResults);
  assert.equal(deduped.results.length, 3);
  assert.equal(deduped.mergedCount, 1);
  assert.deepEqual(
    deduped.results.map((item) => item.rank),
    [1, 3, 4]
  );

  const localizedTags = localizeAutoSearchSourceTags(['coarse_grid', 'state_trend_variation', 'unknown_tag']);
  assert.deepEqual(localizedTags, ['系統粗搜尋', '狀態/趨勢微調', 'unknown_tag']);

  const summary = buildAutoSearchRecommendationSummary(deduped.results);
  assert.equal(summary.primary?.rank, 1);
  const highestReturnAlternative = summary.alternatives.find((item) => item.kind === 'highest_return');
  const lowestDrawdownAlternative = summary.alternatives.find((item) => item.kind === 'lowest_drawdown');
  const highestStabilityAlternative = summary.alternatives.find((item) => item.kind === 'highest_stability');
  assert.equal(highestReturnAlternative?.result.rank, 3);
  assert.equal(lowestDrawdownAlternative?.result.rank, 4);
  assert.equal(highestStabilityAlternative?.result.rank, 4);

  const stats = buildAutoSearchRecommendationTagStats(deduped.results);
  const rank1Tags = buildAutoSearchRecommendationTags(deduped.results[0], stats, 10);
  const rank3Tags = buildAutoSearchRecommendationTags(deduped.results[1], stats, 10);
  assert.equal(rank1Tags.includes('綜合最佳'), true);
  assert.equal(rank1Tags.includes('交易充足'), true);
  assert.equal(rank1Tags.length <= 3, true);
  assert.equal(rank3Tags.includes('高報酬'), true);
  assert.equal(rank3Tags.includes('注意回撤'), true);
  assert.equal(rank3Tags.includes('交易偏少'), true);
  assert.equal(rank3Tags.length <= 3, true);

  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');
  assert.equal(pageSource.includes('搜尋結果推薦摘要'), true);
  assert.equal(pageSource.includes('首選 Rank'), true);
  assert.equal(pageSource.includes('建議先用首選參數重新回測，切換到「正式回測確認」重新回測，再決定是否儲存或設為啟用。'), true);

  assert.equal(pageSource.includes('排名'), true);
  assert.equal(pageSource.includes('來源'), true);
  assert.equal(pageSource.includes('ML預估'), true);
  assert.equal(pageSource.includes('正式驗證'), true);
  assert.equal(pageSource.includes('多股泛用分數'), true);
  assert.equal(pageSource.includes('累積報酬'), true);
  assert.equal(pageSource.includes('最大回撤'), true);
  assert.equal(pageSource.includes('穩定度'), true);
  assert.equal(pageSource.includes('交易次數'), true);
  assert.equal(pageSource.includes('推薦標籤'), true);
  assert.equal(pageSource.includes('提醒'), true);

  assert.equal(pageSource.includes("{item.rank === 1 ? '用首選重新回測' : '用此參數重新回測'}"), true);
  assert.equal(pageSource.includes('已合併 {autoSearchMergedCount} 筆結果相同的候選參數。'), true);

  const loadHandlerMatch = pageSource.match(/const handleLoadAutoSearchParams = \([\s\S]*?\n  \};/);
  assert.ok(loadHandlerMatch, 'missing handleLoadAutoSearchParams');
  const loadHandlerBody = loadHandlerMatch[0];
  assert.equal(loadHandlerBody.includes('const next = patchParams(params, partial);'), true);
  assert.equal(loadHandlerBody.includes('setParams(next);'), true);
  assert.equal(loadHandlerBody.includes('runCoreModeBacktest'), false);
}

run();
console.log('coreModePhase81 checks passed');
