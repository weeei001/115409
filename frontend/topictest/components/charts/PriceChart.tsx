import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  createChart,
  type BusinessDay,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarkerBar,
  type Time,
} from 'lightweight-charts';
import type { PriceChartData } from '../../lib/types/priceChart';
import { formatVolumeShares } from '../../lib/utils/format';
import { toCandlestickSeriesData } from '../../lib/utils/priceChartSeries';
import {
  DEFAULT_PRICE_CHART_SERIES_VISIBILITY,
  getNextPriceChartSeriesVisibility,
  type PriceChartSeriesKey,
} from '../../lib/utils/priceChartVisibility';
import { useTheme } from '../../lib/ThemeContext';
import {
  getChartMarkerStyles,
  getChartPalette,
  getLightweightChartLayoutOptions,
} from '../../lib/chartTheme';

interface Props {
  data: PriceChartData;
  /** 收合圖例與長篇說明，適用個股儀表板 */
  compact?: boolean;
}

type AdvisorMarkerType = 'state_buy' | 'state_sell' | 'state_hold' | 'entry' | 'exit';

interface MarkerDetail {
  type: AdvisorMarkerType;
  label: string;
  detail: string;
}

interface ChartMarkerSourceItem {
  time: string;
  position: 'aboveBar' | 'belowBar';
  type: AdvisorMarkerType;
}

interface TrendOverlayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma5: number | null;
  ma10: number | null;
  ma20: number | null;
  ma60: number | null;
  relativeText: string;
  markerDetails: MarkerDetail[];
  volume: number | null;
  priceChangeLabel: '上漲日' | '下跌日' | '平盤';
  volumeCompareText: string;
}

interface VolumeInsight {
  latestVolume: number | null;
  ma20Volume: number | null;
  ma60Volume: number | null;
  vsMa20Pct: number | null;
  volumeStateText: '量增' | '量縮' | '接近均量' | '無資料';
}

const ALLOWED_MARKER_TYPES: ReadonlySet<AdvisorMarkerType> = new Set([
  'state_buy',
  'state_sell',
  'state_hold',
  'entry',
  'exit',
]);

function toBusinessDay(dateText: string): BusinessDay {
  const [year, month, day] = dateText.split('-').map((v) => Number(v));
  return { year, month, day };
}

function toTime(dateText: string): Time {
  return toBusinessDay(dateText);
}

function toBusinessDayFromDate(date: Date): BusinessDay {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

function getInitialVisibleRange(): { from: BusinessDay; to: BusinessDay } {
  const today = new Date();
  const sixMonthsAgo = new Date(today);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  return {
    from: toBusinessDayFromDate(sixMonthsAgo),
    to: toBusinessDayFromDate(today),
  };
}

function formatTimeLabel(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  const day = time as BusinessDay;
  return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

function toMarkerType(value: string): AdvisorMarkerType | null {
  return ALLOWED_MARKER_TYPES.has(value as AdvisorMarkerType) ? (value as AdvisorMarkerType) : null;
}

function extractLineValue(dataPoint: unknown): number | null {
  if (!dataPoint || typeof dataPoint !== 'object') return null;
  const candidate = dataPoint as { value?: unknown };
  if (typeof candidate.value !== 'number' || !Number.isFinite(candidate.value)) return null;
  return candidate.value;
}

function extractOhlcValues(dataPoint: unknown): Pick<TrendOverlayData, 'open' | 'high' | 'low' | 'close'> | null {
  if (!dataPoint || typeof dataPoint !== 'object') return null;
  const candidate = dataPoint as Record<string, unknown>;
  const open = Number(candidate.open);
  const high = Number(candidate.high);
  const low = Number(candidate.low);
  const close = Number(candidate.close);
  if (![open, high, low, close].every(Number.isFinite)) return null;
  return { open, high, low, close };
}

function buildRelativeText(close: number, ma20: number | null, ma60: number | null): string {
  const toText = (target: number | null, name: string): string | null => {
    if (target === null) return null;
    if (Math.abs(close - target) < 1e-6) return `收盤等於 ${name}`;
    if (close > target) return `收盤站上 ${name}`;
    return `收盤跌破 ${name}`;
  };

  const r20 = toText(ma20, 'MA20');
  const r60 = toText(ma60, 'MA60');

  if (!r20 && !r60) return '收盤相對均線位置：--';
  if (r20 && r60) {
    const isAbove20 = close > ma20!;
    const isAbove60 = close > ma60!;
    if (isAbove20 && isAbove60) return '收盤站上 MA20、MA60';
    if (!isAbove20 && !isAbove60) return '收盤跌破 MA20、MA60';
    if (isAbove20 && !isAbove60) return '收盤站上 MA20，仍低於 MA60';
    if (!isAbove20 && isAbove60) return '收盤跌破 MA20，但仍高於 MA60';
    return `${r20}；${r60}`;
  }

  return r20 ?? r60 ?? '收盤相對均線位置：--';
}

function getTrendText(close: number | null, ma20: number | null, ma60: number | null): string {
  if (close === null || ma20 === null || ma60 === null) return '資料不足';
  if (close > ma20 && ma20 > ma60) return '持平偏多';
  if (close < ma20 && ma20 < ma60) return '持平偏空';
  return '區間整理';
}

function getMaStructureText(close: number | null, ma20: number | null, ma60: number | null): string {
  if (close === null || ma20 === null || ma60 === null) return '資料不足';
  if (close > ma20 && ma20 > ma60) return '股價 > MA20 > MA60';
  if (close < ma20 && ma20 < ma60) return '股價 < MA20 < MA60';
  if (close > ma20 && close > ma60) return '股價站上 MA20、MA60，但均線未完全多頭排列';
  if (close < ma20 && close < ma60) return '股價跌破 MA20、MA60，但均線未完全空頭排列';
  return '股價與均線交錯';
}

function calcAverage(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((acc, curr) => acc + curr, 0) / nums.length;
}

function getVolumeInterpretationText(volumeStateText: VolumeInsight['volumeStateText']): string {
  if (volumeStateText === '量增') {
    return '今日成交量高於 20 日均量，市場交易熱度增加。若價格同步站上均線，量增可作為趨勢延續的輔助確認。';
  }
  if (volumeStateText === '量縮') {
    return '今日成交量低於 20 日均量，市場追價意願偏保守。即使價格上漲，也要留意趨勢延續力道可能不足。';
  }
  if (volumeStateText === '接近均量') {
    return '今日成交量接近 20 日均量，市場交易熱度大致正常。量能沒有明顯放大或萎縮，需配合價格結構觀察。';
  }
  return '目前成交量資料不足，暫時無法判斷量能是否支持趨勢。';
}

function buildDisplayMarkers(rawMarkers: PriceChartData['markers'], options: { showSignalMarkers: boolean }): ChartMarkerSourceItem[] {
  const groupedByDate = new Map<string, ChartMarkerSourceItem[]>();

  rawMarkers.forEach((marker) => {
    const markerType = toMarkerType(marker.type);
    if (!markerType) return;
    const list = groupedByDate.get(marker.time) ?? [];
    list.push({
      time: marker.time,
      position: marker.position,
      type: markerType,
    });
    groupedByDate.set(marker.time, list);
  });

  const filtered: ChartMarkerSourceItem[] = [];
  groupedByDate.forEach((dateMarkers) => {
    const hasEntry = dateMarkers.some((marker) => marker.type === 'entry');
    const hasExit = dateMarkers.some((marker) => marker.type === 'exit');
    const hasActualTrade = hasEntry || hasExit;
    const dedupedByType = new Map<AdvisorMarkerType, ChartMarkerSourceItem>();
    dateMarkers.forEach((marker) => {
      if (!dedupedByType.has(marker.type)) {
        dedupedByType.set(marker.type, marker);
      }
    });

    if (hasActualTrade) {
      const entry = dedupedByType.get('entry');
      const exit = dedupedByType.get('exit');
      if (entry) filtered.push(entry);
      if (exit) filtered.push(exit);
      return;
    }

    if (!options.showSignalMarkers) return;

    const buySignal = dedupedByType.get('state_buy');
    const sellSignal = dedupedByType.get('state_sell');
    if (buySignal) filtered.push(buySignal);
    if (sellSignal) filtered.push(sellSignal);
    // state_hold is intentionally hidden on the main chart.
  });

  return filtered;
}

export const PriceChart: React.FC<Props> = ({ data, compact = false }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const palette = useMemo(() => getChartPalette(isDark), [isDark]);
  const layoutOptions = useMemo(
    () => getLightweightChartLayoutOptions(palette, isDark),
    [palette, isDark],
  );
  const markerStyles = useMemo(() => getChartMarkerStyles(palette), [palette]);
  // 提供給 buildDisplayMarkers / setMarkers / legend 使用，與 chartTheme 對齊
  const markerConfigByType: Record<AdvisorMarkerType, { color: string; shape: SeriesMarkerBar<Time>['shape']; text: string }> = useMemo(
    () => ({
      state_buy: markerStyles.state_buy,
      state_sell: markerStyles.state_sell,
      state_hold: markerStyles.state_hold,
      entry: markerStyles.entry,
      exit: markerStyles.exit,
    }),
    [markerStyles],
  );

  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const closeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const latestOverlayRef = useRef<TrendOverlayData | null>(null);
  const overlayKeyRef = useRef<string>('');
  const [showSignalMarkers, setShowSignalMarkers] = useState(false);
  const [seriesVisibility, setSeriesVisibility] = useState(DEFAULT_PRICE_CHART_SERIES_VISIBILITY);

  const displayMarkers = useMemo(
    () => buildDisplayMarkers(data.markers, { showSignalMarkers }),
    [data.markers, showSignalMarkers]
  );

  const markerDetailsByDate = useMemo(() => {
    const map = new Map<string, MarkerDetail[]>();
    data.markers.forEach((marker) => {
      const markerType = toMarkerType(marker.type);
      if (!markerType) return;
      const detail: MarkerDetail = {
        type: markerType,
        label: markerConfigByType[markerType].text,
        detail: marker.text?.trim() || markerConfigByType[markerType].text,
      };
      const list = map.get(marker.time) ?? [];
      list.push(detail);
      map.set(marker.time, list);
    });
    return map;
  }, [data.markers, markerConfigByType]);

  const ma5ByDate = useMemo(() => {
    const map = new Map<string, number>();
    data.overlays.MA5.forEach((point) => {
      if (point.value !== null) map.set(point.time, Number(point.value));
    });
    return map;
  }, [data.overlays.MA5]);

  const ma10ByDate = useMemo(() => {
    const map = new Map<string, number>();
    data.overlays.MA10.forEach((point) => {
      if (point.value !== null) map.set(point.time, Number(point.value));
    });
    return map;
  }, [data.overlays.MA10]);

  const ma20ByDate = useMemo(() => {
    const map = new Map<string, number>();
    data.overlays.MA20.forEach((point) => {
      if (point.value !== null) map.set(point.time, Number(point.value));
    });
    return map;
  }, [data.overlays.MA20]);

  const ma60ByDate = useMemo(() => {
    const map = new Map<string, number>();
    data.overlays.MA60.forEach((point) => {
      if (point.value !== null) map.set(point.time, Number(point.value));
    });
    return map;
  }, [data.overlays.MA60]);
  const volumeByDate = useMemo(() => {
    const map = new Map<string, number>();
    data.volume.forEach((point) => {
      if (Number.isFinite(point.value)) map.set(point.time, Number(point.value));
    });
    return map;
  }, [data.volume]);
  const priceChangeLabelByDate = useMemo(() => {
    const map = new Map<string, '上漲日' | '下跌日' | '平盤'>();
    data.candles.forEach((candle, idx) => {
      if (idx === 0) {
        map.set(candle.time, '平盤');
        return;
      }
      const prevClose = data.candles[idx - 1].close;
      if (candle.close > prevClose) map.set(candle.time, '上漲日');
      else if (candle.close < prevClose) map.set(candle.time, '下跌日');
      else map.set(candle.time, '平盤');
    });
    return map;
  }, [data.candles]);
  const markerDetailsByDateRef = useRef<Map<string, MarkerDetail[]>>(new Map());
  const ma5ByDateRef = useRef<Map<string, number>>(new Map());
  const ma10ByDateRef = useRef<Map<string, number>>(new Map());
  const ma20ByDateRef = useRef<Map<string, number>>(new Map());
  const ma60ByDateRef = useRef<Map<string, number>>(new Map());
  const volumeByDateRef = useRef<Map<string, number>>(new Map());
  const priceChangeLabelByDateRef = useRef<Map<string, '上漲日' | '下跌日' | '平盤'>>(new Map());

  useEffect(() => {
    markerDetailsByDateRef.current = markerDetailsByDate;
    ma5ByDateRef.current = ma5ByDate;
    ma10ByDateRef.current = ma10ByDate;
    ma20ByDateRef.current = ma20ByDate;
    ma60ByDateRef.current = ma60ByDate;
    volumeByDateRef.current = volumeByDate;
    priceChangeLabelByDateRef.current = priceChangeLabelByDate;
  }, [markerDetailsByDate, ma5ByDate, ma10ByDate, ma20ByDate, ma60ByDate, volumeByDate, priceChangeLabelByDate]);

  const rafRef = useRef<number | null>(null);
  const [overlayData, setOverlayData] = useState<TrendOverlayData | null>(null);
  const volumeInsight = useMemo<VolumeInsight>(() => {
    const latest = data.volume[data.volume.length - 1]?.value;
    const allVolumes = data.volume.map((item) => item.value).filter((v) => Number.isFinite(v));
    if (!allVolumes.length) {
      return {
        latestVolume: null,
        ma20Volume: null,
        ma60Volume: null,
        vsMa20Pct: null,
        volumeStateText: '無資料',
      };
    }
    const ma20Volume = calcAverage(allVolumes.slice(-20));
    const ma60Volume = calcAverage(allVolumes.slice(-60));
    const latestVolume = Number.isFinite(latest) ? latest : null;
    const vsMa20Pct =
      latestVolume !== null && ma20Volume !== null && ma20Volume > 0
        ? ((latestVolume - ma20Volume) / ma20Volume) * 100
        : null;

    let volumeStateText: VolumeInsight['volumeStateText'] = '無資料';
    if (latestVolume !== null && ma20Volume !== null) {
      if (Math.abs(vsMa20Pct ?? 0) <= 5) {
        volumeStateText = '接近均量';
      } else {
        volumeStateText = latestVolume > ma20Volume ? '量增' : '量縮';
      }
    }

    return {
      latestVolume,
      ma20Volume,
      ma60Volume,
      vsMa20Pct,
      volumeStateText,
    };
  }, [data.volume]);

  const updateOverlayData = (next: TrendOverlayData | null) => {
    const key = next
      ? `${next.date}|${next.open.toFixed(2)}|${next.high.toFixed(2)}|${next.low.toFixed(2)}|${next.close.toFixed(2)}|${next.ma5?.toFixed(2) ?? '--'}|${next.ma10?.toFixed(2) ?? '--'}|${next.ma20?.toFixed(2) ?? '--'}|${next.ma60?.toFixed(2) ?? '--'}|${next.relativeText}|${next.markerDetails
          .map((item) => `${item.type}:${item.detail}`)
          .join('|')}`
      : '';
    if (key === overlayKeyRef.current) return;
    overlayKeyRef.current = key;
    setOverlayData(next);
  };

  useEffect(() => {
    if (!containerRef.current || chartRef.current) return;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      localization: {
        timeFormatter: (time: Time) => formatTimeLabel(time),
      },
      layout: layoutOptions.layout,
      grid: layoutOptions.grid,
      crosshair: {
        mode: 1,
      },
      rightPriceScale: layoutOptions.rightPriceScale,
      timeScale: {
        ...layoutOptions.timeScale,
        timeVisible: true,
        tickMarkFormatter: (time: Time) => formatTimeLabel(time),
      },
    });

    const priceSeries = chart.addSeries(CandlestickSeries, {
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
      wickVisible: true,
      borderVisible: true,
      priceLineVisible: false,
    });

    const closeSeries = chart.addSeries(LineSeries, {
      color: layoutOptions.series.close,
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma5 = chart.addSeries(LineSeries, {
      color: layoutOptions.series.ma5,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma10 = chart.addSeries(LineSeries, {
      color: layoutOptions.series.ma10,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma20 = chart.addSeries(LineSeries, {
      color: layoutOptions.series.ma20,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma60 = chart.addSeries(LineSeries, {
      color: layoutOptions.series.ma60,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      color: layoutOptions.series.volumeFallback,
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });

    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.78,
        bottom: 0,
      },
    });

    const updateTooltip = (param: MouseEventParams<Time>) => {
      if (!priceSeriesRef.current) return;

      if (!param.time || !param.point) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

      const date = formatTimeLabel(param.time);
      const ohlc = extractOhlcValues(param.seriesData.get(priceSeriesRef.current));
      if (ohlc === null) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

      const ma5 =
        extractLineValue(ma5SeriesRef.current ? param.seriesData.get(ma5SeriesRef.current) : null) ??
        ma5ByDateRef.current.get(date) ??
        null;
      const ma10 =
        extractLineValue(ma10SeriesRef.current ? param.seriesData.get(ma10SeriesRef.current) : null) ??
        ma10ByDateRef.current.get(date) ??
        null;
      const ma20 =
        extractLineValue(ma20SeriesRef.current ? param.seriesData.get(ma20SeriesRef.current) : null) ??
        ma20ByDateRef.current.get(date) ??
        null;
      const ma60 =
        extractLineValue(ma60SeriesRef.current ? param.seriesData.get(ma60SeriesRef.current) : null) ??
        ma60ByDateRef.current.get(date) ??
        null;
      const volume = volumeByDateRef.current.get(date) ?? null;
      const ma20Volume = volumeInsight.ma20Volume;
      const volumeCompareText =
        volume !== null && ma20Volume !== null && ma20Volume > 0
          ? volume >= ma20Volume
            ? `量增（高於 20 日均量 ${(Math.abs(((volume - ma20Volume) / ma20Volume) * 100)).toFixed(1)}%）`
            : `量縮（低於 20 日均量 ${(Math.abs(((volume - ma20Volume) / ma20Volume) * 100)).toFixed(1)}%）`
          : '量能說明：無 20 日均量可比較';

      updateOverlayData({
        date,
        ...ohlc,
        ma5,
        ma10,
        ma20,
        ma60,
        relativeText: buildRelativeText(ohlc.close, ma20, ma60),
        markerDetails: markerDetailsByDateRef.current.get(date) ?? [],
        volume,
        priceChangeLabel: priceChangeLabelByDateRef.current.get(date) ?? '平盤',
        volumeCompareText,
      });
    };

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => updateTooltip(param));
    });

    chartRef.current = chart;
    priceSeriesRef.current = priceSeries;
    closeSeriesRef.current = closeSeries;
    ma5SeriesRef.current = ma5;
    ma10SeriesRef.current = ma10;
    ma20SeriesRef.current = ma20;
    ma60SeriesRef.current = ma60;
    volumeSeriesRef.current = volume;
    markerPluginRef.current = createSeriesMarkers(priceSeriesRef.current);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      markerPluginRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      closeSeriesRef.current = null;
      ma5SeriesRef.current = null;
      ma10SeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma60SeriesRef.current = null;
      volumeSeriesRef.current = null;
      markerPluginRef.current = null;
    };
    // 故意只 mount 一次：dark mode / palette 切換由下方獨立 effect 用 applyOptions 更新，
    // 避免主題切換時整支 chart 重建造成閃爍。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 主題切換時更新 chart 與 series 配色（不重建 chart）
  useEffect(() => {
    if (!chartRef.current) return;
    chartRef.current.applyOptions({
      layout: layoutOptions.layout,
      grid: layoutOptions.grid,
      rightPriceScale: layoutOptions.rightPriceScale,
      timeScale: layoutOptions.timeScale,
    });
    priceSeriesRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
    closeSeriesRef.current?.applyOptions({ color: layoutOptions.series.close });
    ma5SeriesRef.current?.applyOptions({ color: layoutOptions.series.ma5 });
    ma10SeriesRef.current?.applyOptions({ color: layoutOptions.series.ma10 });
    ma20SeriesRef.current?.applyOptions({ color: layoutOptions.series.ma20 });
    ma60SeriesRef.current?.applyOptions({ color: layoutOptions.series.ma60 });
    volumeSeriesRef.current?.applyOptions({ color: layoutOptions.series.volumeFallback });
  }, [layoutOptions]);

  useEffect(() => {
    priceSeriesRef.current?.applyOptions({ visible: seriesVisibility.candles });
    closeSeriesRef.current?.applyOptions({ visible: seriesVisibility.close });
    ma5SeriesRef.current?.applyOptions({ visible: seriesVisibility.MA5 });
    ma10SeriesRef.current?.applyOptions({ visible: seriesVisibility.MA10 });
    ma20SeriesRef.current?.applyOptions({ visible: seriesVisibility.MA20 });
    ma60SeriesRef.current?.applyOptions({ visible: seriesVisibility.MA60 });
  }, [seriesVisibility]);

  useEffect(() => {
    if (
      !priceSeriesRef.current ||
      !closeSeriesRef.current ||
      !volumeSeriesRef.current ||
      !ma5SeriesRef.current ||
      !ma10SeriesRef.current ||
      !ma20SeriesRef.current ||
      !ma60SeriesRef.current
    ) {
      return;
    }

    const candlesticks = toCandlestickSeriesData(data.candles);
    const closeLine: LineData<Time>[] = data.candles.map((item) => ({
      time: toTime(item.time),
      value: item.close,
    }));

    const candleByTime = new Map(data.candles.map((candle, idx) => [candle.time, { candle, idx }]));
    const volume: HistogramData<Time>[] = data.volume.map((item) => {
      const candleMeta = candleByTime.get(item.time);
      const isFirst = !candleMeta || candleMeta.idx === 0;
      const prevClose = !isFirst ? data.candles[candleMeta!.idx - 1].close : null;
      const close = candleMeta?.candle.close ?? null;
      // 紅漲綠跌：用 chartTheme 的 priceBarUp/priceBarDown，與全站漲跌色一致
      let color: string;
      if (isFirst || close === null || prevClose === null || close === prevClose) {
        color = palette.tickMuted;
      } else if (close > prevClose) {
        color = palette.priceBarUp;
      } else {
        color = palette.priceBarDown;
      }
      return {
        time: toTime(item.time),
        value: item.value,
        color,
      };
    });

    const ma5: LineData<Time>[] = data.overlays.MA5.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    const ma10: LineData<Time>[] = data.overlays.MA10.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    const ma20: LineData<Time>[] = data.overlays.MA20.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    const ma60: LineData<Time>[] = data.overlays.MA60.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    priceSeriesRef.current.setData(candlesticks);
    closeSeriesRef.current.setData(closeLine);
    volumeSeriesRef.current.setData(volume);
    ma5SeriesRef.current.setData(ma5);
    ma10SeriesRef.current.setData(ma10);
    ma20SeriesRef.current.setData(ma20);
    ma60SeriesRef.current.setData(ma60);

    const markers = displayMarkers.reduce<SeriesMarkerBar<Time>[]>((acc, marker) => {
      const markerConfig = markerConfigByType[marker.type];
      acc.push({
        time: toTime(marker.time),
        position: marker.position as SeriesMarkerBar<Time>['position'],
        shape: markerConfig.shape,
        color: markerConfig.color,
        text: markerConfig.text,
      });
      return acc;
    }, []);
    markerPluginRef.current?.setMarkers(markers);

    const latestCandle = data.candles[data.candles.length - 1];
    const latest = latestCandle
      ? {
        date: latestCandle.time,
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
        ma5: ma5ByDate.get(latestCandle.time) ?? null,
        ma10: ma10ByDate.get(latestCandle.time) ?? null,
        ma20: ma20ByDate.get(latestCandle.time) ?? null,
        ma60: ma60ByDate.get(latestCandle.time) ?? null,
        relativeText: buildRelativeText(
          latestCandle.close,
          ma20ByDate.get(latestCandle.time) ?? null,
          ma60ByDate.get(latestCandle.time) ?? null
        ),
        markerDetails: markerDetailsByDate.get(latestCandle.time) ?? [],
        volume: volumeByDate.get(latestCandle.time) ?? null,
        priceChangeLabel: priceChangeLabelByDate.get(latestCandle.time) ?? '平盤',
        volumeCompareText:
          volumeByDate.get(latestCandle.time) !== null && volumeInsight.ma20Volume !== null && volumeInsight.ma20Volume > 0
            ? (volumeByDate.get(latestCandle.time) ?? 0) >= volumeInsight.ma20Volume
              ? `量增（高於 20 日均量 ${Math.abs((((volumeByDate.get(latestCandle.time) ?? 0) - volumeInsight.ma20Volume) / volumeInsight.ma20Volume) * 100).toFixed(1)}%）`
              : `量縮（低於 20 日均量 ${Math.abs((((volumeByDate.get(latestCandle.time) ?? 0) - volumeInsight.ma20Volume) / volumeInsight.ma20Volume) * 100).toFixed(1)}%）`
            : '量能說明：無 20 日均量可比較',
      }
      : null;
    latestOverlayRef.current = latest;
    updateOverlayData(latest);

    const visibleRange = getInitialVisibleRange();
    chartRef.current?.timeScale().setVisibleRange(visibleRange);
  }, [data, displayMarkers, ma5ByDate, ma10ByDate, ma20ByDate, ma60ByDate, markerDetailsByDate, volumeByDate, priceChangeLabelByDate, volumeInsight.ma20Volume, palette, markerConfigByType]);

  const legendBoxCls =
    'inline-flex items-center gap-1.5 rounded-md bg-[var(--color-bg-card)]/70 px-2 py-1';
  const legendButtonCls =
    'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50';
  const legendButtonStateCls = (key: PriceChartSeriesKey) =>
    seriesVisibility[key]
      ? 'border-transparent bg-[var(--color-bg-card)]/70 text-[var(--color-text-secondary)]'
      : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 text-[var(--color-text-muted)] opacity-55';
  const toggleSeriesVisibility = (key: PriceChartSeriesKey) => {
    setSeriesVisibility((current) => getNextPriceChartSeriesVisibility(current, key));
  };
  const toggleBaseCls = 'rounded-md border px-2 py-1 transition-colors';
  const toggleActiveCls = 'border-brand bg-brand/10 text-brand-deep dark:text-brand';
  const toggleInactiveCls =
    'border-[var(--color-border)] bg-[var(--color-bg-card)]/70 text-[var(--color-text-secondary)]';
  return (
    <>
      {!compact && (
      <div className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-xs text-[var(--color-text-muted)]">
        <div className="mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">價格圖</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            aria-pressed={seriesVisibility.candles}
            onClick={() => toggleSeriesVisibility('candles')}
            className={`${legendButtonCls} ${legendButtonStateCls('candles')}`}
          >
            <span className="h-2.5 w-3 rounded-[2px] border" style={{ backgroundColor: palette.up, borderColor: palette.up }} />
            K 線
          </button>
          <button
            type="button"
            aria-pressed={seriesVisibility.close}
            onClick={() => toggleSeriesVisibility('close')}
            className={`${legendButtonCls} ${legendButtonStateCls('close')}`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: layoutOptions.series.close }} />
            收盤價
          </button>
          <button
            type="button"
            aria-pressed={seriesVisibility.MA5}
            onClick={() => toggleSeriesVisibility('MA5')}
            className={`${legendButtonCls} ${legendButtonStateCls('MA5')}`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: layoutOptions.series.ma5 }} />
            MA5
          </button>
          <button
            type="button"
            aria-pressed={seriesVisibility.MA10}
            onClick={() => toggleSeriesVisibility('MA10')}
            className={`${legendButtonCls} ${legendButtonStateCls('MA10')}`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: layoutOptions.series.ma10 }} />
            MA10
          </button>
          <button
            type="button"
            aria-pressed={seriesVisibility.MA20}
            onClick={() => toggleSeriesVisibility('MA20')}
            className={`${legendButtonCls} ${legendButtonStateCls('MA20')}`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: layoutOptions.series.ma20 }} />
            MA20
          </button>
          <button
            type="button"
            aria-pressed={seriesVisibility.MA60}
            onClick={() => toggleSeriesVisibility('MA60')}
            className={`${legendButtonCls} ${legendButtonStateCls('MA60')}`}
          >
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: layoutOptions.series.ma60 }} />
            MA60
          </button>
        </div>
        {data.markers.length > 0 && (
          <>
            <div className="mt-3 mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">策略標記</div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[var(--color-text-muted)]">主圖顯示：</span>
              <button
                type="button"
                onClick={() => setShowSignalMarkers(false)}
                aria-pressed={!showSignalMarkers}
                className={`${toggleBaseCls} ${showSignalMarkers ? toggleInactiveCls : toggleActiveCls}`}
              >
                只顯示實際交易
              </button>
              <button
                type="button"
                onClick={() => setShowSignalMarkers(true)}
                aria-pressed={showSignalMarkers}
                className={`${toggleBaseCls} ${showSignalMarkers ? toggleActiveCls : toggleInactiveCls}`}
              >
                顯示交易與訊號
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className={legendBoxCls}>
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: markerStyles.state_buy.color }} />
                {markerStyles.state_buy.text}（訊號）
              </span>
              <span className={legendBoxCls}>
                <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: markerStyles.state_sell.color }} />
                {markerStyles.state_sell.text}（訊號）
              </span>
              <span className={legendBoxCls}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: markerStyles.state_hold.color }} />
                {markerStyles.state_hold.text}（僅 tooltip）
              </span>
              <span className={legendBoxCls}>
                <span className="font-black" style={{ color: markerStyles.entry.color }}>▲</span>
                {markerStyles.entry.text}
              </span>
              <span className={legendBoxCls}>
                <span className="font-black" style={{ color: markerStyles.exit.color }}>▼</span>
                {markerStyles.exit.text}
              </span>
            </div>
            <div className="mt-2 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)]/70 p-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
              買進 / 賣出代表回測中的實際交易動作；買訊 / 賣訊代表策略訊號，不一定代表成交；持平為中性狀態，預設顯示於 tooltip 或狀態摘要，不顯示在主圖上。
            </div>
          </>
        )}
        <div className="mt-3 rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)]/70 p-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
          下方紅綠柱代表每日成交量，柱子越高代表當天交易越熱絡。紅色代表上漲日成交量、綠色代表下跌日成交量。成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。
        </div>
      </div>
      )}
      <div className="relative h-[360px] sm:h-[460px] w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)]/70">
        <span className="pointer-events-none absolute left-1 top-[25%] z-10 -translate-y-1/2 rounded bg-[var(--color-bg-card)]/80 px-1 py-1 text-[10px] font-medium text-[var(--color-text-muted)] [writing-mode:vertical-rl]">
          價格（元）
        </span>
        <span className="pointer-events-none absolute left-1 bottom-[15%] z-10 rounded bg-[var(--color-bg-card)]/80 px-1 py-1 text-[10px] font-medium text-[var(--color-text-muted)] [writing-mode:vertical-rl]">
          成交量（股）
        </span>
        <span className="pointer-events-none absolute bottom-1 left-1/2 z-10 -translate-x-1/2 rounded bg-[var(--color-bg-card)]/80 px-2 py-0.5 text-[10px] font-medium text-[var(--color-text-muted)]">
          日期
        </span>
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded-md border border-[var(--color-border)] bg-[var(--color-bg-card)]/90 px-3 py-2 text-xs text-[var(--color-text-secondary)] shadow-sm backdrop-blur">
          {overlayData ? (
            <div className="space-y-1">
              <p>
                日期：{overlayData.date}　開：{overlayData.open.toFixed(2)}　高：{overlayData.high.toFixed(2)}　低：
                {overlayData.low.toFixed(2)}　收：{overlayData.close.toFixed(2)}　MA5：
                {overlayData.ma5 === null ? '--' : overlayData.ma5.toFixed(2)}　MA10：
                {overlayData.ma10 === null ? '--' : overlayData.ma10.toFixed(2)}　MA20：
                {overlayData.ma20 === null ? '--' : overlayData.ma20.toFixed(2)}　MA60：
                {overlayData.ma60 === null ? '--' : overlayData.ma60.toFixed(2)}
              </p>
              <p>
                成交量：{formatVolumeShares(overlayData.volume)}　價格變化：{overlayData.priceChangeLabel}
              </p>
              <p>{overlayData.relativeText}</p>
              <p>{overlayData.volumeCompareText}</p>
              {overlayData.markerDetails.length ? (
                <p>
                  訊號：
                  {overlayData.markerDetails
                    .map((item) => `${item.label}（${item.detail}）`)
                    .join('；')}
                </p>
              ) : null}
            </div>
          ) : (
            <span>日期：--　收盤：--　MA5：--　MA10：--　MA20：--　MA60：--</span>
          )}
        </div>
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {!compact && (
      <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-4">
          <p className="text-xs font-semibold text-[var(--color-text-muted)]">目前圖表解讀</p>
          <p className="mt-2 text-sm font-semibold text-[var(--color-text-primary)]">
            目前趨勢：{getTrendText(overlayData?.close ?? null, overlayData?.ma20 ?? null, overlayData?.ma60 ?? null)}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            均線結構：{getMaStructureText(overlayData?.close ?? null, overlayData?.ma20 ?? null, overlayData?.ma60 ?? null)}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            目前位置：{overlayData?.relativeText ?? '資料不足'}
          </p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            提醒：若跌破 MA20，短線可能進入整理；若跌破 MA60，中期趨勢可能轉弱。
          </p>
        </div>
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-4">
          <p className="text-xs font-semibold text-[var(--color-text-muted)]">輔助資訊｜成交量</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">今日成交量：{formatVolumeShares(volumeInsight.latestVolume)}</p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            20 日均量：{formatVolumeShares(volumeInsight.ma20Volume)}
            {volumeInsight.vsMa20Pct === null
              ? ''
              : `（${volumeInsight.vsMa20Pct >= 0 ? '高於' : '低於'} ${Math.abs(volumeInsight.vsMa20Pct).toFixed(1)}%）`}
          </p>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">60 日均量：{formatVolumeShares(volumeInsight.ma60Volume)}</p>
          <p className="mt-1 text-sm font-medium text-[var(--color-text-primary)]">量能狀態：{volumeInsight.volumeStateText}</p>
          <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
            量能解讀：{getVolumeInterpretationText(volumeInsight.volumeStateText)}成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。
          </p>
        </div>
      </div>
      )}
    </>
  );
};
