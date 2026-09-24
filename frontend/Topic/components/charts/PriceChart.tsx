import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  createChart,
  type BusinessDay,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { MaKey, PriceChartData } from '@/lib/types/view';
import { MA_KEYS } from '@/lib/types/view';
import { fmtVolume } from '@/lib/utils/format';
import {
  DEFAULT_PRICE_CHART_SERIES_VISIBILITY,
  getNextPriceChartSeriesVisibility,
  toBusinessDay,
  toCandlestickSeriesData,
  type PriceChartSeriesKey,
} from '@/lib/charts/priceChart';
import { getChartPalette, getMaColors } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import { cn } from '@/lib/cn';

interface Props {
  data: PriceChartData;
  /** 目前有向後端要資料的均線（MA 週期選擇器），圖例只列這些 */
  activeMa: MaKey[];
}

type ChangeLabel = '上漲日' | '下跌日' | '平盤';

interface Overlay {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma: Record<MaKey, number | null>;
  volume: number | null;
  changeLabel: ChangeLabel;
}

function formatTimeLabel(time: Time): string {
  if (typeof time === 'string') return time;
  if (typeof time === 'number') return new Date(time * 1000).toISOString().slice(0, 10);
  const d = time as BusinessDay;
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`;
}

function relativeText(close: number, ma20: number | null, ma60: number | null): string {
  if (ma20 === null && ma60 === null) return '收盤相對均線位置：--';
  if (ma20 !== null && ma60 !== null) {
    const a20 = close > ma20;
    const a60 = close > ma60;
    if (a20 && a60) return '收盤站上 MA20、MA60';
    if (!a20 && !a60) return '收盤跌破 MA20、MA60';
    return a20 ? '收盤站上 MA20，仍低於 MA60' : '收盤跌破 MA20，但仍高於 MA60';
  }
  const [target, name] = ma20 !== null ? [ma20, 'MA20'] : [ma60 as number, 'MA60'];
  if (Math.abs(close - target) < 1e-6) return `收盤等於 ${name}`;
  return close > target ? `收盤站上 ${name}` : `收盤跌破 ${name}`;
}

/** 決議 c41：多頭／空頭排列的用詞 */
function trendText(close: number | null, ma20: number | null, ma60: number | null): string {
  if (close === null || ma20 === null || ma60 === null) return '資料不足';
  if (close > ma20 && ma20 > ma60) return '偏多（多頭排列）';
  if (close < ma20 && ma20 < ma60) return '偏空（空頭排列）';
  return '區間整理';
}

function maStructureText(close: number | null, ma20: number | null, ma60: number | null): string {
  if (close === null || ma20 === null || ma60 === null) return '資料不足';
  if (close > ma20 && ma20 > ma60) return '股價 > MA20 > MA60';
  if (close < ma20 && ma20 < ma60) return '股價 < MA20 < MA60';
  if (close > ma20 && close > ma60) return '股價站上 MA20、MA60，但均線未完全多頭排列';
  if (close < ma20 && close < ma60) return '股價跌破 MA20、MA60，但均線未完全空頭排列';
  return '股價與均線交錯';
}

const average = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null);

function volumeCompare(volume: number | null, ma20: number | null): string {
  if (volume === null || ma20 === null || ma20 <= 0) return '量能說明：無 20 日均量可比較';
  const pct = Math.abs(((volume - ma20) / ma20) * 100).toFixed(1);
  return volume >= ma20 ? `量增（高於 20 日均量 ${pct}%）` : `量縮（低於 20 日均量 ${pct}%）`;
}

function volumeInterpretation(state: string): string {
  if (state === '量增') return '今日成交量高於 20 日均量，市場交易熱度增加。若價格同步站上均線，量增可作為趨勢延續的輔助確認。';
  if (state === '量縮') return '今日成交量低於 20 日均量，市場追價意願偏保守。即使價格上漲，也要留意趨勢延續力道可能不足。';
  if (state === '接近均量') return '今日成交量接近 20 日均量，市場交易熱度大致正常。量能沒有明顯放大或萎縮，需配合價格結構觀察。';
  return '目前成交量資料不足，暫時無法判斷量能是否支持趨勢。';
}

const fmt2 = (v: number | null) => (v === null ? '--' : v.toFixed(2));

export function PriceChart({ data, activeMa }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const palette = useMemo(() => getChartPalette(isDark), [isDark]);
  const maColors = useMemo(() => getMaColors(isDark), [isDark]);
  const closeColor = palette.text;

  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const closeRef = useRef<ISeriesApi<'Line'> | null>(null);
  const maRefs = useRef<Partial<Record<MaKey, ISeriesApi<'Line'>>>>({});
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [visibility, setVisibility] = useState(DEFAULT_PRICE_CHART_SERIES_VISIBILITY);

  const lookups = useMemo(() => {
    const ma = Object.fromEntries(
      MA_KEYS.map((key) => [key, new Map(data.overlays[key].filter((p) => p.value !== null).map((p) => [p.time, p.value as number]))]),
    ) as Record<MaKey, Map<string, number>>;
    const volume = new Map(data.volume.filter((p) => Number.isFinite(p.value)).map((p) => [p.time, p.value]));
    const change = new Map<string, ChangeLabel>();
    data.candles.forEach((c, i) => {
      const prev = i > 0 ? data.candles[i - 1].close : null;
      change.set(c.time, prev === null || c.close === prev ? '平盤' : c.close > prev ? '上漲日' : '下跌日');
    });
    return { ma, volume, change };
  }, [data]);
  const lookupsRef = useRef(lookups);
  lookupsRef.current = lookups;

  const volumeInsight = useMemo(() => {
    const values = data.volume.map((p) => p.value).filter((v) => Number.isFinite(v));
    const latest = data.volume[data.volume.length - 1]?.value;
    const latestVolume = Number.isFinite(latest) ? latest : null;
    const ma20 = average(values.slice(-20));
    const ma60 = average(values.slice(-60));
    const vsMa20 = latestVolume !== null && ma20 ? ((latestVolume - ma20) / ma20) * 100 : null;
    let state = '無資料';
    if (vsMa20 !== null) state = Math.abs(vsMa20) <= 5 ? '接近均量' : vsMa20 > 0 ? '量增' : '量縮';
    return { latestVolume, ma20, ma60, vsMa20, state };
  }, [data.volume]);

  const buildOverlay = (time: string, ohlc: { open: number; high: number; low: number; close: number }): Overlay => {
    const l = lookupsRef.current;
    return {
      date: time,
      ...ohlc,
      ma: Object.fromEntries(MA_KEYS.map((key) => [key, l.ma[key].get(time) ?? null])) as Record<MaKey, number | null>,
      volume: l.volume.get(time) ?? null,
      changeLabel: l.change.get(time) ?? '平盤',
    };
  };

  const latestOverlay = useMemo<Overlay | null>(() => {
    const last = data.candles[data.candles.length - 1];
    return last ? buildOverlay(last.time, last) : null;
  }, [data, lookups]);
  const [hover, setHover] = useState<Overlay | null>(null);
  const overlay = hover ?? latestOverlay;

  // 只建立一次圖表；主題與資料由下面的 effect 用 applyOptions / setData 更新，避免閃爍
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      localization: { timeFormatter: (t: Time) => formatTimeLabel(t) },
      crosshair: { mode: 1 },
      timeScale: { timeVisible: true, tickMarkFormatter: (t: Time) => formatTimeLabel(t) },
      layout: { attributionLogo: false, background: { color: 'transparent' }, fontFamily: 'Noto Sans TC, PingFang TC, sans-serif' },
    });
    candleRef.current = chart.addSeries(CandlestickSeries, { wickVisible: true, borderVisible: true, priceLineVisible: false });
    closeRef.current = chart.addSeries(LineSeries, { lineWidth: 2, lineStyle: LineStyle.Solid, priceLineVisible: false, lastValueVisible: false });
    for (const key of MA_KEYS) {
      maRefs.current[key] = chart.addSeries(LineSeries, { lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    }
    volumeRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('').applyOptions({ scaleMargins: { top: 0.78, bottom: 0 } });

    let frame = 0;
    chart.subscribeCrosshairMove((param: MouseEventParams<Time>) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const candle = candleRef.current
          ? (param.seriesData.get(candleRef.current) as CandlestickData<Time> | undefined)
          : undefined;
        if (!param.time || !param.point || !candle || !('open' in candle)) {
          setHover(null);
          return;
        }
        const { open, high, low, close } = candle;
        setHover(buildOverlay(formatTimeLabel(param.time), { open, high, low, close }));
      });
    });
    chartRef.current = chart;
    return () => {
      cancelAnimationFrame(frame);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      closeRef.current = null;
      volumeRef.current = null;
      maRefs.current = {};
    };
  }, []);

  useEffect(() => {
    chartRef.current?.applyOptions({
      layout: { textColor: palette.tick },
      grid: { vertLines: { color: palette.gridSubtle }, horzLines: { color: palette.gridSubtle } },
      rightPriceScale: { borderColor: palette.grid },
      timeScale: { borderColor: palette.grid },
    });
    candleRef.current?.applyOptions({
      upColor: palette.up,
      downColor: palette.down,
      borderUpColor: palette.up,
      borderDownColor: palette.down,
      wickUpColor: palette.up,
      wickDownColor: palette.down,
    });
    closeRef.current?.applyOptions({ color: closeColor });
    for (const key of MA_KEYS) maRefs.current[key]?.applyOptions({ color: maColors[key] });
  }, [palette, maColors, closeColor]);

  useEffect(() => {
    candleRef.current?.applyOptions({ visible: visibility.candles });
    closeRef.current?.applyOptions({ visible: visibility.close });
    for (const key of MA_KEYS) maRefs.current[key]?.applyOptions({ visible: visibility[key] });
  }, [visibility]);

  useEffect(() => {
    if (!candleRef.current || !closeRef.current || !volumeRef.current) return;
    candleRef.current.setData(toCandlestickSeriesData(data.candles));
    closeRef.current.setData(data.candles.map((c): LineData<Time> => ({ time: toBusinessDay(c.time), value: c.close })));
    for (const key of MA_KEYS) {
      maRefs.current[key]?.setData(
        data.overlays[key].filter((p) => p.value !== null).map((p) => ({ time: toBusinessDay(p.time), value: Number(p.value) })),
      );
    }
    const index = new Map(data.candles.map((c, i) => [c.time, i]));
    volumeRef.current.setData(
      data.volume.map((item): HistogramData<Time> => {
        const i = index.get(item.time);
        const prev = i ? data.candles[i - 1].close : null;
        const close = i != null ? data.candles[i].close : null;
        const color =
          prev === null || close === null || close === prev ? palette.volumeFlat : close > prev ? palette.volumeUp : palette.volumeDown;
        return { time: toBusinessDay(item.time), value: item.value, color };
      }),
    );
    // 決議 c14：可視範圍直接貼合資料，不再固定「今天往前 6 個月」
    chartRef.current?.timeScale().fitContent();
  }, [data, palette]);

  const legendButton = (key: PriceChartSeriesKey, label: string, swatch: React.ReactNode) => (
    <button
      key={key}
      type="button"
      aria-pressed={visibility[key]}
      onClick={() => setVisibility((cur) => getNextPriceChartSeriesVisibility(cur, key))}
      className={cn(
        'inline-flex min-h-8 items-center gap-1.5 rounded-md border px-2 py-1 transition-colors',
        visibility[key] ? 'border-transparent bg-card text-subtle' : 'border-border bg-muted text-muted-foreground opacity-55',
      )}
    >
      {swatch}
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/60 p-3 text-xs text-muted-foreground">
        <p className="mb-2 text-[11px] font-semibold text-subtle">價格圖</p>
        <div className="flex flex-wrap items-center gap-2">
          {legendButton('candles', 'K 線', <span className="h-2.5 w-3 rounded-[2px]" style={{ backgroundColor: palette.up }} />)}
          {legendButton('close', '收盤價', <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: closeColor }} />)}
          {activeMa.map((key) => legendButton(key, key, <span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: maColors[key] }} />))}
        </div>
        <p className="mt-3 leading-5">
          下方紅綠柱代表每日成交量，柱子越高代表當天交易越熱絡。紅色代表上漲日成交量、綠色代表下跌日成交量。成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。
        </p>
      </div>

      <div className="relative h-[360px] w-full overflow-hidden rounded-lg border bg-card sm:h-[460px]">
        <div className="pointer-events-none absolute top-2 left-2 z-10 max-w-[calc(100%-1rem)] rounded-md border bg-card/90 px-3 py-2 text-xs text-subtle shadow-card backdrop-blur">
          {overlay ? (
            <div className="space-y-1 tabular-nums">
              <p>
                日期：{overlay.date}　開：{fmt2(overlay.open)}　高：{fmt2(overlay.high)}　低：{fmt2(overlay.low)}　收：{fmt2(overlay.close)}
                {activeMa.map((key) => `　${key}：${fmt2(overlay.ma[key])}`).join('')}
              </p>
              <p>
                成交量：{fmtVolume(overlay.volume, '無資料')}　價格變化：{overlay.changeLabel}
              </p>
              <p>{relativeText(overlay.close, overlay.ma.MA20, overlay.ma.MA60)}</p>
              <p>{volumeCompare(overlay.volume, volumeInsight.ma20)}</p>
            </div>
          ) : (
            <span>日期：--　收盤：--{activeMa.map((key) => `　${key}：--`).join('')}</span>
          )}
        </div>
        <div ref={containerRef} className="h-full w-full" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border bg-muted/60 p-4 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">目前圖表解讀</p>
          <p className="mt-2 font-semibold">目前趨勢：{trendText(overlay?.close ?? null, overlay?.ma.MA20 ?? null, overlay?.ma.MA60 ?? null)}</p>
          <p className="mt-1 text-subtle">均線結構：{maStructureText(overlay?.close ?? null, overlay?.ma.MA20 ?? null, overlay?.ma.MA60 ?? null)}</p>
          <p className="mt-1 text-subtle">目前位置：{overlay ? relativeText(overlay.close, overlay.ma.MA20, overlay.ma.MA60) : '資料不足'}</p>
          <p className="mt-2 text-subtle">提醒：若跌破 MA20，短線可能進入整理；若跌破 MA60，中期趨勢可能轉弱。</p>
        </div>
        <div className="rounded-lg border bg-muted/60 p-4 text-sm">
          <p className="text-xs font-semibold text-muted-foreground">輔助資訊｜成交量</p>
          <p className="mt-2 text-subtle">今日成交量：{fmtVolume(volumeInsight.latestVolume, '無資料')}</p>
          <p className="mt-1 text-subtle">
            20 日均量：{fmtVolume(volumeInsight.ma20, '無資料')}
            {volumeInsight.vsMa20 === null
              ? ''
              : `（${volumeInsight.vsMa20 >= 0 ? '高於' : '低於'} ${Math.abs(volumeInsight.vsMa20).toFixed(1)}%）`}
          </p>
          <p className="mt-1 text-subtle">60 日均量：{fmtVolume(volumeInsight.ma60, '無資料')}</p>
          <p className="mt-1 font-medium">量能狀態：{volumeInsight.state}</p>
          <p className="mt-2 text-subtle">量能解讀：{volumeInterpretation(volumeInsight.state)}成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。</p>
        </div>
      </div>
    </div>
  );
}
