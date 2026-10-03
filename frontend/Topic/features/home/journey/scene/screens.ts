/**
 * 觀測室裡的螢幕與牆上看板（畫在 canvas 上，當成貼圖）。
 * 只畫傳進來的真實資料；沒有資料就顯示「讀取中…」，不模擬行情。
 * 漲跌色一律從 getChartPalette 取（台股紅漲綠跌）；數字格式與下方觀測台相同（fmtPrice、fmtNum、signedText）。
 *
 * 每台螢幕有兩張畫面：
 * - 桌上（desk，16:9）：在房間裡看得清楚的讀數（大字），整段旅程都亮著。
 * - 終點（end，觀測台那一欄的大小）：照觀測台那一欄的排法畫——同樣的標題列、燈質記號、字級與間距，
 *   交接時螢幕離開機身、兩張交叉淡化，停下來時就是觀測台的那一欄：
 *   左「觀測清單」＋「N 檔 · 依產業」與依產業分組的清單；中報價區＋圖廓裡的收盤線；
 *   右「加權指數」面板（收盤、漲跌、與觀測台同一條走勢線）。
 * 海報（idle）不畫任何資料與日期：螢幕是中性的圖廓、格線與一條無日期的走勢線（像海圖上的畫，不是載入中的灰條）。
 */
import { signedText } from '@/components/common/LightEntry';
import { getChartPalette, type ChartPalette } from '@/lib/charts/theme';
import { fmtNum, fmtPrice } from '@/lib/utils/format';
import type { BeaconJourneyProps } from '../types';
import { changeText, quoteCharacteristic } from '../boardFormat';

export const SANS = '"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif';
export const MONO = '"IBM Plex Mono","Noto Sans TC",ui-monospace,Menlo,Consolas,monospace';
export const SERIF = '"Noto Serif TC","Songti TC","PMingLiU",serif';

/** canvas 像素 ÷ 交接終點的 CSS 像素 */
export const SCREEN_SCALE = 2;

/** 觀測清單的一檔（/stocks/info：代號、名稱、產業） */
export interface WatchItem {
  symbol: string;
  name: string;
  industry: string | null;
}

/** 觀測台「加權指數」面板裡的走勢線：viewBox 100×40 的折線點與線色（從觀測台讀來，兩邊畫的是同一條線） */
export interface SparkLine {
  points: [number, number][];
  color: string;
}

export interface ScreenData {
  board: BeaconJourneyProps['board'];
  monitor: BeaconJourneyProps['monitor'];
  /** 選中股票的產業（/stocks/info），沒有就不寫 */
  industry: string | null;
  stockCount: number | null;
  industryCount: number | null;
  /** 觀測清單（/stocks/info 的順序）；終點那一欄依產業分組列出 */
  watch: readonly WatchItem[] | null;
  /** 加權指數面板的走勢線（觀測台已經畫出來時才有） */
  spark: SparkLine | null;
  /** 海報擷取模式：不畫任何資料與日期（海報是靜態圖），螢幕畫中性的圖廓與格線 */
  idle: boolean;
}

export type FaceKey = 'center' | 'left' | 'right';
const FACE_KEYS: readonly FaceKey[] = ['center', 'left', 'right'];

export interface ScreenCanvases {
  /** 交接終點那一欄的畫面 */
  end: Record<FaceKey, HTMLCanvasElement>;
  /** 桌上的畫面（16:9） */
  desk: Record<FaceKey, HTMLCanvasElement>;
  board: HTMLCanvasElement;
}

/** 每塊畫面的 canvas 尺寸（px） */
export interface ScreenSizes {
  end: Record<FaceKey, [number, number]>;
  desk: Record<FaceKey, [number, number]>;
}

/** 頁面的 token（從 CSS 變數讀，讀不到用色盤的值） */
export interface ScreenTokens {
  card: string;
  background: string;
  border: string;
  strong: string;
  text: string;
  muted: string;
  /** 觀測清單的產業分組列底色（--muted） */
  mutedBg: string;
  /** 選取列的底色（--accent） */
  accent: string;
  brand: string;
  subtle: string;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createScreenCanvases(sizes: ScreenSizes): ScreenCanvases {
  const set = (s: Record<FaceKey, [number, number]>) => ({ center: makeCanvas(...s.center), left: makeCanvas(...s.left), right: makeCanvas(...s.right) });
  return { end: set(sizes.end), desk: set(sizes.desk), board: makeCanvas(2048, 256) };
}

/** 尺寸變了就換 canvas 的大小（回傳哪些 canvas 變了） */
export function resizeScreenCanvases(c: ScreenCanvases, sizes: ScreenSizes): Set<HTMLCanvasElement> {
  const changed = new Set<HTMLCanvasElement>();
  (['end', 'desk'] as const).forEach((set) =>
    FACE_KEYS.forEach((k) => {
      const [w, h] = sizes[set][k];
      const cv = c[set][k];
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        changed.add(cv);
      }
    }),
  );
  return changed;
}

/** 讀頁面的 token（--card、--background…）；SSR 或讀不到時用色盤 */
export function readTokens(isDark: boolean): ScreenTokens {
  const pal = getChartPalette(isDark);
  const fallback: ScreenTokens = {
    card: pal.tooltipBg,
    background: isDark ? '#080b0f' : '#f3f6f8',
    border: pal.grid,
    strong: pal.tooltipBorder,
    text: pal.text,
    muted: pal.tickMuted,
    mutedBg: isDark ? '#131a21' : '#e6edf1',
    accent: isDark ? '#16202a' : '#e6edf1',
    brand: pal.brand,
    subtle: isDark ? '#b4bec8' : '#2c3a46',
  };
  if (typeof document === 'undefined') return fallback;
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  return {
    card: v('--card', fallback.card),
    background: v('--background', fallback.background),
    border: v('--border', fallback.border),
    strong: v('--border-strong', fallback.strong),
    text: v('--foreground', fallback.text),
    muted: v('--muted-foreground', fallback.muted),
    mutedBg: v('--muted', fallback.mutedBg),
    accent: v('--accent', fallback.accent),
    brand: v('--brand', fallback.brand),
    subtle: v('--subtle', fallback.subtle),
  };
}

/** 單日漲跌：最後兩筆收盤相減，百分比相對前一筆（與觀測台報價面板的算法相同） */
export function dayChange(closes: readonly number[]): { change: number; percent: number | null } | null {
  const n = closes.length;
  if (n < 2) return null;
  const last = closes[n - 1];
  const prev = closes[n - 2];
  if (!Number.isFinite(last) || !Number.isFinite(prev)) return null;
  const change = last - prev;
  return { change, percent: prev ? (change / prev) * 100 : null };
}

/**
 * 收盤線的縱軸：依收盤的最低、最高自動縮放，上下各留 span × pad 的空間（不從 0 起算，走勢才看得出起伏）。
 * 全部一樣時給一個以收盤為中心、±0.5% 的範圍。
 */
export function closeRange(closes: readonly number[], pad = 0.08): { lo: number; hi: number } {
  let hi = Math.max(...closes);
  let lo = Math.min(...closes);
  const span = hi - lo || Math.abs(hi) * 0.01 || 1;
  if (hi === lo) {
    hi += span / 2;
    lo -= span / 2;
  }
  return { lo: lo - span * pad, hi: hi + span * pad };
}

/** 觀測清單分組：依產業分組、組名依繁中排序（觀測台的 Watchlist 同一個做法；這裡不知道收藏，所以沒有收藏組） */
export function groupWatch(items: readonly WatchItem[]): { name: string; rows: WatchItem[] }[] {
  const by = new Map<string, WatchItem[]>();
  for (const it of items) {
    const key = it.industry || '未分類';
    const list = by.get(key);
    if (list) list.push(it);
    else by.set(key, [it]);
  }
  return Array.from(by, ([name, rows]) => ({ name, rows })).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}

/** 依數值正負取漲跌色，0 用中性 */
function toneOf(v: number, pal: ChartPalette): string {
  return v > 0 ? pal.up : v < 0 ? pal.down : pal.flat;
}

const S = SCREEN_SCALE;
const PAD = 20 * S;

function fill(ctx: CanvasRenderingContext2D, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, color: string, px = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, Math.round(y), w, px * S);
}

/** 文字加字距（canvas 的 letterSpacing 在 Chrome 99+；不支援時就是一般字距） */
function setFont(ctx: CanvasRenderingContext2D, font: string, tracking = 0) {
  ctx.font = font;
  (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${tracking}px`;
}

/**
 * 在 CSS 行框裡寫字：top 是行框上緣、lh 是行高（都是 CSS px），基線依字型的上下緣算（跟瀏覽器排字的位置一樣）。
 * 回傳字寬（canvas px）。
 */
function line(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  top: number,
  lh: number,
  o: { px: number; weight: number; family: 'sans' | 'mono' | 'serif'; color: string; tracking?: number; align?: CanvasTextAlign },
): number {
  const fam = o.family === 'mono' ? MONO : o.family === 'serif' ? SERIF : SANS;
  // 基線相對行框中央的位置（em）：Plex Mono 上緣 1.025、下緣 0.275；思源黑體／宋體 1.16、0.288
  const k = o.family === 'mono' ? 0.375 : 0.436;
  setFont(ctx, `${o.weight} ${o.px * S}px ${fam}`, (o.tracking ?? 0) * o.px * S);
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = o.color;
  ctx.fillText(text, x, (top + lh / 2 + k * o.px) * S);
  const w = ctx.measureText(text).width;
  setFont(ctx, ctx.font, 0);
  ctx.textAlign = 'left';
  return w;
}

function measure(ctx: CanvasRenderingContext2D, text: string, px: number, weight: number, family: 'sans' | 'mono' | 'serif', tracking = 0): number {
  const fam = family === 'mono' ? MONO : family === 'serif' ? SERIF : SANS;
  setFont(ctx, `${weight} ${px * S}px ${fam}`, tracking * px * S);
  const w = ctx.measureText(text).width;
  setFont(ctx, ctx.font, 0);
  return w;
}

/** 燈質 F（定光）：8px 的實心小圓，跟觀測台燈質列的 light-glyph-f 一樣用燈質列的字色 */
function lampGlyph(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 4 * S, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * 燈質列：右對齊的「● 文字」（DataStamp：8px 記號、6px 間距、12px 等寬字）。right、top、lh 是 CSS px。
 */
function stamp(ctx: CanvasRenderingContext2D, text: string, right: number, top: number, lh: number, color: string, glyph = true) {
  const tw = measure(ctx, text, 12, 500, 'mono', 0.02);
  line(ctx, text, right * S, top, lh, { px: 12, weight: 500, family: 'mono', color, tracking: 0.02, align: 'right' });
  if (glyph) lampGlyph(ctx, right * S - tw - 6 * S - 4 * S, (top + lh / 2) * S, color);
}

/** 圖廓：外框＋上緣與左緣的刻度（每 10px 短刻度、每 50px 長刻度），回傳內框 */
function neatline(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, t: ScreenTokens) {
  ctx.fillStyle = t.strong;
  const px = S;
  ctx.fillRect(x, y, w, px);
  ctx.fillRect(x, y + h - px, w, px);
  ctx.fillRect(x, y, px, h);
  ctx.fillRect(x + w - px, y, px, h);
  for (let i = 0; i * 10 * S < w; i++) ctx.fillRect(x + i * 10 * S, y, px, (i % 5 ? 4 : 8) * S);
  for (let i = 0; i * 10 * S < h; i++) ctx.fillRect(x, y + h - i * 10 * S - px, (i % 5 ? 4 : 8) * S, px);
  const inset = 9 * S;
  const ix = x + inset;
  const iy = y + inset;
  const iw = w - inset * 2;
  const ih = h - inset * 2;
  ctx.fillRect(ix, iy, iw, px);
  ctx.fillRect(ix, iy + ih - px, iw, px);
  ctx.fillRect(ix, iy, px, ih);
  ctx.fillRect(ix + iw - px, iy, px, ih);
  return { x: ix + px, y: iy + px, w: iw - px * 2, h: ih - px * 2 };
}

function niceStep(range: number, count: number): number {
  const raw = range / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

/** 收盤線：主線用墨色（DESIGN §8 單一主線），只有最後一點用漲跌色；縱軸依收盤的最低最高自動縮放 */
function closeLine(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  closes: number[],
  t: ScreenTokens,
  endTone: string | null,
  axis: boolean,
  inset = 12,
) {
  const axisW = axis ? 56 * S : 0;
  const P = { x: box.x + inset * S, y: box.y + inset * S, w: box.w - inset * 2 * S - axisW, h: box.h - inset * 2 * S };
  const { lo, hi } = closeRange(closes);
  const yOf = (v: number) => P.y + ((hi - v) / (hi - lo)) * P.h;
  const xOf = (i: number) => P.x + (P.w * i) / (closes.length - 1);
  if (axis) {
    const step = niceStep(hi - lo, Math.max(2, Math.min(6, Math.round(P.h / (44 * S)))));
    const dp = Math.max(0, Math.min(2, -Math.floor(Math.log10(step))));
    setFont(ctx, `400 ${11 * S}px ${MONO}`);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const y = Math.round(yOf(v));
      ctx.fillStyle = t.border;
      ctx.fillRect(P.x, y, P.w, S);
      ctx.fillStyle = t.muted;
      ctx.fillText(v.toFixed(dp), P.x + P.w + 10 * S, y);
    }
    ctx.textBaseline = 'alphabetic';
  }
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  closes.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
  ctx.stroke();
  const lx = xOf(closes.length - 1);
  const ly = yOf(closes[closes.length - 1]);
  ctx.fillStyle = endTone ?? t.text;
  ctx.beginPath();
  ctx.arc(lx, ly, 3.5 * S, 0, Math.PI * 2);
  ctx.fill();
}

/** 走勢線（觀測台 Sparkline 的同一組點：viewBox 100×40、preserveAspectRatio none、1.5px 線） */
function sparkLine(ctx: CanvasRenderingContext2D, spark: SparkLine, x: number, y: number, w: number, h: number) {
  if (spark.points.length < 2) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = spark.color;
  ctx.lineWidth = 1.5 * S;
  ctx.beginPath();
  spark.points.forEach(([px, py], i) => {
    const X = (x + (px / 100) * w) * S;
    const Y = (y + (py / 40) * h) * S;
    if (i) ctx.lineTo(X, Y);
    else ctx.moveTo(X, Y);
  });
  ctx.stroke();
}

/* ---------- 海報用的中性圖形（不寫任何數字或日期） ---------- */

/** 一條平緩起伏的無日期走勢線 */
const GLYPH = [0.42, 0.46, 0.4, 0.5, 0.47, 0.55, 0.52, 0.6, 0.57, 0.54, 0.63, 0.6, 0.68, 0.64, 0.7, 0.66, 0.74, 0.71, 0.78, 0.76];

/** 經緯格線：細線、每五格一條稍粗（海圖的方格，不是表格的列） */
function graticule(ctx: CanvasRenderingContext2D, box: { x: number; y: number; w: number; h: number }, t: ScreenTokens, step = 24) {
  const s = step * S;
  ctx.fillStyle = t.border;
  let k = 0;
  for (let x = box.x + s; x < box.x + box.w - 2; x += s, k++) ctx.fillRect(Math.round(x), box.y, k % 4 === 3 ? 2 * S : S, box.h);
  k = 0;
  for (let y = box.y + box.h - s; y > box.y + 2; y -= s, k++) ctx.fillRect(box.x, Math.round(y), box.w, k % 4 === 3 ? 2 * S : S);
}

/** 海報：整面是一張圖廓裡的海圖格線加一條線（中間螢幕是走勢線，左邊是羅經花，右邊是水平線上的燈質刻度） */
function idleDrawing(ctx: CanvasRenderingContext2D, w: number, h: number, t: ScreenTokens, kind: FaceKey) {
  fill(ctx, w, h, t.card);
  const box = neatline(ctx, PAD, PAD, w - PAD * 2, h - PAD * 2, t);
  graticule(ctx, box, t);
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 1.5 * S;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (kind === 'center') {
    closeLine(ctx, box, GLYPH, t, null, false, 16);
    return;
  }
  if (kind === 'left') {
    // 羅經花：兩圈、十六道方位線，四個主方位是實心的尖
    const cx = box.x + box.w * 0.5;
    const cy = box.y + box.h * 0.5;
    const r = Math.min(box.w, box.h) * 0.34;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.78, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = S;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.2, cy + Math.sin(a) * r * 0.2);
      ctx.lineTo(cx + Math.cos(a) * r * (i % 4 ? 0.9 : 1.12), cy + Math.sin(a) * r * (i % 4 ? 0.9 : 1.12));
      ctx.stroke();
    }
    ctx.fillStyle = t.text;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.74, cy + Math.sin(a) * r * 0.74);
      ctx.lineTo(cx + Math.cos(a + 0.32) * r * 0.16, cy + Math.sin(a + 0.32) * r * 0.16);
      ctx.lineTo(cx + Math.cos(a - 0.32) * r * 0.16, cy + Math.sin(a - 0.32) * r * 0.16);
      ctx.closePath();
      ctx.fill();
    }
    return;
  }
  // 右：燈質 Fl W 10s 的時序圖（燈塔表的畫法：一條時間軸，每十秒一道短閃——軸上凸起的一小格），都是圖形，沒有字
  const hy = box.y + box.h * 0.62;
  const x0 = box.x + 16 * S;
  const x1 = box.x + box.w - 16 * S;
  const n = 5;
  const step = (x1 - x0) / n;
  const flash = Math.min(10 * S, step * 0.12);
  const rise = 26 * S;
  ctx.beginPath();
  ctx.moveTo(x0, hy);
  for (let i = 0; i < n; i++) {
    const fx = x0 + step * (i + 0.5) - flash / 2;
    ctx.lineTo(fx, hy);
    ctx.lineTo(fx, hy - rise);
    ctx.lineTo(fx + flash, hy - rise);
    ctx.lineTo(fx + flash, hy);
  }
  ctx.lineTo(x1, hy);
  ctx.stroke();
}

/* ---------- 桌上的畫面（16:9，大字） ---------- */

/** 面板標題列（桌上版）：左邊 13px 小標、右邊燈質列；line=true 時底下一條線。回傳標題列下緣（CSS px） */
function deskHead(ctx: CanvasRenderingContext2D, w: number, title: string, stampText: string | null, t: ScreenTokens, strongRule: boolean | null): number {
  line(ctx, title, PAD, 12, 20, { px: 13, weight: 500, family: 'sans', color: t.muted, tracking: 0.04 });
  if (stampText) stamp(ctx, stampText, w / S - 20, 12, 20, t.muted);
  const bottom = 12 + 20 + 12;
  if (strongRule != null) rule(ctx, 0, bottom * S, w, strongRule ? t.strong : t.border);
  return bottom + 1;
}

function waiting(ctx: CanvasRenderingContext2D, top: number, t: ScreenTokens) {
  line(ctx, '讀取中…', PAD, top + 12, 20, { px: 13, weight: 500, family: 'sans', color: t.muted });
}

/** 觀測清單「N 檔 · 依產業」（跟觀測台的燈質列同一句話） */
function watchStamp(data: ScreenData): string | null {
  return data.stockCount != null ? `${data.stockCount.toLocaleString('zh-TW')} 檔 · 依產業` : null;
}

function deskLeft(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, t: ScreenTokens, narrow: boolean) {
  if (data.idle) return idleDrawing(ctx, w, h, t, 'left');
  fill(ctx, w, h, t.card);
  const top = deskHead(ctx, w, '觀測清單', watchStamp(data), t, true);
  if (data.stockCount == null) return waiting(ctx, top, t);
  // 讀數：檔數與產業數（大字，在桌上也讀得到）；窄螢幕時左螢幕只露出靠中間的那一半，讀數靠右
  const row = (y: number, num: string, numPx: number, unit: string, unitPx: number) => {
    const nw = measure(ctx, num, numPx, 600, 'mono', -0.02);
    const uw = measure(ctx, unit, unitPx, 700, 'sans');
    let x = narrow ? w - PAD - (nw + 8 * S + uw) : PAD;
    line(ctx, num, x, y, numPx, { px: numPx, weight: 600, family: 'mono', color: t.text, tracking: -0.02 });
    x += nw + 8 * S;
    line(ctx, unit, x, y + (numPx - unitPx) * 0.62, unitPx, { px: unitPx, weight: 700, family: 'sans', color: t.text });
  };
  row(top + 22, data.stockCount.toLocaleString('zh-TW'), 52, '檔', 20);
  if (data.industryCount != null) row(top + 22 + 64, data.industryCount.toLocaleString('zh-TW'), 34, '個產業', 16);
}

/** 報價區（襯線名稱、燈質列、大字收盤與單日漲跌）。回傳報價區下緣（CSS px）。compact：窄螢幕的兩行排法 */
function quoteBlock(
  ctx: CanvasRenderingContext2D,
  w: number,
  data: ScreenData,
  pal: ChartPalette,
  t: ScreenTokens,
  o: { x: number; top: number; closePx: number; compact: boolean },
): number {
  const m = data.monitor!;
  const closes = m.closes.filter((v) => Number.isFinite(v));
  const last = closes[closes.length - 1];
  const day = dayChange(closes);
  const charText = quoteCharacteristic(m.symbol, data.industry, m.date);
  const changeLabel = day ? (changeText(day.change, last - day.change) ?? '') : '';
  const right = w / S - o.x;
  const leftW = Math.max(measure(ctx, m.name, 24, 900, 'serif', 0.06), measure(ctx, charText, 12, 500, 'mono', 0.02)) / S;
  const closeW = measure(ctx, fmtPrice(last), o.closePx, 600, 'mono', -0.025) / S;
  const changeW = changeLabel ? measure(ctx, changeLabel, 14, 400, 'mono') / S : 0;
  const figW = closeW + (changeLabel ? 12 + changeW : 0);
  // 名稱區塊：名稱 24px（行高 30）＋ mt-1 ＋ 燈質列 12px（行高 16.8）
  const nameTop = o.top;
  const charTop = nameTop + 30 + 4;
  const blockBottom = charTop + 16.8;
  if (o.compact) {
    // 窄的桌上螢幕：第一行名稱｜收盤、第二行燈質列｜漲跌（兩邊靠右對齊），下面整塊留給走勢圖
    line(ctx, m.name, o.x * S, nameTop, 30, { px: 24, weight: 900, family: 'serif', color: t.text, tracking: 0.06 });
    line(ctx, fmtPrice(last), right * S, nameTop + 30 - o.closePx, o.closePx, { px: o.closePx, weight: 600, family: 'mono', color: t.text, tracking: -0.025, align: 'right' });
    setFont(ctx, ctx.font, 0);
    const shortChar = [m.symbol, `收盤 ${m.date}`].join(' · ');
    line(ctx, shortChar, o.x * S, charTop, 16.8, { px: 12, weight: 500, family: 'mono', color: t.muted, tracking: 0.02 });
    if (day && changeLabel) line(ctx, changeLabel, right * S, charTop, 16.8, { px: 13, weight: 400, family: 'mono', color: toneOf(day.change, pal), align: 'right' });
    return blockBottom;
  }
  line(ctx, m.name, o.x * S, nameTop, 30, { px: 24, weight: 900, family: 'serif', color: t.text, tracking: 0.06 });
  line(ctx, charText, o.x * S, charTop, 16.8, { px: 12, weight: 500, family: 'mono', color: t.muted, tracking: 0.02 });
  // 收盤與漲跌：放得下就在右側、底端跟名稱區塊對齊（items-end）；放不下就換到下一行、靠左（flex-wrap、gap-y-3）
  const oneRow = leftW + 24 + figW <= right - o.x;
  const figTop = oneRow ? blockBottom - o.closePx : blockBottom + 12;
  let x = oneRow ? right - figW : o.x;
  line(ctx, fmtPrice(last), x * S, figTop, o.closePx, { px: o.closePx, weight: 600, family: 'mono', color: t.text, tracking: -0.025 });
  x += closeW + 12;
  if (day && changeLabel) {
    // items-baseline：漲跌的基線跟收盤一樣
    const base = figTop + o.closePx / 2 + 0.375 * o.closePx;
    const lh = 20;
    line(ctx, changeLabel, x * S, base - lh / 2 - 0.375 * 14, lh, { px: 14, weight: 400, family: 'mono', color: toneOf(day.change, pal) });
  }
  return oneRow ? blockBottom : figTop + o.closePx;
}

function deskCenter(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, pal: ChartPalette, t: ScreenTokens, narrow: boolean) {
  if (data.idle) return idleDrawing(ctx, w, h, t, 'center');
  fill(ctx, w, h, t.card);
  const m = data.monitor;
  const closes = m ? m.closes.filter((v) => Number.isFinite(v)) : [];
  if (!m || closes.length < 2) {
    waiting(ctx, 8, t);
    return;
  }
  const bottom = quoteBlock(ctx, w, data, pal, t, { x: 20, top: 16, closePx: narrow ? 28 : 40, compact: narrow });
  rule(ctx, PAD, (bottom + 10) * S, w - PAD * 2, t.border);
  // 圖廓：報價下方到螢幕底（窄螢幕的報價只有兩行，圖廓佔螢幕一半以上，收盤線用得到整個縱軸）
  const top = (bottom + 18) * S;
  const box = neatline(ctx, PAD, top, w - PAD * 2, Math.max(60 * S, h - top - 14 * S), t);
  const day = dayChange(closes);
  closeLine(ctx, box, closes, t, day ? toneOf(day.change, pal) : null, !narrow, narrow ? 6 : 12);
}

function deskRight(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, pal: ChartPalette, t: ScreenTokens) {
  if (data.idle) return idleDrawing(ctx, w, h, t, 'right');
  fill(ctx, w, h, t.card);
  const b = data.board;
  const top = deskHead(ctx, w, '加權指數', b ? `收盤 ${b.date}` : null, t, null);
  if (!b) return waiting(ctx, top, t);
  line(ctx, fmtNum(b.close), PAD, top + 6, 44, { px: 36, weight: 600, family: 'mono', color: t.text, tracking: -0.025 });
  if (b.change != null && Number.isFinite(b.change)) {
    // 百分比：漲跌相對前一筆收盤（close − change），與觀測台大盤列的算法相同
    line(ctx, changeText(b.change, b.close - b.change) ?? '', PAD, top + 6 + 46, 22, { px: 16, weight: 400, family: 'mono', color: toneOf(b.change, pal) });
  }
  if (data.spark) sparkLine(ctx, data.spark, 20, top + 6 + 46 + 34, w / S - 40, Math.min(56, h / S - (top + 6 + 46 + 34) - 18));
}

/* ---------- 交接終點的畫面（觀測台那一欄） ---------- */

/** 左欄：觀測清單的標題列（px-5 py-3、粗線）、產業分組列（--muted 底、12px）、一檔一列（min-h-14） */
function endLeft(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, t: ScreenTokens, narrow: boolean) {
  fill(ctx, w, h, t.card);
  if (data.idle) return;
  const W = w / S;
  const pad = narrow ? 16 : 20;
  line(ctx, '觀測清單', pad * S, 12, 19.5, { px: 13, weight: 500, family: 'sans', color: t.muted, tracking: 0.04 });
  const st = watchStamp(data);
  if (st) stamp(ctx, st, W - pad, 12, 19.5, t.muted);
  let y = 12 + 19.5 + 12;
  rule(ctx, 0, y * S, w, t.strong);
  y += 1;
  const items = data.watch ?? [];
  if (!items.length) {
    if (data.stockCount == null) waiting(ctx, y, t);
    return;
  }
  const selected = data.monitor?.symbol ?? null;
  for (const g of groupWatch(items)) {
    if (y * S > h) break;
    ctx.fillStyle = t.mutedBg;
    ctx.fillRect(0, y * S, w, 28 * S);
    line(ctx, g.name, pad * S, y + 6, 16, { px: 12, weight: 500, family: 'sans', color: t.muted, tracking: 0.04 });
    y += 28;
    rule(ctx, 0, y * S, w, t.border);
    y += 1;
    for (const r of g.rows) {
      if (y * S > h) break;
      if (r.symbol === selected) {
        ctx.fillStyle = t.accent;
        ctx.fillRect(0, y * S, w, 56 * S);
        ctx.fillStyle = t.brand;
        ctx.fillRect(0, y * S, 2 * S, 56 * S);
      }
      line(ctx, r.symbol, pad * S, y + 18, 20, { px: 13.5, weight: 500, family: 'mono', color: t.text });
      line(ctx, r.name || r.symbol, (pad + 56 + 12) * S, y + 18, 20, { px: 14, weight: 500, family: 'sans', color: t.text });
      y += 56;
      rule(ctx, 0, y * S, w, t.border);
      y += 1;
    }
  }
  // 觀測台寬螢幕的清單在欄底有一段 2.5rem 的淡出（mask），這裡用同一段淡到面板色
  if (!narrow) {
    const fadeH = 40 * S;
    const g = ctx.createLinearGradient(0, h - fadeH, 0, h);
    g.addColorStop(0, hexAlpha(t.card, 0));
    g.addColorStop(1, hexAlpha(t.card, 1));
    ctx.fillStyle = g;
    ctx.fillRect(0, h - fadeH, w, fadeH);
  }
}

/** CSS 顏色加透明度（canvas 漸層用）：先讓 canvas 正規化成 rgb */
const alphaCtx = typeof document === 'undefined' ? null : (makeCanvas(1, 1).getContext('2d') as CanvasRenderingContext2D | null);
function hexAlpha(css: string, a: number): string {
  if (!alphaCtx) return css;
  alphaCtx.clearRect(0, 0, 1, 1);
  alphaCtx.fillStyle = '#000';
  alphaCtx.fillStyle = css;
  alphaCtx.fillRect(0, 0, 1, 1);
  const [r, g, b] = alphaCtx.getImageData(0, 0, 1, 1).data;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 中欄：觀測台的報價面板（p-5；手機 p-4，最上面一列「正在看觀測清單裡的一檔／換一檔」）。
 * 報價區下面，觀測台是開高低收與 K 線；這裡沒有那些資料，所以直接是圖廓裡的收盤線（一路到欄底，不畫空白的列）。
 */
function endCenter(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, pal: ChartPalette, t: ScreenTokens, narrow: boolean, vw: number) {
  fill(ctx, w, h, t.card);
  if (data.idle) return;
  const W = w / S;
  const pad = narrow ? (W >= 600 ? 20 : 16) : 20;
  let top = pad;
  if (narrow) {
    line(ctx, '正在看觀測清單裡的一檔', pad * S, 0, 44, { px: 13, weight: 400, family: 'sans', color: t.subtle });
    // 「換一檔 ↓」：字＋14px 的向下箭頭
    const ax = W - pad - 7;
    ctx.strokeStyle = t.text;
    ctx.lineWidth = 1.6 * S;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(ax * S, 16.5 * S);
    ctx.lineTo(ax * S, 27.5 * S);
    ctx.moveTo((ax - 4) * S, 23.5 * S);
    ctx.lineTo(ax * S, 27.5 * S);
    ctx.lineTo((ax + 4) * S, 23.5 * S);
    ctx.stroke();
    line(ctx, '換一檔', (W - pad - 14 - 4) * S, 0, 44, { px: 13, weight: 500, family: 'sans', color: t.text, align: 'right' });
    rule(ctx, 0, 44 * S, w, t.border);
    top = 45 + 16;
  }
  const m = data.monitor;
  const closes = m ? m.closes.filter((v) => Number.isFinite(v)) : [];
  if (!m || closes.length < 2) {
    waiting(ctx, top - 12, t);
    return;
  }
  // 收盤的字級跟觀測台一樣是 clamp(30px, 3vw, 40px)
  const closePx = Math.max(30, Math.min(40, vw * 0.03));
  const bottom = quoteBlock(ctx, w, data, pal, t, { x: pad, top, closePx, compact: false });
  const boxTop = (bottom + 16) * S;
  const box = neatline(ctx, pad * S, boxTop, w - pad * 2 * S, Math.max(80 * S, h - boxTop - pad * S), t);
  const day = dayChange(closes);
  closeLine(ctx, box, closes, t, day ? toneOf(day.change, pal) : null, W >= 420);
}

/**
 * 右欄：觀測台的「加權指數」面板（LedgerPanel：p-5、標題列 mb-3、收盤 24px 與漲跌 14px 同一條基線、mt-3 的 40px 走勢線）。
 * 畫面的高度就是這一格面板的高度（交接時右邊只升起這一格）。
 */
function endRight(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData, pal: ChartPalette, t: ScreenTokens) {
  fill(ctx, w, h, t.card);
  if (data.idle) return;
  const W = w / S;
  const b = data.board;
  line(ctx, '加權指數', 20 * S, 20, 19.5, { px: 13, weight: 500, family: 'sans', color: t.muted, tracking: 0.04 });
  if (!b) {
    stamp(ctx, '資料日未載入', W - 20, 20, 19.5, t.muted);
    waiting(ctx, 40, t);
    return;
  }
  stamp(ctx, `收盤 ${b.date}`, W - 20, 20, 19.5, t.muted);
  const rowTop = 20 + 19.5 + 12;
  line(ctx, fmtNum(b.close), 20 * S, rowTop, 32, { px: 24, weight: 600, family: 'mono', color: t.text, tracking: -0.025 });
  if (b.change != null && Number.isFinite(b.change)) {
    const base = rowTop + 16 + 0.375 * 24;
    line(ctx, changeText(b.change, b.close - b.change) ?? '', (W - 20) * S, base - 10 - 0.375 * 14, 20, {
      px: 14,
      weight: 400,
      family: 'mono',
      color: toneOf(b.change, pal),
      align: 'right',
    });
  }
  if (data.spark) sparkLine(ctx, data.spark, 20, rowTop + 32 + 12, W - 40, 40);
}

/** 牆上的看板：兩行、固定不跑馬——加權指數收盤與漲跌、資料日（看板一律是黑底燈色字，所以用夜間色盤） */
function drawBoard(ctx: CanvasRenderingContext2D, w: number, h: number, data: ScreenData) {
  const pal = getChartPalette(true);
  ctx.fillStyle = '#050505';
  ctx.fillRect(0, 0, w, h);
  // LED 點陣的底紋
  ctx.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 4; y < h; y += 8) for (let x = 4; x < w; x += 8) ctx.fillRect(x - 1.5, y - 1.5, 3, 3);

  type Seg = { t: string; c: string; f: string };
  const b = data.idle ? null : data.board;
  const label = (px: number) => `500 ${px}px ${SANS}`;
  const num = (px: number) => `600 ${px}px ${MONO}`;
  const lines: Seg[][] = [];
  if (b) {
    const top: Seg[] = [
      { t: '加權指數 收盤 ', c: pal.brand, f: label(92) },
      { t: fmtNum(b.close), c: pal.brand, f: num(92) },
    ];
    if (b.change != null && Number.isFinite(b.change)) {
      top.push({ t: '  ', c: pal.brand, f: num(92) }, { t: signedText(b.change), c: toneOf(b.change, pal), f: num(92) });
    }
    lines.push(top, [
      { t: b.date, c: pal.brand, f: num(66) },
      { t: ' · 非即時 · 最近儲存的收盤', c: pal.brand, f: label(66) },
    ]);
  } else {
    lines.push([{ t: '最近儲存的收盤資料 · 非即時', c: pal.brand, f: label(80) }]);
  }
  const widthOf = (segs: Seg[]) =>
    segs.reduce((s, g) => {
      ctx.font = g.f;
      return s + ctx.measureText(g.t).width;
    }, 0);
  const max = w - 96;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.shadowBlur = 12;
  lines.forEach((segs, li) => {
    let total = widthOf(segs);
    if (total > max) {
      const k = max / total;
      segs.forEach((g) => {
        g.f = g.f.replace(/(\d+)px/, (_, n) => `${Math.floor(Number(n) * k)}px`);
      });
      total = widthOf(segs);
    }
    const y = lines.length === 1 ? h / 2 : li === 0 ? h * 0.35 : h * 0.76;
    let x = (w - total) / 2;
    for (const g of segs) {
      ctx.font = g.f;
      ctx.fillStyle = g.c;
      ctx.shadowColor = g.c;
      ctx.fillText(g.t, x, y);
      x += ctx.measureText(g.t).width;
    }
  });
  ctx.shadowBlur = 0;
}

/**
 * 依資料與主題重畫全部畫面。narrow：交接終點只有一欄（手機），中間螢幕用窄的排法、左螢幕的讀數靠右；
 * vw：舞台寬（CSS px，觀測台收盤字級的 3vw）
 */
export function drawScreens(c: ScreenCanvases, data: ScreenData, isDark: boolean, tokens: ScreenTokens, narrow = false, vw = 1440) {
  const pal = getChartPalette(isDark);
  const g = (cv: HTMLCanvasElement) => cv.getContext('2d') as CanvasRenderingContext2D;
  deskCenter(g(c.desk.center), c.desk.center.width, c.desk.center.height, data, pal, tokens, narrow);
  deskLeft(g(c.desk.left), c.desk.left.width, c.desk.left.height, data, tokens, narrow);
  deskRight(g(c.desk.right), c.desk.right.width, c.desk.right.height, data, pal, tokens);
  endCenter(g(c.end.center), c.end.center.width, c.end.center.height, data, pal, tokens, narrow, vw);
  endLeft(g(c.end.left), c.end.left.width, c.end.left.height, data, tokens, narrow);
  endRight(g(c.end.right), c.end.right.width, c.end.right.height, data, pal, tokens);
  drawBoard(g(c.board), c.board.width, c.board.height, data);
}

/** 等 canvas 要用的字型載入（最多等 2.5 秒；載不到就用後備字型） */
export async function loadScreenFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  const text = '讀取中…加權指數收盤資料日未載入非即時檔個產業依觀測清單正在看裡的一換資料庫收錄每一紀錄都標著期最近儲存的0123456789.,+−%·（）台積電半導體業';
  const jobs = [`900 48px ${SERIF}`, `500 26px ${SANS}`, `400 26px ${SANS}`, `700 32px ${SANS}`, `400 28px ${MONO}`, `500 24px ${MONO}`, `600 80px ${MONO}`].map((f) =>
    document.fonts.load(f, text).catch(() => []),
  );
  await Promise.race([Promise.all(jobs), new Promise((r) => setTimeout(r, 2500))]);
}
