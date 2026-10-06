import assert from 'node:assert/strict';
import { KLINE_INTERACTION_OPTIONS } from './klineInteraction';

// P0-2／P1-03：垂直滑動、滾輪留給頁面；水平拖曳與雙指縮放保留（沒覆寫＝函式庫預設開啟）
assert.deepEqual(KLINE_INTERACTION_OPTIONS.handleScroll, { vertTouchDrag: false, mouseWheel: false });
assert.deepEqual(KLINE_INTERACTION_OPTIONS.handleScale, { mouseWheel: false });
assert.equal('horzTouchDrag' in KLINE_INTERACTION_OPTIONS.handleScroll, false);
assert.equal('pinch' in KLINE_INTERACTION_OPTIONS.handleScale, false);
// 長按進入十字線追蹤後，放開手指就離開，不必再點一下才能捲動頁面
void (async () => {
  // lightweight-charts 只有 ESM，用動態 import 取 enum 的實際值
  const { TrackingModeExitMode } = await import('lightweight-charts');
  assert.equal(KLINE_INTERACTION_OPTIONS.trackingMode.exitMode, TrackingModeExitMode.OnTouchEnd);
  console.log('K-line interaction options passed: page keeps vertical swipe and mouse wheel, chart keeps horizontal drag and pinch.');
})();
