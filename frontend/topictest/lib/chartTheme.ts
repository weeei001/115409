/**
 * Recharts／SVG 需使用已解析色值；數值對齊 styles/main.css 語意代幣。
 */
export interface ChartPalette {
  grid: string;
  gridSubtle: string;
  tick: string;
  tickMuted: string;
  tooltipBg: string;
  tooltipText: string;
  tooltipShadow: string;
  referenceLine: string;
  heatmapNullBg: string;
  heatmapTextStrong: string;
  heatmapTextWeak: string;
  brand: string;
  up: string;
  down: string;
  volumeUp: string;
  volumeDown: string;
  priceBarUp: string;
  priceBarDown: string;
}

export function getChartPalette(isDark: boolean): ChartPalette {
  if (isDark) {
    return {
      grid: 'rgba(255, 255, 255, 0.08)',
      gridSubtle: 'rgba(255, 255, 255, 0.06)',
      tick: '#9A9896',
      tickMuted: '#6B6966',
      tooltipBg: '#161618',
      tooltipText: '#E8E6E3',
      tooltipShadow: '0 8px 32px rgba(0, 0, 0, 0.45)',
      referenceLine: '#6B6966',
      heatmapNullBg: '#1C1C1F',
      heatmapTextStrong: '#E8E6E3',
      heatmapTextWeak: '#9A9896',
      brand: '#ffa95a',
      up: '#d06565',
      down: '#649a7e',
      volumeUp: 'rgba(208, 101, 101, 0.65)',
      volumeDown: 'rgba(100, 154, 126, 0.65)',
      priceBarUp: 'rgba(208, 101, 101, 0.55)',
      priceBarDown: 'rgba(100, 154, 126, 0.55)',
    };
  }
  return {
    grid: 'rgba(0, 0, 0, 0.08)',
    gridSubtle: 'rgba(0, 0, 0, 0.06)',
    tick: '#6B7280',
    tickMuted: '#9CA3AF',
    tooltipBg: '#FFFFFF',
    tooltipText: '#1A1A1A',
    tooltipShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
    referenceLine: '#9CA3AF',
    heatmapNullBg: '#F1F3F5',
    heatmapTextStrong: '#1A1A1A',
    heatmapTextWeak: '#6B7280',
    brand: '#ffa95a',
    up: '#d06565',
    down: '#649a7e',
      volumeUp: 'rgba(208, 101, 101, 0.65)',
      volumeDown: 'rgba(100, 154, 126, 0.65)',
      priceBarUp: 'rgba(208, 101, 101, 0.55)',
      priceBarDown: 'rgba(100, 154, 126, 0.55)',
    };
  }

/** 與 main.css --color-up / --color-down 一致 */
export const CHART_UP = '#d06565';
export const CHART_DOWN = '#649a7e';

/** K 線／技術線配色（與主題無關，維持辨識度） */
export const MA_LINE_COLORS: Record<string, string> = {
  MA5: '#ffa95a',
  MA10: '#7B9EB8',
  MA20: '#9B8EC4',
  MA60: '#6B9B7E',
  MA120: '#C47B7B',
};
