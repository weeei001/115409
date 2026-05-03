import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function run(): void {
  const chartPath = path.resolve(__dirname, '../components/core-mode/CoreModePriceChart.tsx');
  const source = fs.readFileSync(chartPath, 'utf-8');

  const showActualOnlyText = '\u53ea\u986f\u793a\u5be6\u969b\u4ea4\u6613';
  const showTradeAndSignalText = '\u986f\u793a\u4ea4\u6613\u8207\u8a0a\u865f';
  const holdTooltipText = '{CHART_MARKERS.hold.text}\uff08\u50c5 tooltip\uff09';
  const helperText =
    '\u8cb7\u9032 / \u8ce3\u51fa\u4ee3\u8868\u56de\u6e2c\u4e2d\u7684\u5be6\u969b\u4ea4\u6613\u52d5\u4f5c\uff1b\u8cb7\u8a0a / \u8ce3\u8a0a\u4ee3\u8868\u7b56\u7565\u8a0a\u865f\uff0c\u4e0d\u4e00\u5b9a\u4ee3\u8868\u6210\u4ea4\uff1b\u6301\u5e73\u70ba\u4e2d\u6027\u72c0\u614b\uff0c\u9810\u8a2d\u986f\u793a\u65bc tooltip \u6216\u72c0\u614b\u6458\u8981\uff0c\u4e0d\u986f\u793a\u5728\u4e3b\u5716\u4e0a\u3002';

  assert.equal(source.includes('function buildDisplayMarkers('), true);
  assert.equal(source.includes('const [showSignalMarkers, setShowSignalMarkers] = useState(false);'), true);

  assert.equal(source.includes('const hasActualTrade = hasEntry || hasExit;'), true);
  assert.equal(source.includes('if (hasActualTrade) {'), true);
  assert.equal(source.includes('if (!options.showSignalMarkers) return;'), true);
  assert.equal(source.includes("const buySignal = dedupedByType.get('state_buy');"), true);
  assert.equal(source.includes("const sellSignal = dedupedByType.get('state_sell');"), true);
  assert.equal(source.includes('// state_hold is intentionally hidden on the main chart.'), true);

  assert.equal(source.includes(showActualOnlyText), true);
  assert.equal(source.includes(showTradeAndSignalText), true);
  assert.equal(source.includes(holdTooltipText), true);
  assert.equal(source.includes(helperText), true);
}

run();
console.log('coreModeChartMarkers marker cleanup checks passed');
