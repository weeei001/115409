import React from 'react';

/**
 * 圖廓邊緣的「水深」：上緣寫圖上第一個與最後一個日期，左緣寫圖上的最高與最低值，
 * 位置對齊該值在圖上的座標（像海圖在圖廓外緣標經緯度與水深）。只用在每頁唯一的圖廓（主圖）上。
 *
 * 圖廓的上、左內距加寬到 SOUNDING_PAD 放這些字：刻度畫在 0～8px，字在 9～21px。
 * 字是 11px 等寬、muted 色；同樣的數字在讀數列、圖說或表格裡都有文字，所以對輔助科技隱藏。
 */
export const SOUNDING_PAD = 22;

/** 給圖廓本身用的 inline style（inline 才蓋得過 neatline utility 的 padding） */
export const SOUNDING_FRAME_STYLE: React.CSSProperties = { paddingTop: SOUNDING_PAD, paddingLeft: SOUNDING_PAD };

export interface SoundingMarks {
  /** x：相對繪圖區左緣的像素；與 last 太近（< 150px）時不畫 */
  first: { text: string; x: number } | null;
  last: { text: string; x: number };
  /** y：相對繪圖區上緣的像素 */
  high: { text: string; y: number } | null;
  low: { text: string; y: number } | null;
  /** 繪圖區高度：左緣的直排字夾在這個範圍內 */
  height: number;
}

/** 11px 等寬字約 6.6px 寬、中文字約 11px，用來估直排字的長度 */
export function soundingLength(text: string): number {
  return [...text].reduce((n, ch) => n + (/[　-鿿]/.test(ch) ? 11 : 6.6), 0);
}

/** 直排字的中心夾在 [長度/2, 高度-長度/2]，不會超出框 */
export function clampSounding(y: number, text: string, height: number): number {
  const half = soundingLength(text) / 2;
  return Math.min(Math.max(y, half), Math.max(half, height - half));
}

/** 只有值或位置真的變了才換新物件（拖曳、滑過時不會每幀重繪外層） */
export function sameMarks(a: SoundingMarks | null, b: SoundingMarks | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 水深圖層。放在圖廓的直接子層：用 inline style 拿掉 `.neatline > *` 給的框線與底色。
 * origin：繪圖區左上角相對圖廓外框的位置（SOUNDING_PAD＋內框邊線＋內距）。
 */
export function NeatlineSoundings({ marks, origin }: { marks: SoundingMarks; origin: { x: number; y: number } }) {
  const { first, last, high, low, height } = marks;
  const highY = high ? clampSounding(high.y, high.text, height) : null;
  const lowY = low ? clampSounding(low.y, low.text, height) : null;
  // 值域太窄時兩個直排字會疊在一起，只留最高值
  const showLow =
    low !== null &&
    lowY !== null &&
    (high === null || highY === null || Math.abs(lowY - highY) > (soundingLength(high.text) + soundingLength(low.text)) / 2 + 6);
  const showFirst = first !== null && first.text !== last.text && last.x - first.x > 150;
  const vertical: React.CSSProperties = { writingMode: 'sideways-lr', left: 9, transform: 'translateY(-50%)' };
  return (
    <div
      aria-hidden
      data-soundings
      className="pointer-events-none absolute inset-0 font-mono text-[11px] leading-3 whitespace-nowrap text-muted-foreground tabular-nums"
      style={{ border: 0, background: 'transparent' }}
    >
      {showFirst ? (
        <span className="absolute" style={{ top: 9, left: Math.max(SOUNDING_PAD, origin.x + first.x - 3) }}>
          {first.text}
        </span>
      ) : null}
      <span className="absolute -translate-x-full" style={{ top: 9, left: origin.x + last.x + 3 }}>
        {last.text}
      </span>
      {high && highY !== null ? (
        <span className="absolute" style={{ ...vertical, top: origin.y + highY }}>
          {high.text}
        </span>
      ) : null}
      {showLow && low && lowY !== null ? (
        <span className="absolute" style={{ ...vertical, top: origin.y + lowY }}>
          {low.text}
        </span>
      ) : null}
    </div>
  );
}
