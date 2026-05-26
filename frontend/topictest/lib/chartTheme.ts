import type { EChartsOption } from 'echarts';

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

export type ChartMarkerShape = 'square' | 'circle' | 'arrowUp' | 'arrowDown';

export interface ChartMarkerStyle {
  color: string;
  shape: ChartMarkerShape;
  text: string;
}

export type ChartMarkerStyleKey =
  | 'state_buy'
  | 'state_sell'
  | 'state_hold'
  | 'entry'
  | 'exit';

/** lightweight-charts 策略標記：對齊台股紅漲綠跌語意 */
export function getChartMarkerStyles(palette: ChartPalette): Record<ChartMarkerStyleKey, ChartMarkerStyle> {
  return {
    state_buy: { color: palette.up, shape: 'square', text: '買訊' },
    state_sell: { color: palette.down, shape: 'square', text: '賣訊' },
    state_hold: { color: palette.brand, shape: 'circle', text: '持平' },
    entry: { color: palette.up, shape: 'arrowUp', text: '買進' },
    exit: { color: palette.down, shape: 'arrowDown', text: '賣出' },
  };
}

export interface LightweightChartLayoutOptions {
  layout: { background: { color: string }; textColor: string; fontFamily: string; attributionLogo: boolean };
  grid: { vertLines: { color: string }; horzLines: { color: string } };
  rightPriceScale: { borderColor: string };
  timeScale: { borderColor: string };
  series: {
    close: string;
    ma20: string;
    ma60: string;
    volumeFallback: string;
  };
}

export function getLightweightChartLayoutOptions(
  palette: ChartPalette,
  isDark: boolean,
): LightweightChartLayoutOptions {
  const closeLine = isDark ? palette.tooltipText : palette.heatmapTextStrong;
  return {
    layout: {
      background: { color: 'transparent' },
      textColor: palette.tick,
      fontFamily: 'Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif',
      attributionLogo: false,
    },
    grid: {
      vertLines: { color: palette.gridSubtle },
      horzLines: { color: palette.gridSubtle },
    },
    rightPriceScale: { borderColor: palette.grid },
    timeScale: { borderColor: palette.grid },
    series: {
      close: closeLine,
      ma20: MA_LINE_COLORS.MA20,
      ma60: MA_LINE_COLORS.MA60,
      volumeFallback: palette.grid,
    },
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

export function getEChartsBaseOption(isDark: boolean): Pick<
  EChartsOption,
  'animation' | 'grid' | 'tooltip'
> {
  const palette = getChartPalette(isDark);
  return {
    animation: false,
    grid: { left: 48, right: 16, top: 28, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      backgroundColor: palette.tooltipBg,
      borderColor: palette.grid,
      textStyle: { color: palette.tooltipText, fontSize: 12 },
    },
  };
}
