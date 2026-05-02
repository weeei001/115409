import React, { useEffect, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  createChart,
  type BusinessDay,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type LineData,
  type MouseEventParams,
  type SeriesMarker,
  type Time,
} from 'lightweight-charts';
import type { CoreModePriceChart as CoreModePriceChartData } from '../../lib/types/coreMode';

interface Props {
  data: CoreModePriceChartData;
}

interface OhlcOverlayData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

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

export const CoreModePriceChart: React.FC<Props> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markerPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const latestOverlayRef = useRef<OhlcOverlayData | null>(null);
  const overlayKeyRef = useRef<string>('');

  const rafRef = useRef<number | null>(null);
  const [overlayData, setOverlayData] = useState<OhlcOverlayData | null>(null);

  const updateOverlayData = (next: OhlcOverlayData | null) => {
    const key = next
      ? `${next.date}|${next.open.toFixed(2)}|${next.high.toFixed(2)}|${next.low.toFixed(2)}|${next.close.toFixed(2)}`
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
        vertLines: { color: 'rgba(148, 163, 184, 0.18)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.18)' },
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

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#ef4444',
      downColor: '#22c55e',
      borderVisible: false,
      wickUpColor: '#ef4444',
      wickDownColor: '#22c55e',
      priceLineVisible: false,
    });

    const ma20 = chart.addSeries(LineSeries, {
      color: '#2563eb',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const ma60 = chart.addSeries(LineSeries, {
      color: '#7c3aed',
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
      if (!candleSeriesRef.current) return;

      if (!param.time || !param.point) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

      const dataPoint = param.seriesData.get(candleSeriesRef.current) as
        | (CandlestickData<Time> & { open: number; high: number; low: number; close: number })
        | undefined;
      if (!dataPoint) {
        updateOverlayData(latestOverlayRef.current);
        return;
      }

      updateOverlayData({
        date: formatTimeLabel(param.time),
        open: dataPoint.open,
        high: dataPoint.high,
        low: dataPoint.low,
        close: dataPoint.close,
      });
    };

    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = requestAnimationFrame(() => updateTooltip(param));
    });

    chartRef.current = chart;
    candleSeriesRef.current = candle;
    ma20SeriesRef.current = ma20;
    ma60SeriesRef.current = ma60;
    volumeSeriesRef.current = volume;
    markerPluginRef.current = createSeriesMarkers(candleSeriesRef.current);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      markerPluginRef.current?.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma60SeriesRef.current = null;
      volumeSeriesRef.current = null;
      markerPluginRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || !ma20SeriesRef.current || !ma60SeriesRef.current) {
      return;
    }

    const candles: CandlestickData<Time>[] = data.candles.map((item) => ({
      time: toTime(item.time),
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close,
    }));

    const volume: HistogramData<Time>[] = data.volume.map((item) => ({
      time: toTime(item.time),
      value: item.value,
      color: item.color,
    }));

    const ma20: LineData<Time>[] = data.overlays.MA20.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    const ma60: LineData<Time>[] = data.overlays.MA60.filter((item) => item.value !== null).map((item) => ({
      time: toTime(item.time),
      value: Number(item.value),
    }));

    candleSeriesRef.current.setData(candles);
    volumeSeriesRef.current.setData(volume);
    ma20SeriesRef.current.setData(ma20);
    ma60SeriesRef.current.setData(ma60);

    const markers: SeriesMarker<Time>[] = data.markers.map((marker) => ({
      time: toTime(marker.time),
      position: marker.position,
      shape: marker.shape as SeriesMarker<Time>['shape'],
      color: marker.color,
      text: marker.text,
    }));
    markerPluginRef.current?.setMarkers(markers);

    const latestCandle = data.candles[data.candles.length - 1];
    const latest = latestCandle
      ? {
        date: latestCandle.time,
        open: latestCandle.open,
        high: latestCandle.high,
        low: latestCandle.low,
        close: latestCandle.close,
      }
      : null;
    latestOverlayRef.current = latest;
    updateOverlayData(latest);

    const visibleRange = getInitialVisibleRange();
    chartRef.current?.timeScale().setVisibleRange(visibleRange);
  }, [data]);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--color-text-muted)]">
        < div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#2563eb' }} />
            藍線：20 日均線
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: '#7c3aed' }} />
            紫線：60 日均線
          </span>
        </div>
      </div>
      <div className="relative h-[460px] w-full overflow-hidden rounded-xl border border-[var(--color-border)] bg-white/70">
        <div className="pointer-events-none absolute left-2 top-2 z-10 rounded-md border border-slate-200/90 bg-white/90 px-2 py-1 text-[11px] text-slate-700 shadow-sm backdrop-blur">
          {overlayData ? (
            <span>
              日期：{overlayData.date}　開：{overlayData.open.toFixed(2)}　高：{overlayData.high.toFixed(2)}　低：
              {overlayData.low.toFixed(2)}　收：{overlayData.close.toFixed(2)}
            </span>
          ) : (
            <span>日期：--　開：--　高：--　低：--　收：--</span>
          )}
        </div>
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </>
  );
};
