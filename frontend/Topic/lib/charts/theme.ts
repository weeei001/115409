/**
 * 圖表用的解析後色值（ECharts／lightweight-charts 不吃 CSS 變數）。
 * 數值必須與 styles/main.css 的 token 一致，改一邊就要改另一邊。
 */
export interface ChartPalette {
  grid: string;
  gridSubtle: string;
  tick: string;
  tickMuted: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipBorder: string;
  referenceLine: string;
  text: string;
  brand: string;
  up: string;
  down: string;
  flat: string;
  volumeUp: string;
  volumeDown: string;
  volumeFlat: string;
}

const LIGHT: ChartPalette = {
  grid: 'rgba(0, 0, 0, 0.08)',
  gridSubtle: 'rgba(0, 0, 0, 0.05)',
  tick: '#4b5563',
  tickMuted: '#6b7280',
  tooltipBg: '#ffffff',
  tooltipText: '#1a1a1a',
  tooltipBorder: 'rgba(0, 0, 0, 0.08)',
  referenceLine: '#9ca3af',
  text: '#1a1a1a',
  brand: '#ffa95a',
  up: '#d06565',
  down: '#649a7e',
  flat: '#9ca3af',
  volumeUp: 'rgba(208, 101, 101, 0.55)',
  volumeDown: 'rgba(100, 154, 126, 0.55)',
  volumeFlat: 'rgba(156, 163, 175, 0.55)',
};

const DARK: ChartPalette = {
  grid: 'rgba(255, 255, 255, 0.08)',
  gridSubtle: 'rgba(255, 255, 255, 0.05)',
  tick: '#a8a6a3',
  tickMuted: '#9a9896',
  tooltipBg: '#1c1c1f',
  tooltipText: '#e8e6e3',
  tooltipBorder: 'rgba(255, 255, 255, 0.08)',
  referenceLine: '#6b6966',
  text: '#e8e6e3',
  brand: '#ffa95a',
  up: '#d06565',
  down: '#649a7e',
  flat: '#6b6966',
  volumeUp: 'rgba(208, 101, 101, 0.55)',
  volumeDown: 'rgba(100, 154, 126, 0.55)',
  volumeFlat: 'rgba(107, 105, 102, 0.55)',
};

export function getChartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}

/** 均線色：刻意避開漲跌的紅綠（決議 D8）；對應 --chart-1…5 */
export function getMaColors(isDark: boolean) {
  return {
    MA5: '#ffa95a',
    MA10: '#7b9eb8',
    MA20: '#9b8ec4',
    MA60: isDark ? '#d9b44a' : '#a8821f',
    MA120: isDark ? '#b8946a' : '#9a7550',
  } as const;
}

/**
 * 類別色盤：區分不同股票／序列用，不帶漲跌意義，避開純紅純綠。
 * AI 對話的圖表序列用；多股比較另用下面依順序取的 6 色。
 */
export const SERIES_PALETTE = [
  '#f97316', '#2563eb', '#9333ea', '#0891b2', '#db2777', '#d97706', '#4f46e5', '#7c3aed',
  '#0284c7', '#a16207', '#92400e', '#581c87', '#155e75', '#831843', '#1d4ed8', '#3730a3',
] as const;

/**
 * 多股比較的股票代表色：依比較清單的順序取（最多 6 檔，決議 c76），同一次比較保證不撞色。
 * 從 SERIES_PALETTE 挑出彼此最分得開的 6 色，一樣避開漲跌的紅綠。
 */
export const COMPARE_SYMBOL_COLORS = ['#f97316', '#2563eb', '#9333ea', '#0891b2', '#db2777', '#a16207'] as const;

/**
 * 相關係數色階：負相關藍 → 0 中性灰 → 正相關橘，避開紅綠（決議 D8-c9）。
 * 格子與圖例都用這個函式，色階才會一致；文字固定用 palette.text（兩端顏色都已確認對比 ≥ 4.5）。
 */
const CORRELATION_STOPS = {
  light: { neg: [91, 143, 209], mid: [231, 229, 228], pos: [232, 145, 74] },
  dark: { neg: [47, 95, 153], mid: [58, 56, 54], pos: [154, 84, 32] },
} as const;

export function correlationColor(value: number, isDark: boolean): string {
  const stops = CORRELATION_STOPS[isDark ? 'dark' : 'light'];
  const v = Math.max(-1, Math.min(1, value));
  const [from, to, t] = v < 0 ? [stops.mid, stops.neg, -v] : [stops.mid, stops.pos, v];
  const mix = from.map((c, i) => Math.round(c + (to[i] - c) * t));
  return `rgb(${mix.join(', ')})`;
}

/** 圖例用：從 -1 到 +1 取樣同一個色階 */
export function correlationGradient(isDark: boolean): string {
  const samples = [-1, -0.5, 0, 0.5, 1].map((v) => correlationColor(v, isDark));
  return `linear-gradient(90deg, ${samples.join(', ')})`;
}

/** 三大法人各自的顏色（不依正負上色） */
export function getInstitutionColors(isDark: boolean) {
  const ma = getMaColors(isDark);
  return { foreign: ma.MA5, trust: ma.MA10, dealer: ma.MA20 } as const;
}
