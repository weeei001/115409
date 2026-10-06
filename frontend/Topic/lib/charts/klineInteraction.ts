import type { ChartOptions, DeepPartial, TrackingModeExitMode } from 'lightweight-charts';

/** TrackingModeExitMode.OnTouchEnd。只引入型別：lightweight-charts 只有 ESM，node 測試（tsx）無法 require */
const EXIT_ON_TOUCH_END = 0 as TrackingModeExitMode.OnTouchEnd;

/**
 * K 線圖（個股頁、首頁觀測台）共用的手勢設定：垂直滑動與滑鼠滾輪還給頁面捲動，
 * 圖表只保留水平拖曳、雙指縮放與拖曳時間軸縮放。
 * - 兩個 mouseWheel 都要關：只關一個，觸控板帶一點水平分量的捲動仍會被圖表攔下。
 * - 長按會進入十字線追蹤；預設要再點一下才離開，在那之前垂直滑動仍被吃掉，所以放開手指就離開。
 */
export const KLINE_INTERACTION_OPTIONS = {
  handleScroll: { vertTouchDrag: false, mouseWheel: false },
  handleScale: { mouseWheel: false },
  trackingMode: { exitMode: EXIT_ON_TOUCH_END },
} satisfies DeepPartial<ChartOptions>;
