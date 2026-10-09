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

/**
 * h 到這裡三塊畫面已經對齊觀測台三欄：<html> 加上 data-handed-off，旅程舞台溶掉、露出底下的觀測台（styles/main.css）。
 * 寫入 --handoff 時一起更新，拿掉時一起拿掉
 */
const HANDED_OFF = 0.95;
const HANDED_ATTR = 'data-handed-off';

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
  const root = document.documentElement;
  root.style.setProperty(NAME, q === 1 ? '1' : q === 0 ? '0' : q.toFixed(3));
  root.toggleAttribute(HANDED_ATTR, q >= HANDED_OFF);
}

/** 拿掉 --handoff（觀測台回到平常的樣子） */
export function clearHandoff(): void {
  last = null;
  if (typeof document === 'undefined') return;
  document.documentElement.style.removeProperty(NAME);
  document.documentElement.removeAttribute(HANDED_ATTR);
}

/**
 * 把觀測台（#terminalId）往上移 px（0 是放開），讓它在旅程最後一段跟黏住的舞台對齊（BeaconJourney 捲動時寫）。
 * 直接寫在元素的 style 上（ObservationTerminal 不設 style，React 不會蓋掉）。
 * 釘住時量到的位置是舞台上緣：要捲到觀測台的地方（「進入觀測台」、頁首的跳到觀測台連結）先放開再量。
 */
export function pinTerminal(terminalId: string, px: number): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(terminalId);
  if (!el) return;
  const v = px > 0 ? `0 ${(-px).toFixed(1)}px` : '';
  if (el.style.translate !== v) el.style.translate = v;
}
