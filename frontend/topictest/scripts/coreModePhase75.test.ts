import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../pages/core-mode.tsx'), 'utf-8');

  assert.equal(pageSource.includes('已載入自動搜尋參數，請重新執行回測確認後再手動儲存或啟用。'), true);
  assert.equal(pageSource.includes('已載入自動搜尋參數，尚未重新回測'), true);
  assert.equal(pageSource.includes('此組參數已完成重新回測確認。'), true);

  const handlerMatch = pageSource.match(/const handleLoadAutoSearchParams = \([\s\S]*?\n  \};/);
  assert.ok(handlerMatch, '找不到 handleLoadAutoSearchParams');
  const handlerBody = handlerMatch[0];
  assert.equal(handlerBody.includes('setParams(next);'), true);
  assert.equal(handlerBody.includes('setLoadedAutoSearchParamsPendingValidation(true);'), true);
  assert.equal(handlerBody.includes('setIsBacktestResultStale(true);'), true);
  assert.equal(handlerBody.includes("setCurrentParamsSource({ type: 'auto_search', label: `auto search rank ${meta.rank}` });"), true);

  assert.equal(handlerBody.includes('saveCoreModePreset'), false);
  assert.equal(handlerBody.includes('activateCoreModePreset'), false);
  assert.equal(handlerBody.includes('runCoreModeBacktest'), false);
  assert.equal(handlerBody.includes('setMlValidationEnabled'), false);

  const rerunHandlerMatch = pageSource.match(/const handleRunBacktest = async \(mode: 'auto_search' \| 'formal_backtest'\) => \{([\s\S]*?)\n  \};/);
  assert.ok(rerunHandlerMatch, '找不到 handleRunBacktest');
  const rerunBody = rerunHandlerMatch[1];
  assert.equal(rerunBody.includes("if (mode === 'formal_backtest' && (loadedAutoSearchParamsPendingValidation || isBacktestResultStale))"), true);
  assert.equal(rerunBody.includes('setLoadedAutoSearchParamsPendingValidation(false);'), true);
  assert.equal(rerunBody.includes('setIsBacktestResultStale(false);'), true);
}

run();
console.log('coreModePhase75 frontend checks passed');

