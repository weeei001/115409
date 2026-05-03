import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert.equal(pageSource.includes('const currentBacktestSourceLabel ='), true);
  assert.equal(
    pageSource.includes('const shouldHideBacktestResult = loadedAutoSearchParamsPendingValidation || isBacktestResultStale;'),
    true
  );

  assert.equal(pageSource.includes('<p className="mt-1 font-semibold">{currentBacktestSourceLabel}</p>'), true);
  assert.equal(pageSource.includes("validation_score：{loadedAutoSearchParamsMeta?.validation_score == null ? '--' : formatNumber(loadedAutoSearchParamsMeta.validation_score)}"), true);
  assert.equal(pageSource.includes('{loadedAutoSearchParamsMeta?.cross_stock_score != null ? ('), true);
  assert.equal(pageSource.includes('final_holdout_score：'), true);
  assert.equal(pageSource.includes('loadedAutoSearchParamsMeta?.final_holdout_cross_stock_score != null ? ('), true);
  assert.equal(pageSource.includes("loaded_at：{loadedAutoSearchParamsMeta?.loaded_at ?? '--'}"), true);

  assert.equal(pageSource.includes('{shouldHideBacktestResult ? ('), true);
  assert.equal(pageSource.includes("if (loadedAutoSearchParamsPendingValidation || isBacktestResultStale)"), true);
  assert.equal(pageSource.includes("setCurrentParamsSource({ type: 'preset', label: `preset"), true);
  assert.equal(pageSource.includes("setCurrentParamsSource({ type: 'auto_search', label: `auto search rank ${meta.rank}` });"), true);
}

run();
console.log('coreModePhase82 checks passed');
