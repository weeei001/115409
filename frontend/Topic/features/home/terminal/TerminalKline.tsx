import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { MaKey, PriceChartData } from '@/lib/types/view';
import { timeToYmd, toBusinessDay, toCandlestickSeriesData } from '@/lib/charts/priceChart';
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
    const chart = createChart(el, {
      autoSize: true,
      localization: { timeFormatter: (t: Time) => timeToYmd(t) },
      crosshair: { mode: 1 },
      timeScale: { tickMarkFormatter: (t: Time) => timeToYmd(t).slice(5), rightOffset: 3, fixLeftEdge: true },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.24 } },
      layout: { attributionLogo: false, background: { color: 'transparent' }, fontFamily: 'IBM Plex Mono, Noto Sans TC, monospace', fontSize: 11 },
      handleScroll: { vertTouchDrag: false },
    });
    // 最後一筆的價格標籤會蓋住軸上的刻度；收盤已經寫在上方讀數列
    candleRef.current = chart.addSeries(CandlestickSeries, { priceLineVisible: false, lastValueVisible: false });
    for (const key of MA) {
      maRefs.current[key] = chart.addSeries(LineSeries, { lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    }
    volumeRef.current = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '', lastValueVisible: false, priceLineVisible: false });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    let frame = 0;
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const candle = candleRef.current ? (param.seriesData.get(candleRef.current) as CandlestickData<Time> | undefined) : undefined;
        if (!param.time || !param.point || !candle || !('open' in candle)) return setHover(null);
        const date = timeToYmd(param.time);
        setHover({ date, open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: volumeRefMap.current.get(date) ?? null });
      });
    });
    chartRef.current = chart;
    return () => {
      cancelAnimationFrame(frame);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      maRefs.current = {};
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: palette.tickMuted },
      grid: { vertLines: { color: palette.gridSubtle }, horzLines: { color: palette.gridSubtle } },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
      crosshair: { vertLine: { color: palette.brand, labelBackgroundColor: palette.tooltipBg }, horzLine: { color: palette.brand, labelBackgroundColor: palette.tooltipBg } },
    });
    candleRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
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
    const closeByDate = new Map(data.candles.map((c) => [c.time, c]));
    const bars: HistogramData<Time>[] = data.volume.map((v) => {
      const c = closeByDate.get(v.time);
      const color = !c || c.close === c.open ? palette.volumeFlat : c.close > c.open ? palette.volumeUp : palette.volumeDown;
      return { time: toBusinessDay(v.time), value: v.value, color };
    });
    volumeRef.current?.setData(bars);
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
