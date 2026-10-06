import type {
  BusinessDay,
  CandlestickData,
  CandlestickSeriesPartialOptions,
  DeepPartial,
  HistogramData,
  HistogramSeriesPartialOptions,
  IChartApi,
  ISeriesApi,
  MouseEventParams,
  Time,
  TimeChartOptions,
} from 'lightweight-charts';
import type { ChartCandle, PriceChartData } from '../types/view';
import { KLINE_INTERACTION_OPTIONS } from './klineInteraction';
import type { ChartPalette } from './theme';

/** lightweight-charts 的 Time → YYYY-MM-DD（K 線與觀測台共用） */
export function timeToYmd(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')}`;
}

export function toBusinessDay(dateText: string): BusinessDay {
  const [year, month, day] = dateText.split('-').map(Number);
  return { year, month, day };
}

export function toCandlestickSeriesData(candles: ChartCandle[]): CandlestickData<Time>[] {
  return candles.map((item) => ({
    time: toBusinessDay(item.time),
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
  }));
}

export const PRICE_CHART_SERIES_KEYS = ['candles', 'close', 'MA5', 'MA10', 'MA20', 'MA60'] as const;
export type PriceChartSeriesKey = (typeof PRICE_CHART_SERIES_KEYS)[number];
export type PriceChartSeriesVisibility = Record<PriceChartSeriesKey, boolean>;

export const DEFAULT_PRICE_CHART_SERIES_VISIBILITY: PriceChartSeriesVisibility = {
  candles: true,
  close: true,
  MA5: true,
  MA10: true,
  MA20: true,
  MA60: true,
};

export function getNextPriceChartSeriesVisibility(
  current: PriceChartSeriesVisibility,
  key: PriceChartSeriesKey,
): PriceChartSeriesVisibility {
  return { ...current, [key]: !current[key] };
}

/*
 * 以下是 K 線圖（個股頁 PriceChart、首頁觀測台 TerminalKline）共用的設定。
 * 只引入 lightweight-charts 的型別：套件只有 ESM，node 測試（tsx）無法 require；
 * 加序列（CandlestickSeries、HistogramSeries）仍在元件裡做。
 */

/** createChart 的共用選項；時間軸、右側價格軸與字型各圖不同，由呼叫端給 */
export function klineChartOptions({
  timeScale,
  rightPriceScale,
  fontFamily,
}: Pick<DeepPartial<TimeChartOptions>, 'timeScale' | 'rightPriceScale'> & { fontFamily: string }): DeepPartial<TimeChartOptions> {
  return {
    autoSize: true,
    localization: { timeFormatter: (t: Time) => timeToYmd(t) },
    crosshair: { mode: 1 },
    timeScale,
    rightPriceScale,
    layout: { attributionLogo: false, background: { color: 'transparent' }, fontSize: 11, fontFamily },
    ...KLINE_INTERACTION_OPTIONS,
  };
}

/** 主題切換時套用的軸字、格線與軸線色；軸字色各圖自選 */
export function klineThemeOptions(palette: ChartPalette, textColor: string) {
  return {
    layout: { textColor },
    grid: { vertLines: { color: palette.gridSubtle }, horzLines: { color: palette.gridSubtle } },
    rightPriceScale: { borderColor: palette.grid },
    timeScale: { borderColor: palette.grid },
  } satisfies DeepPartial<TimeChartOptions>;
}

/** K 棒：最新收盤已寫在圖上方的讀數列，價格軸不再疊價格線與收盤價標籤（會壓到刻度） */
export const KLINE_CANDLE_SERIES_OPTIONS = { priceLineVisible: false, lastValueVisible: false } satisfies CandlestickSeriesPartialOptions;

/** K 棒顏色：漲 up、跌 down（實體、外框、影線同色） */
export function candlestickColors(palette: ChartPalette) {
  return {
    upColor: palette.up,
    downColor: palette.down,
    borderUpColor: palette.up,
    borderDownColor: palette.down,
    wickUpColor: palette.up,
    wickDownColor: palette.down,
  } satisfies CandlestickSeriesPartialOptions;
}

/** 成交量柱：疊在主圖下緣、用自己的價格軸（priceScaleId ''，上緣由呼叫端以 scaleMargins 決定） */
export const VOLUME_SERIES_OPTIONS = {
  priceFormat: { type: 'volume' },
  priceScaleId: '',
  lastValueVisible: false,
  priceLineVisible: false,
} satisfies HistogramSeriesPartialOptions;

/** 成交量柱的顏色：收盤對前一日收盤，漲 volumeUp、跌 volumeDown；平盤或沒有前一日用 volumeFlat */
export function volumeBarColor(
  close: number | null,
  prev: number | null,
  palette: Pick<ChartPalette, 'volumeUp' | 'volumeDown' | 'volumeFlat'>,
): string {
  return prev === null || close === null || close === prev ? palette.volumeFlat : close > prev ? palette.volumeUp : palette.volumeDown;
}

/** 成交量 → 成交量柱：依同日 K 棒的收盤對前一根 K 棒的收盤上色；第一根（沒有前一日）與找不到 K 棒的日子用平盤色 */
export function toVolumeHistogramData(
  candles: ChartCandle[],
  volume: PriceChartData['volume'],
  palette: Pick<ChartPalette, 'volumeUp' | 'volumeDown' | 'volumeFlat'>,
): HistogramData<Time>[] {
  const index = new Map(candles.map((c, i) => [c.time, i]));
  return volume.map((v) => {
    const i = index.get(v.time);
    const prev = i ? candles[i - 1].close : null;
    const close = i != null ? candles[i].close : null;
    return { time: toBusinessDay(v.time), value: v.value, color: volumeBarColor(close, prev, palette) };
  });
}

/** 十字線所在交易日的 K 棒 */
export interface CrosshairCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/**
 * 十字線讀數：游標移動後在下一幀讀出該日 K 棒（同一幀內多次移動只算最後一次）；
 * 游標離開圖表或該日沒有 K 棒時給 null。回傳取消待算幀的函式，圖表移除時呼叫。
 */
export function subscribeCandleCrosshair(
  chart: IChartApi,
  getCandleSeries: () => ISeriesApi<'Candlestick'> | null,
  onChange: (candle: CrosshairCandle | null) => void,
): () => void {
  let frame = 0;
  chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const series = getCandleSeries();
      const candle = series ? (param.seriesData.get(series) as CandlestickData<Time> | undefined) : undefined;
      if (!param.time || !param.point || !candle || !('open' in candle)) {
        onChange(null);
        return;
      }
      const { open, high, low, close } = candle;
      onChange({ date: timeToYmd(param.time), open, high, low, close });
    });
  });
  return () => cancelAnimationFrame(frame);
}
