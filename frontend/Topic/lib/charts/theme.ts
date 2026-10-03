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
  grid: '#cfd8df',
  gridSubtle: '#e6edf1',
  tick: '#2c3a46',
  tickMuted: '#4f5f6c',
  tooltipBg: '#ffffff',
  tooltipText: '#0e1a24',
  tooltipBorder: '#0e1a24',
  referenceLine: '#8696a3',
  text: '#0e1a24',
  brand: '#f2b347',
  up: '#b8282e',
  down: '#0f7a4a',
  flat: '#8696a3',
  volumeUp: 'rgba(184, 40, 46, 0.55)',
  volumeDown: 'rgba(15, 122, 74, 0.55)',
  volumeFlat: 'rgba(134, 150, 163, 0.55)',
};

const DARK: ChartPalette = {
  grid: '#1c2630',
  gridSubtle: '#131a21',
  tick: '#b4bec8',
  tickMuted: '#8a96a2',
  tooltipBg: '#131a21',
  tooltipText: '#dfe4e9',
  tooltipBorder: '#6b7a88',
  referenceLine: '#5b6b79',
  text: '#dfe4e9',
  brand: '#f2b347',
  up: '#ef5b5f',
  down: '#1fb46f',
  flat: '#5b6b79',
  volumeUp: 'rgba(239, 91, 95, 0.55)',
  volumeDown: 'rgba(31, 180, 111, 0.55)',
  volumeFlat: 'rgba(91, 107, 121, 0.55)',
};

export function getChartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}

/**
 * 均線色：避開漲跌的紅綠（決議 D8），也避開燈色（金色只當光用）；對應 --chart-1…5。
 * MA5 藍、MA10 紫、MA20 青、MA60 褐、MA120 灰藍。
 */
export function getMaColors(isDark: boolean) {
  return {
    MA5: isDark ? '#7fb0dc' : '#4a7fb0',
    MA10: isDark ? '#a79be0' : '#7a6fb5',
    MA20: isDark ? '#5fc0d2' : '#2b8ca3',
    MA60: isDark ? '#c9a27e' : '#8a6a4a',
    MA120: isDark ? '#9aa6b2' : '#6b7785',
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

/** AI 對話圖表用的類別色：SERIES_PALETTE 去掉橘、琥珀、褐與洋紅，線條才不會被看成燈色或漲色 */
const AI_EXCLUDED = new Set(['#f97316', '#d97706', '#a16207', '#92400e', '#db2777', '#831843']);
export const AI_SERIES_PALETTE = SERIES_PALETTE.filter((color) => !AI_EXCLUDED.has(color));

/**
 * 多股比較的股票代表色：依比較清單的順序取（最多 6 檔，決議 c76），同一次比較保證不撞色。
 * 藍、紫、青、洋紅、褐、灰藍：避開漲跌的紅綠，也避開接近燈色的橘與琥珀；亮度取中間值，晨海與夜海都看得清楚。
 */
export const COMPARE_SYMBOL_COLORS = ['#3b82f6', '#a855f7', '#06a3c4', '#e0559a', '#a47148', '#7d8ea3'] as const;

/**
 * 相關係數色階：負相關藍 → 0 中性灰 → 正相關橘，避開紅綠（決議 D8-c9）。
 * 格子與圖例都用這個函式，色階才會一致；文字固定用 palette.text（兩端顏色都已確認對比 ≥ 4.5）。
 */
const CORRELATION_STOPS = {
  light: { neg: [91, 143, 209], mid: [230, 237, 241], pos: [232, 145, 74] },
  dark: { neg: [47, 95, 153], mid: [40, 52, 63], pos: [154, 84, 32] },
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
