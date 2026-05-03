import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const typesPath = path.resolve(__dirname, '../lib/types/coreMode.ts');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');
  const typesSource = fs.readFileSync(typesPath, 'utf-8');

  assert.equal(typesSource.includes("final_holdout_settings?: {"), true);
  assert.equal(typesSource.includes("mode?: 'ratio' | 'days';"), true);
  assert.equal(typesSource.includes('validation_score?: number | null;'), true);
  assert.equal(typesSource.includes('final_holdout_score?: number | null;'), true);
  assert.equal(typesSource.includes('final_holdout_cross_stock_score?: number | null;'), true);
  assert.equal(typesSource.includes('split_summary?: {'), true);

  assert.equal(pageSource.includes('Final Holdout 分割（預設 60/20/20）：'), true);
  assert.equal(pageSource.includes('final_holdout_settings: {'), true);
  assert.equal(pageSource.includes('validation_score'), true);
  assert.equal(pageSource.includes('ranking_basis：'), true);
  assert.equal(pageSource.includes('runResult?.auto_search_result?.split_summary ? ('), true);
  assert.equal(pageSource.includes('final holdout：'), true);

  assert.equal(/<th className="px-2 py-2">[^<]*validation_score[^<]*<\/th>/.test(pageSource), true);
  assert.equal(pageSource.includes('<th className="px-2 py-2">final_holdout_score</th>'), true);
  assert.equal(pageSource.includes('<th className="px-2 py-2">final_holdout_cross_stock_score</th>'), true);
  assert.equal(pageSource.includes('<th className="px-2 py-2">final_holdout_summary</th>'), true);
}

run();
console.log('coreModePhase9 final holdout frontend checks passed');
