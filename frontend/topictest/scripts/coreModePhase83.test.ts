import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const pagePath = path.resolve(__dirname, '../pages/core-mode.tsx');
  const pageSource = fs.readFileSync(pagePath, 'utf-8');

  assert.equal(pageSource.includes('const [isBacktestResultStale, setIsBacktestResultStale] = useState(false);'), true);
  assert.equal(pageSource.includes('const shouldHideBacktestResult = loadedAutoSearchParamsPendingValidation || isBacktestResultStale;'), true);

  const loadHandlerMatch = pageSource.match(/const handleLoadAutoSearchParams = \([\s\S]*?\n  \};/);
  assert.ok(loadHandlerMatch, 'missing handleLoadAutoSearchParams');
  const loadHandlerBody = loadHandlerMatch[0];
  assert.equal(loadHandlerBody.includes('setLoadedAutoSearchParamsPendingValidation(true);'), true);
  assert.equal(loadHandlerBody.includes('setIsBacktestResultStale(true);'), true);

  const loadPresetMatch = pageSource.match(/const handleLoadPreset = \(\) => \{([\s\S]*?)\n  \};/);
  assert.ok(loadPresetMatch, 'missing handleLoadPreset');
  assert.equal(loadPresetMatch[1].includes('setIsBacktestResultStale(true);'), true);

  const runHandlerMatch = pageSource.match(/const handleRunBacktest = async \(mode: 'auto_search' \| 'formal_backtest'\) => \{([\s\S]*?)\n  \};/);
  assert.ok(runHandlerMatch, 'missing handleRunBacktest');
  const runHandlerBody = runHandlerMatch[1];
  assert.equal(runHandlerBody.includes("if (mode === 'formal_backtest' && (loadedAutoSearchParamsPendingValidation || isBacktestResultStale))"), true);
  assert.equal(runHandlerBody.includes('setLoadedAutoSearchParamsPendingValidation(false);'), true);
  assert.equal(runHandlerBody.includes('setIsBacktestResultStale(false);'), true);

  assert.equal(pageSource.includes('{runResult && !shouldHideBacktestResult ? ('), true);
  assert.equal(pageSource.includes('<h2 className="text-base font-bold">回測 summary</h2>'), true);
  assert.equal(pageSource.includes('<CoreModePriceChart data={runResult.price_chart} />'), true);
  assert.equal(pageSource.includes('<VirtualTradeTable trades={runResult.trades} />'), true);
  assert.equal(pageSource.includes(') : shouldHideBacktestResult ? ('), true);
  assert.equal(pageSource.includes('尚未重新回測'), true);
  assert.equal(
    pageSource.includes('目前已載入新的參數，但尚未根據這組參數重新計算回測結果。請先點擊「重新執行正式回測」，完成後才會顯示歷史回測交易軌跡與交易明細。'),
    true
  );

  assert.equal(pageSource.includes('目前參數尚未重新回測確認，不建議直接儲存或啟用。仍要繼續嗎？'), true);
  assert.equal(pageSource.includes('目前參數尚未重新回測確認，不建議直接儲存或啟用。'), true);
  assert.equal(pageSource.includes("{item.rank === 1 ? '用首選重新回測' : '用此參數重新回測'}"), true);
}

run();
console.log('coreModePhase83 stale result checks passed');
