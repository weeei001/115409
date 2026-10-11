/**
 * 「這頁怎麼看」導覽的版面計算（純函式，PageTour 每個 frame 呼叫）：
 * 被介紹的區塊外框（spotlight）、說明卡放哪裡、要捲到哪裡。
 */

export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
  /** sticky 頁首高度：區塊不要被它蓋住 */
  header: number;
}

/** 外框比區塊大一圈 */
export const SPOT_PAD = 8;
/** 說明卡和外框的距離、和視窗邊緣的最小距離 */
const GAP = 12;
const EDGE = 16;

/** 區塊加上外框的留白，再裁到視窗內（區塊比視窗高時只框看得到的部分）；完全不在視窗內時是 null */
export function spotlightBox(target: Box, viewport: Viewport, pad = SPOT_PAD): Box | null {
  const top = Math.max(target.top - pad, viewport.header);
  const left = Math.max(target.left - pad, 0);
  const bottom = Math.min(target.top + target.height + pad, viewport.height);
  const right = Math.min(target.left + target.width + pad, viewport.width);
  if (bottom - top < 1 || right - left < 1) return null;
  return { top, left, width: right - left, height: bottom - top };
}

export type CalloutSide = 'below' | 'above' | 'right' | 'left' | 'inside' | 'dock';

/**
 * 說明卡的位置：手機固定貼在畫面底部（dock）；桌面先放外框下方、放不下放上方，
 * 再不行就放在外框右邊或左邊（窄而高的欄，例如觀測清單），都放不下時疊在視窗底部（inside）。
 * 上下放時水平對齊外框左緣、左右放時頂端對齊外框，都夾在視窗內。
 */
export function calloutPlacement(spot: Box | null, viewport: Viewport, size: { width: number; height: number }, docked: boolean):
  { top: number; left: number; side: CalloutSide } {
  if (docked) return { top: viewport.height - size.height, left: 0, side: 'dock' };
  const left = Math.min(Math.max(spot?.left ?? (viewport.width - size.width) / 2, EDGE), Math.max(EDGE, viewport.width - size.width - EDGE));
  if (!spot) return { top: Math.max(viewport.header + EDGE, (viewport.height - size.height) / 2), left, side: 'inside' };
  const below = spot.top + spot.height + GAP;
  if (below + size.height <= viewport.height - EDGE) return { top: below, left, side: 'below' };
  const above = spot.top - GAP - size.height;
  if (above >= viewport.header + EDGE) return { top: above, left, side: 'above' };
  const top = Math.min(Math.max(spot.top, viewport.header + EDGE), viewport.height - size.height - EDGE);
  const right = spot.left + spot.width + GAP;
  if (right + size.width <= viewport.width - EDGE) return { top, left: right, side: 'right' };
  const leftSide = spot.left - GAP - size.width;
  if (leftSide >= EDGE) return { top, left: leftSide, side: 'left' };
  return { top: viewport.height - size.height - EDGE, left, side: 'inside' };
}

/**
 * 換到某一步時要捲到的位置（document 的 scrollTop）：
 * 放得下就讓區塊在「頁首以下、說明卡以上」的空間置中，放不下就讓區塊的頂端貼著頁首下方。
 * reserved 是視窗底部留給說明卡的高度（手機的 dock）。
 */
export function scrollTargetTop(target: Box, scrollY: number, viewport: Viewport, reserved = 0): number {
  const room = viewport.height - viewport.header - reserved;
  const absoluteTop = target.top + scrollY;
  const offset = target.height + SPOT_PAD * 2 <= room * 0.85 ? (room - target.height) / 2 : SPOT_PAD + EDGE;
  return Math.max(0, Math.round(absoluteTop - viewport.header - offset));
}
