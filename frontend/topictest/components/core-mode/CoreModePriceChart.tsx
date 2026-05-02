import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  createChart,
  type BusinessDay,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type SeriesMarkerBar,
  type Time,
} from 'lightweight-charts';
import type { CoreModePriceChart as CoreModePriceChartData } from '../../lib/types/coreMode';
import { formatVolumeShares } from '../../lib/utils/format';

interface Props {
  data: CoreModePriceChartData;
}

type AdvisorMarkerType = 'state_buy' | 'state_sell' | 'state_hold' | 'entry' | 'exit';

interface MarkerDetail {
  type: AdvisorMarkerType;
  label: string;
  detail: string;
}

interface TrendOverlayData {
  date: string;
  close: number;
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

const CHART_MARKERS = {
  buySignal: {
    color: '#F43F5E',
    shape: 'square',
    text: '買訊',
  },
  sellSignal: {
    color: '#10B981',
    shape: 'square',
    text: '賣訊',
  },
  hold: {
    color: '#F59E0B',
    shape: 'circle',
    text: '持平',
  },
  actualBuy: {
    color: '#DC2626',
    shape: 'arrowUp',
    text: '買進',
  },
  actualSell: {
    color: '#059669',
    shape: 'arrowDown',
    text: '賣出',
  },
} as const satisfies Record<string, { color: string; shape: SeriesMarker<Time>['shape']; text: string }>;

const MARKER_CONFIG_BY_TYPE: Record<AdvisorMarkerType, (typeof CHART_MARKERS)[keyof typeof CHART_MARKERS]> = {
  state_buy: CHART_MARKERS.buySignal,
  state_sell: CHART_MARKERS.sellSignal,
  state_hold: CHART_MARKERS.hold,
  entry: CHART_MARKERS.actualBuy,
  exit: CHART_MARKERS.actualSell,
};

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

export const CoreModePriceChart: React.FC<Props> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const closeSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const latestOverlayRef = useRef<TrendOverlayData | null>(null);
  const overlayKeyRef = useRef<string>('');

  const markerDetailsByDate = useMemo(() => {
    const map = new Map<string, MarkerDetail[]>();
    data.markers.forEach((marker) => {
      const markerType = toMarkerType(marker.type);
      if (!markerType) return;
      const detail: MarkerDetail = {
        type: markerType,
        label: MARKER_CONFIG_BY_TYPE[markerType].text,
        detail: marker.text?.trim() || MARKER_CONFIG_BY_TYPE[markerType].text,
      };
      const list = map.get(marker.time) ?? [];
      list.push(detail);
      map.set(marker.time, list);
    });
    return map;
  }, [data.markers]);

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
  const ma20ByDateRef = useRef<Map<string, number>>(new Map());
  const ma60ByDateRef = useRef<Map<string, number>>(new Map());
  const volumeByDateRef = useRef<Map<string, number>>(new Map());
  const priceChangeLabelByDateRef = useRef<Map<string, '上漲日' | '下跌日' | '平盤'>>(new Map());

  useEffect(() => {
    markerDetailsByDateRef.current = markerDetailsByDate;
    ma20ByDateRef.current = ma20ByDate;
    ma60ByDateRef.current = ma60ByDate;
    volumeByDateRef.current = volumeByDate;
    priceChangeLabelByDateRef.current = priceChangeLabelByDate;
  }, [markerDetailsByDate, ma20ByDate, ma60ByDate, volumeByDate, priceChangeLabelByDate]);

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
      ? `${next.date}|${next.close.toFixed(2)}|${next.ma20?.toFixed(2) ?? '--'}|${next.ma60?.toFixed(2) ?? '--'}|${next.relativeText}|${next.markerDetails
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
      layout: {
        background: { color: 'transparent' },
        textColor: '#334155',
        fontFamily: 'Noto Sans TC, PingFang TC, Microsoft JhengHei, sans-serif',
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.1)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.1)' },
      },
      crosshair: {
        mode: 1,
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.4)',
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.4)',
        timeVisible: true,
        tickMarkFormatter: (time: Time) => formatTimeLabel(time),
      },
    });

    const closeLine = chart.addSeries(LineSeries, {
      color: '#334155',
      lineWidth: 3,
      priceLineVisible: false,
    });

    const ma20 = chart.addSeries(LineSeries, {
      color: '#2563EB',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma60 = chart.addSeries(LineSeries, {
      color: '#7C3AED',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const volume = chart.addSeries(HistogramSeries, {
      color: '#94a3b8',
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
      if (!closeSeriesRef.current) return;

      if (!param.time || !param.point) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

      const date = formatTimeLabel(param.time);
      const close = extractLineValue(param.seriesData.get(closeSeriesRef.current));
      if (close === null) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

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
        close,
        ma20,
        ma60,
        relativeText: buildRelativeText(close, ma20, ma60),
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
    closeSeriesRef.current = closeLine;
    ma20SeriesRef.current = ma20;
    ma60SeriesRef.current = ma60;
    volumeSeriesRef.current = volume;
    markerPluginRef.current = createSeriesMarkers(closeSeriesRef.current);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      markerPluginRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      closeSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma60SeriesRef.current = null;
      volumeSeriesRef.current = null;
      markerPluginRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!closeSeriesRef.current || !volumeSeriesRef.current || !ma20SeriesRef.current || !ma60SeriesRef.current) {
      return;
    }

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
      const color =
        isFirst || close === null || prevClose === null
          ? 'rgba(148, 163, 184, 0.35)'
          : close > prevClose
            ? 'rgba(248, 113, 113, 0.55)'
            : close < prevClose
              ? 'rgba(52, 211, 153, 0.55)'
              : 'rgba(148, 163, 184, 0.35)';
      return {
      time: toTime(item.time),
      value: item.value,
      color,
      };
    });

    const ma20: LineData<Time>[] = data.overlays.MA20.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    const ma60: LineData<Time>[] = data.overlays.MA60.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    closeSeriesRef.current.setData(closeLine);
    volumeSeriesRef.current.setData(volume);
    ma20SeriesRef.current.setData(ma20);
    ma60SeriesRef.current.setData(ma60);

    const markers = data.markers.reduce<SeriesMarkerBar<Time>[]>((acc, marker) => {
      const markerType = toMarkerType(marker.type);
      if (!markerType) return acc;
      const markerConfig = MARKER_CONFIG_BY_TYPE[markerType];
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
        close: latestCandle.close,
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
  }, [data, ma20ByDate, ma60ByDate, markerDetailsByDate, volumeByDate, priceChangeLabelByDate, volumeInsight.ma20Volume]);

  return (
    <>
      <div className="mb-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/60 p-3 text-xs text-[var(--color-text-muted)]">
        <div className="mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">價格線</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: '#334155' }} />
            收盤線
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: '#2563EB' }} />
            MA20
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: '#7C3AED' }} />
            MA60
          </span>
        </div>
        <div className="mt-3 mb-2 text-[11px] font-semibold text-[var(--color-text-secondary)]">策略標記</div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: CHART_MARKERS.buySignal.color }} />
            {CHART_MARKERS.buySignal.text}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: CHART_MARKERS.sellSignal.color }} />
            {CHART_MARKERS.sellSignal.text}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_MARKERS.hold.color }} />
            {CHART_MARKERS.hold.text}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="font-black" style={{ color: CHART_MARKERS.actualBuy.color }}>▲</span>
            {CHART_MARKERS.actualBuy.text}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-white/60 px-2 py-1">
            <span className="font-black" style={{ color: CHART_MARKERS.actualSell.color }}>▼</span>
            {CHART_MARKERS.actualSell.text}
          </span>
        </div>
        <div className="mt-3 rounded-md border border-[var(--color-border)] bg-white/60 p-2 text-[11px] leading-5 text-[var(--color-text-secondary)]">
          下方紅綠柱代表每日成交量，柱子越高代表當天交易越熱絡。紅色代表上漲日成交量、綠色代表下跌日成交量。成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。
        </div>
      </div>
      <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white/70">
        <div className="pointer-events-none absolute left-2 top-2 z-10 max-w-[calc(100%-1rem)] rounded-md border border-slate-200/90 bg-white/90 px-3 py-2 text-xs text-slate-700 shadow-sm backdrop-blur">
          {overlayData ? (
            <div className="space-y-1">
              <p>
                日期：{overlayData.date}　收盤：{overlayData.close.toFixed(2)}　MA20：
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
            <span>日期：--　收盤：--　MA20：--　MA60：--</span>
          )}
        </div>
        <div ref={containerRef} className="h-full w-full" />
      </div>
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
    </>
  );
};
