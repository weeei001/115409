import { useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickSeries, HistogramSeries, LineSeries, createChart, type IChartApi, type ISeriesApi, type LineData, type Time } from 'lightweight-charts';
import type { MaKey, PriceChartData } from '@/lib/types/view';
import {
  KLINE_CANDLE_SERIES_OPTIONS,
  VOLUME_SERIES_OPTIONS,
  candlestickColors,
  klineChartOptions,
  klineThemeOptions,
  subscribeCandleCrosshair,
  timeToYmd,
  toBusinessDay,
  toCandlestickSeriesData,
  toVolumeHistogramData,
} from '@/lib/charts/priceChart';
import { getChartPalette, getMaColors } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import { fmtPrice, fmtVolume } from '@/lib/utils/format';

/** 觀測台只畫這三條均線（和請求的 ma_periods 一致） */
const MA: MaKey[] = ['MA5', 'MA20', 'MA60'];

interface Readout {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

/**
 * 觀測台的 K 線（lightweight-charts）：K 線、MA5／20／60、成交量。
 * 圖表只建立一次；主題與資料改變時用 applyOptions／setData 更新（charts-tei skill）。
 * 上方一列文字讀數同時是圖表的文字替代。
 */
export function TerminalKline({ data, title }: { data: PriceChartData; title: string }) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const palette = useMemo(() => getChartPalette(isDark), [isDark]);
  const maColors = useMemo(() => getMaColors(isDark), [isDark]);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maRefs = useRef<Partial<Record<MaKey, ISeriesApi<'Line'>>>>({});
  const [hover, setHover] = useState<Readout | null>(null);

  const volumeByDate = useMemo(() => new Map(data.volume.map((v) => [v.time, v.value])), [data]);
  const volumeRefMap = useRef(volumeByDate);
  volumeRefMap.current = volumeByDate;

  const latest = useMemo<Readout | null>(() => {
    const last = data.candles[data.candles.length - 1];
    return last ? { date: last.time, open: last.open, high: last.high, low: last.low, close: last.close, volume: volumeByDate.get(last.time) ?? null } : null;
  }, [data, volumeByDate]);
  const readout = hover ?? latest;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(
      el,
      klineChartOptions({
        timeScale: { tickMarkFormatter: (t: Time) => timeToYmd(t).slice(5), rightOffset: 3, fixLeftEdge: true },
        rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.24 } },
        fontFamily: 'IBM Plex Mono, Noto Sans TC, monospace',
      }),
    );
    candleRef.current = chart.addSeries(CandlestickSeries, KLINE_CANDLE_SERIES_OPTIONS);
    for (const key of MA) {
      maRefs.current[key] = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }
    volumeRef.current = chart.addSeries(HistogramSeries, VOLUME_SERIES_OPTIONS);
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const cancelCrosshair = subscribeCandleCrosshair(
      chart,
      () => candleRef.current,
      (candle) => setHover(candle ? { ...candle, volume: volumeRefMap.current.get(candle.date) ?? null } : null),
    );
    chartRef.current = chart;
    return () => {
      cancelCrosshair();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      maRefs.current = {};
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      ...klineThemeOptions(palette, palette.tickMuted),
      crosshair: { vertLine: { color: palette.brand, labelBackgroundColor: palette.tooltipBg }, horzLine: { color: palette.brand, labelBackgroundColor: palette.tooltipBg } },
    });
    candleRef.current?.applyOptions(candlestickColors(palette));
    for (const key of MA) maRefs.current[key]?.applyOptions({ color: maColors[key] });
  }, [palette, maColors]);

  useEffect(() => {
    candleRef.current?.setData(toCandlestickSeriesData(data.candles));
    for (const key of MA) {
      const points: LineData<Time>[] = (data.overlays[key] ?? [])
        .filter((p): p is { time: string; value: number } => p.value != null && Number.isFinite(p.value))
        .map((p) => ({ time: toBusinessDay(p.time), value: p.value }));
      maRefs.current[key]?.setData(points);
    }
    // 成交量柱依收盤對前一日收盤上色（同個股頁 PriceChart）；第一根沒有前一日，用平盤色
    volumeRef.current?.setData(toVolumeHistogramData(data.candles, data.volume, palette));
    chartRef.current?.timeScale().fitContent();
  }, [data, palette]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b px-3 py-2 font-mono text-xs tabular-nums text-subtle">
        {readout ? (
          <>
            <span className="text-muted-foreground">{readout.date}</span>
            <span>開 {fmtPrice(readout.open)}</span>
            <span>高 {fmtPrice(readout.high)}</span>
            <span>低 {fmtPrice(readout.low)}</span>
            <span>收 {fmtPrice(readout.close)}</span>
            <span>量 {fmtVolume(readout.volume)}</span>
          </>
        ) : (
          <span className="text-muted-foreground">--</span>
        )}
        <span className="ml-auto flex items-center gap-3 font-sans">
          {MA.map((key) => (
            <span key={key} className="inline-flex items-center gap-1.5">
              <span className="h-0.5 w-3" style={{ backgroundColor: maColors[key] }} aria-hidden />
              {key}
            </span>
          ))}
        </span>
      </div>
      <div ref={containerRef} role="img" aria-label={title} className="min-h-0 w-full flex-1" />
    </div>
  );
}
