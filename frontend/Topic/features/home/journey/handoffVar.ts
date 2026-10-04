/**
 * 交接的 CSS 變數：<html> 上的 --handoff（0 → 1）。
 * 觀測台（features/home/terminal）讀它：小於 1 時頂端有一層檯燈的暖色餘光、第一組面板的不透明度是 --handoff；
 * 沒有這個值時觀測台就是平常的樣子（預設 1）。
 *
 * 只有 3D 場景在跑交接時才寫；場景卸載、改成海報、WebGL 失敗、換頁、loop 停下（捲出畫面、分頁隱藏）都要拿掉，
 * 觀測台與其他頁面絕對不會停在半透明。這個檔案不 import three（首屏外殼也用它來清掉）。
 */

const NAME = '--handoff';
/** 上次寫進去的值；null 表示目前沒有這個值（觀測台當成 1） */
let last: number | null = null;

/** 變化小於這個值就不寫（每一格都可能呼叫，但只有真的變了才碰 DOM） */
const STEP = 0.005;

/** 目前生效的值（沒有寫就是 1） */
export function currentHandoff(): number {
  return last ?? 1;
}

/** 上次寫進去的值（沒有這個值時是 null） */
export function writtenHandoff(): number | null {
  return last;
}

/** 寫入 --handoff（夾在 0–1）；0 與 1 一定寫得到，其他值變化不到 STEP 不寫 */
export function writeHandoff(v: number): void {
  if (typeof document === 'undefined') return;
  const q = v >= 1 ? 1 : v > 0 ? v : 0;
  if (last !== null && q === last) return;
  if (last !== null && Math.abs(q - last) < STEP && q !== 0 && q !== 1) return;
  last = q;
  document.documentElement.style.setProperty(NAME, q === 1 ? '1' : q === 0 ? '0' : q.toFixed(3));
}

/** 拿掉 --handoff（觀測台回到平常的樣子） */
export function clearHandoff(): void {
  last = null;
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(NAME);
}
