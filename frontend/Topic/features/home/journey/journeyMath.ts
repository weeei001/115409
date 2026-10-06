/**
 * 首頁旅程的捲動數學：純函式，不碰 DOM，方便單元測試。
 * 進度 p 是 0–1：sticky 舞台能捲動的距離是「軌道高度 − 舞台高度」，不是軌道高度。
 */

export interface ChapterRange {
  /** 章節名稱（只給程式與測試看；rail 顯示的是 RAIL 的名稱） */
  label: string;
  start: number;
  end: number;
  /** 這一章亮的是第幾顆 rail 按鈕 */
  rail: number;
}

/**
 * 五個段落（五句文案）：海面、燈塔、窗、桌前、交接。
 * 邊界刻意避開 0.15／0.3／0.45／0.55／0.7／0.85／0.92 這些常用來檢查構圖的位置，
 * 每一章在自己的區間裡都是完整顯示，只有跨過邊界的一小段在交叉淡化。
 */
export const CHAPTERS: readonly ChapterRange[] = [
  { label: '海面', start: 0, end: 0.22, rail: 0 },
  { label: '燈塔', start: 0.22, end: 0.4, rail: 1 },
  { label: '窗', start: 0.4, end: 0.62, rail: 2 },
  { label: '桌前', start: 0.62, end: 0.78, rail: 2 },
  { label: '交接', start: 0.78, end: 1, rail: 3 },
];

/** rail 四站；target 是要捲到的進度，最後一站（觀測台）直接跳到旅程後面的觀測台區塊，所以是 null */
export const RAIL: readonly { label: string; target: number | null }[] = [
  { label: '海面', target: 0 },
  { label: '燈塔', target: 0.3 },
  { label: '窗前', target: 0.7 },
  { label: '觀測台', target: null },
];

/** 「往下看介紹」捲到窗前：鏡頭已經在桌前、螢幕亮著的位置 */
export const WATCH_ROOM_PROGRESS = 0.7;

/** 交叉淡化的總寬度（以邊界為中心，前後各一半） */
export const CAPTION_FADE = 0.03;

/** 透明度低於這個值就整個藏起來（visibility hidden、不接受指標） */
export const CAPTION_HIDE_BELOW = 0.05;

export const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

/**
 * 捲動進度：(scrollY − 軌道頂端) ÷ (軌道高度 − 舞台高度)，限制在 0–1。
 * 軌道不比舞台高時沒有可捲距離，過了頂端就算走完。
 */
export function journeyProgress(scrollY: number, trackTop: number, trackHeight: number, viewportHeight: number): number {
  const distance = trackHeight - viewportHeight;
  if (!(distance > 0)) return scrollY >= trackTop ? 1 : 0;
  return clamp01((scrollY - trackTop) / distance);
}

/** 反過來：要讓進度停在 p，scrollY 應該是多少 */
export function scrollYForProgress(p: number, trackTop: number, trackHeight: number, viewportHeight: number): number {
  return trackTop + clamp01(p) * Math.max(0, trackHeight - viewportHeight);
}

/** 進度落在第幾段（0–4）；剛好在邊界時算下一段 */
export function chapterIndex(p: number): number {
  const v = clamp01(p);
  for (let i = CHAPTERS.length - 1; i > 0; i--) {
    if (v >= CHAPTERS[i].start) return i;
  }
  return 0;
}

/** 時刻開始往前走、走到觀測室時刻的進度 */
export const HOUR_START = 0.08;
export const HOUR_END = 0.54;

/**
 * 旅程裡的時刻（0 首屏 → 1 觀測室）：夜班從餘暉走到入夜，晨班從日出前走到日出。
 * 海面那一章停在首屏的天色；燈塔那一章（0.3）才走了三成（晨班的太陽還在海平面下，「天亮前」才說得通）；
 * 走到窗前已經是觀測室的時刻，之後在室內不再變。前段放慢（次方 1.6），所以時間不會在燈塔前就跑完。
 */
export function shiftHour(p: number): number {
  return Math.pow(smoothstep(HOUR_START, HOUR_END, p), 1.6);
}

/**
 * 交接（最後一段）：
 * - 0.78–0.92 鏡頭沿著桌面推到三台螢幕前；
 * - 0.92–1（捲動的最後 8%）是一整段連續的交接，全部由同一個值 h = handoffValue(p) 帶動（--ease-swell 的曲線）：
 *   鏡頭往螢幕推近、三塊畫面帶著邊框離開機身，從螢幕上的位置一路內插到觀測台三欄的位置（邊框從機身的寬度收成 1px、
 *   顏色變成頁面的分隔線色），桌上的畫面交叉淡化成觀測台的排法，房間溶成頁面底色、檯燈的暖光退掉。
 *   h 也寫進 <html> 的 --handoff，觀測台頂端的暖色餘光與第一組面板跟著它走（見 handoffVar.ts）。
 */
export const HANDOFF_START = 0.92;
export const HANDOFF_END = 1;

/** --ease-swell 的控制點（styles/main.css：cubic-bezier(0.37, 0, 0.63, 1)） */
export const EASE_SWELL: readonly [number, number, number, number] = [0.37, 0, 0.63, 1];

/** CSS cubic-bezier(x1, y1, x2, y2)：給 x（時間）求 y。兩端剛好是 0 與 1 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  if (!(x > 0)) return 0;
  if (x >= 1) return 1;
  const bx = (s: number) => ((1 - 3 * x2 + 3 * x1) * s + (3 * x2 - 6 * x1)) * s * s + 3 * x1 * s;
  const by = (s: number) => ((1 - 3 * y2 + 3 * y1) * s + (3 * y2 - 6 * y1)) * s * s + 3 * y1 * s;
  const dx = (s: number) => (3 * (1 - 3 * x2 + 3 * x1) * s + 2 * (3 * x2 - 6 * x1)) * s + 3 * x1;
  // 牛頓法，斜率太小或跑出範圍時改用二分法
  let s = x;
  for (let i = 0; i < 8; i++) {
    const e = bx(s) - x;
    if (Math.abs(e) < 1e-12) return by(s);
    const d = dx(s);
    if (Math.abs(d) < 1e-9) break;
    s -= e / d;
  }
  let lo = 0;
  let hi = 1;
  s = x;
  for (let i = 0; i < 60; i++) {
    const v = bx(s);
    if (Math.abs(v - x) < 1e-12) break;
    if (v < x) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return by(s);
}

/** --ease-swell */
export function easeSwell(t: number): number {
  return cubicBezier(EASE_SWELL[0], EASE_SWELL[1], EASE_SWELL[2], EASE_SWELL[3], t);
}

/** 交接的值 h（也是 --handoff）：0.92 以前是 0、1 是 1，中間是 --ease-swell */
export function handoffValue(p: number): number {
  if (!(p > HANDOFF_START)) return 0;
  if (p >= HANDOFF_END) return 1;
  return easeSwell((p - HANDOFF_START) / (HANDOFF_END - HANDOFF_START));
}

/** 交接時鏡頭在關鍵影格上的時間：0.92 以前照原本的進度，之後沿著 h 走（推近也用同一條曲線） */
export function handoffCameraT(p: number): number {
  return p > HANDOFF_START ? HANDOFF_START + (HANDOFF_END - HANDOFF_START) * handoffValue(p) : p;
}

/**
 * h 帶動的各個部分（都是 h 的連續函式，h = 1 時全部到位）：
 * - lift：畫面離開機身、往欄位走的比例（rect 內插用）。比 h 先走一點（1 − (1 − h)²）：
 *   鏡頭還在往前推、螢幕在畫面上還在變大時，畫面已經大致到位，不會先衝過欄位再退回來
 * - flatten：畫面從螢幕的角度轉成正對讀者（先轉正，之後就是螢幕上的矩形一路內插到欄位）
 * - deskOut／endIn：桌上的大字先淡出（露出面板底色），觀測台那一欄的排法再淡入；兩組字不會疊在一起
 * - room：房間溶成頁面底色
 * - warmth：檯燈的暖光還剩多少
 * - caption：交接文案與「進入觀測台」淡出（終點只剩三塊排好的畫面）
 * - bezelIn：離開機身的那一圈邊框淡入（一開始跟機身的邊框疊在一起，看不出來）
 */
export const handoffLift = (h: number) => {
  const k = clamp01(h);
  return 1 - (1 - k) * (1 - k);
};
export const handoffFlatten = (h: number) => smoothstep(0, 0.35, h);
export const handoffDeskOut = (h: number) => smoothstep(0.1, 0.4, h);
export const handoffEndIn = (h: number) => smoothstep(0.36, 0.68, h);
export const handoffRoom = (h: number) => smoothstep(0.08, 1, h);
export const handoffWarmth = (h: number) => 1 - smoothstep(0, 0.75, h);
export const handoffCaption = (h: number) => 1 - smoothstep(0, 0.5, h);
export const handoffBezelIn = (h: number) => smoothstep(0, 0.06, h);

/** rail 的不透明度（以 h 計）：交接前段淡出，三欄升到 rail 的高度之前就不見了，終點那一格跟觀測台的開頭一樣乾淨 */
export const RAIL_FADE: readonly [number, number] = [0.15, 0.6];
export function railFade(p: number): number {
  return 1 - smoothstep(RAIL_FADE[0], RAIL_FADE[1], handoffValue(p));
}

/** 畫面上的矩形（舞台座標，CSS px） */
export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** 兩個矩形之間內插：(1 − t)·a + t·b，t = 0 剛好是 a、t = 1 剛好是 b（沒有浮點誤差） */
export function lerpRect(a: Rect, b: Rect, t: number): Rect {
  const k = clamp01(t);
  const m = (x: number, y: number) => (1 - k) * x + k * y;
  return { left: m(a.left, b.left), right: m(a.right, b.right), top: m(a.top, b.top), bottom: m(a.bottom, b.bottom) };
}

/** 交接時邊框的寬度（px）：從機身邊框的寬度 start 收成觀測台的 1px 分隔線 */
export const TERMINAL_RULE_PX = 1;
export function bezelWidth(start: number, h: number): number {
  const k = clamp01(h);
  return (1 - k) * start + k * TERMINAL_RULE_PX;
}

/**
 * 三塊畫面各自的終點（欄位對應）：左螢幕 → 觀測清單、中間 → 報價、右螢幕 → 加權指數那一格（只升起第一格）。
 * 窄螢幕只有中間那一欄（觀測台手機版也是報價在最前面），左右是 null：那兩塊從畫面兩側移出去（見 exitRect）。
 */
export function terminalColumnRects(L: HandoffLayout): { left: Rect | null; center: Rect; right: Rect | null } {
  return {
    left: L.left ? { left: L.left[0], right: L.left[1], top: L.top, bottom: L.bottom } : null,
    center: { left: L.center[0], right: L.center[1], top: L.top, bottom: L.bottom },
    right: L.right ? { left: L.right[0], right: L.right[1], top: L.top, bottom: L.rightBottom } : null,
  };
}

/** 窄螢幕的左右兩塊：同樣大小，整塊（含邊框 margin）移到畫面外面 */
export function exitRect(r: Rect, side: -1 | 1, stageWidth: number, margin: number): Rect {
  const dx = side < 0 ? -(r.right + margin) : stageWidth + margin - r.left;
  return { left: r.left + dx, right: r.right + dx, top: r.top, bottom: r.bottom };
}

/** 觀測台寬螢幕的欄寬（features/home/terminal 的 lg:grid-cols-[300px_minmax(0,1fr)_320px]） */
export const TERMINAL_COLS = { left: 300, right: 320, container: 1320, gutterLg: 40, gutterSm: 24, gutterXs: 16, breakpoint: 1024 } as const;
/** 交接終點：三欄的上緣（舞台座標）。寬螢幕與觀測台標題列等高（pt-16 + 標題 56 + mt-6）；窄螢幕留給文案 */
export const HANDOFF_TOP_WIDE = 144;
export const HANDOFF_TOP_NARROW = 170;

export interface HandoffLayout {
  /** 欄的上緣、下緣（舞台座標，px） */
  top: number;
  bottom: number;
  /** 窄螢幕只有一欄（中間的報價），左右兩欄移出畫面 */
  single: boolean;
  /** 左、中、右三欄的 [左緣, 右緣]（px）；single 時左右是 null */
  left: [number, number] | null;
  center: [number, number];
  right: [number, number] | null;
  /** 右欄升起的那一格（加權指數面板）的下緣；量不到時是整欄（bottom） */
  rightBottom: number;
}

/**
 * 從頁面上量到的觀測台網格（BeaconJourney 量 #terminal 的三欄）：位置都是相對觀測台區塊的上緣與視窗左緣（CSS px）。
 * 觀測台在旅程終點時正好從舞台上緣開始，所以這就是終點三欄在舞台上的位置。
 */
export interface MeasuredTerminal {
  /** 網格上緣（相對觀測台區塊上緣） */
  top: number;
  /** 三欄的 [左緣, 右緣]；手機只有一欄時左右是 null，center 是報價那一欄 */
  left: [number, number] | null;
  center: [number, number];
  right: [number, number] | null;
  /** 右欄第一格（加權指數）的高度；量不到是 null */
  rightPanel: number | null;
}

/** 一個欄的矩形（getBoundingClientRect 的 left、right、top、bottom，CSS px） */
export interface ColumnRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * 把量到的觀測台三欄整理成 MeasuredTerminal（純函式，可測）。
 * cols 依 DOM 順序是 [觀測清單, 報價, 右欄]；三欄並排（寬螢幕）時三個都有，疊成一欄（手機）時只取報價那一欄。
 * sectionTop 是觀測台區塊的上緣；rightPanel 是右欄第一格的高度。欄寬太窄或量不到時回傳 null（改用固定的版面）。
 */
export function measureTerminalColumns(sectionTop: number, cols: readonly ColumnRect[], rightPanel: number | null): MeasuredTerminal | null {
  if (cols.length < 3) return null;
  const [l, c, r] = cols;
  const ok = (x: ColumnRect) => x.right - x.left > 40 && Number.isFinite(x.top);
  if (!ok(c)) return null;
  const sideBySide = ok(l) && ok(r) && l.right <= c.left + 2 && c.right <= r.left + 2 && Math.abs(l.top - c.top) < 2 && Math.abs(r.top - c.top) < 2;
  const round = (v: number) => Math.round(v * 2) / 2;
  if (sideBySide) {
    return {
      top: round(c.top - sectionTop),
      left: [round(l.left), round(l.right)],
      center: [round(c.left), round(c.right)],
      right: [round(r.left), round(r.right)],
      rightPanel: rightPanel != null && rightPanel > 40 ? round(rightPanel) : null,
    };
  }
  return { top: round(c.top - sectionTop), left: null, center: [round(c.left), round(c.right)], right: null, rightPanel: null };
}

/** 終點三欄最少要留的高度（量到的網格太低時，退回固定版面） */
const MIN_COLUMN = 160;

/**
 * 交接終點的三欄位置：跟觀測台的網格一模一樣，捲過舞台時，螢幕變成的三欄剛好接上觀測台的三欄。
 * 有量到觀測台（measured）就用量到的位置（觀測台的標題列、說明列、手機的搜尋列都算進去了）；
 * 量不到時用觀測台網格的固定尺寸（容器 max-w 1320、lg:px-10，外框 1px、欄間 1px）。
 * width、height 是舞台（canvas）的 CSS 尺寸。
 */
export function handoffLayout(width: number, height: number, measured: MeasuredTerminal | null = null): HandoffLayout {
  const C = TERMINAL_COLS;
  if (measured && measured.top >= 0 && measured.top <= height - MIN_COLUMN && measured.center[1] <= width + 1) {
    const single = !measured.left || !measured.right;
    const top = measured.top;
    return {
      top,
      bottom: height,
      single,
      left: single ? null : measured.left,
      center: measured.center,
      right: single ? null : measured.right,
      rightBottom: !single && measured.rightPanel ? Math.min(height, top + measured.rightPanel) : height,
    };
  }
  if (width >= C.breakpoint) {
    const x0 = Math.max(0, (width - C.container) / 2) + C.gutterLg;
    const cw = Math.min(width, C.container) - C.gutterLg * 2;
    return {
      top: HANDOFF_TOP_WIDE,
      bottom: height,
      single: false,
      left: [x0 + 1, x0 + 1 + C.left],
      center: [x0 + 2 + C.left, x0 + cw - 2 - C.right],
      right: [x0 + cw - 1 - C.right, x0 + cw - 1],
      rightBottom: height,
    };
  }
  const pad = width >= 640 ? C.gutterSm : C.gutterXs;
  return {
    top: Math.min(HANDOFF_TOP_NARROW, height * 0.45),
    bottom: height,
    single: true,
    left: null,
    center: [pad + 1, width - pad - 1],
    right: null,
    rightBottom: height,
  };
}

/**
 * 第 i 段文案的不透明度：整段完整顯示，只在邊界前後 fade/2 交叉淡化（前一段淡出的同時下一段淡入，兩者相加為 1）。
 * 第一段一開始就完整顯示（首屏文字不能等捲動），最後一段不淡出（交給觀測台接手）。
 */
export function captionOpacity(index: number, p: number, fade = CAPTION_FADE): number {
  const c = CHAPTERS[index];
  if (!c) return 0;
  const v = clamp01(p);
  const h = fade / 2;
  const fadeIn = index === 0 ? 1 : smoothstep(c.start - h, c.start + h, v);
  const fadeOut = index === CHAPTERS.length - 1 ? 1 : 1 - smoothstep(c.end - h, c.end + h, v);
  return Math.min(fadeIn, fadeOut);
}
