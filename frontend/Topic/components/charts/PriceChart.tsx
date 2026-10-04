import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type Logical,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { MaKey, PriceChartData } from '@/lib/types/view';
import { MA_KEYS } from '@/lib/types/view';
import { fmtPrice, fmtVolume } from '@/lib/utils/format';
import {
  DEFAULT_PRICE_CHART_SERIES_VISIBILITY,
  getNextPriceChartSeriesVisibility,
  timeToYmd,
  toBusinessDay,
  toCandlestickSeriesData,
  type PriceChartSeriesKey,
  type PriceChartSeriesVisibility,
} from '@/lib/charts/priceChart';
import { getChartPalette, getMaColors } from '@/lib/charts/theme';
import { useTheme } from '@/lib/theme/ThemeContext';
import { cn } from '@/lib/cn';
import { buildVolumeInsight, type VolumeInsight } from '@/lib/charts/volumeInsight';
import { NeatlineSoundings, SOUNDING_FRAME_STYLE, SOUNDING_PAD, sameMarks, type SoundingMarks } from './NeatlineSoundings';

interface Props {
  data: PriceChartData;
  /** 目前有向後端要資料的均線（MA 週期選擇器），圖例只列這些 */
  activeMa: MaKey[];
  volumeInsight: VolumeInsight | null;
  /**
   * 精簡版（個股頁首屏的主圖）：只留圖例切換與一行讀數，不放說明文字、讀數表與解讀；
   * 詳細控制與解讀在「價量走勢」抽屜。
   */
  compact?: boolean;
  /** 圖框：neatline＝本頁唯一的圖廓；plain＝一般 1px 邊框（抽屜裡的第二張圖用，避免一頁兩個圖廓） */
  frame?: 'neatline' | 'plain';
  /** 繪圖區高度（Tailwind class） */
  heightClassName?: string;
}

/** 窄螢幕（< 640px）預設只顯示最後幾根 K 棒，K 棒較寬、日期刻度不擠；仍可拖曳與縮放 */
const MOBILE_BREAKPOINT = 640;
const MOBILE_VISIBLE_BARS = 40;

/**
 * 首屏主圖（compact）預設只開 K 線＋MA5＋MA20（成交量柱一律顯示）：收盤線與 MA10／MA60 關閉，
 * 使用者可以從圖例自己打開。抽屜裡的完整圖維持全部開啟。
 */
const HERO_SERIES_VISIBILITY: PriceChartSeriesVisibility = {
  ...DEFAULT_PRICE_CHART_SERIES_VISIBILITY,
  close: false,
  MA10: false,
  MA60: false,
};

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

const LEFT_EDGE_BARS = 2;

/** 時間軸刻度：只寫 MM-DD（年初寫年份）。 */
function formatTickLabel(time: Time, type: TickMarkType, index: Map<string, number>, total: number): string {
  const full = timeToYmd(time);
  const i = index.get(full);
  // 最左兩根的刻度會被畫布左緣切掉一半，不寫字；右側已用 rightOffset 留白，最後一根的日期可以完整寫出
  if (i !== undefined && i < LEFT_EDGE_BARS && total > LEFT_EDGE_BARS) return '';
  if (type === TickMarkType.Year) return full.slice(0, 4);
  return full.slice(5, 10);
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

function volumeCompare(volume: number | null, ma20: number | null): string {
  if (volume === null || ma20 === null || ma20 <= 0) return '無 20 日均量可比較';
  const pct = Math.abs(((volume - ma20) / ma20) * 100).toFixed(1);
  return volume >= ma20 ? `量增（高於 20 日均量 ${pct}%）` : `量縮（低於 20 日均量 ${pct}%）`;
}

/** 資料是最近一筆已儲存的收盤，不是今天：句子用基準日開頭，不寫「今日」 */
function volumeInterpretation(state: string, date: string | null): string {
  const day = date ? `${date} 的成交量` : '最近交易日成交量';
  if (state === '量增') return `${day}高於 20 日均量，市場交易熱度增加。若價格同步站上均線，量增可作為趨勢延續的輔助確認。`;
  if (state === '量縮') return `${day}低於 20 日均量，市場追價意願偏保守。即使價格上漲，也要留意趨勢延續力道可能不足。`;
  if (state === '接近均量') return `${day}接近 20 日均量，市場交易熱度大致正常。量能沒有明顯放大或萎縮，需配合價格結構觀察。`;
  return '目前成交量資料不足，暫時無法判斷量能是否支持趨勢。';
}

const roundOrNull = (v: number | null) => (v === null || !Number.isFinite(v) ? null : Math.round(v));

export function PriceChart({
  data,
  activeMa,
  volumeInsight: loadedVolumeInsight,
  compact = false,
  frame = 'neatline',
  heightClassName = 'h-[340px] sm:h-[460px]',
}: Props) {
  const volumeInsight = loadedVolumeInsight ?? buildVolumeInsight([], '');
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
  const [visibility, setVisibility] = useState<PriceChartSeriesVisibility>(() =>
    compact ? HERO_SERIES_VISIBILITY : DEFAULT_PRICE_CHART_SERIES_VISIBILITY,
  );
  const withSoundings = frame === 'neatline';
  const [soundings, setSoundings] = useState<SoundingMarks | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const measureFrame = useRef(0);

  /** 量出圖上可見 K 棒的起訖日與最高／最低價及其座標（價格軸在下一幀才重算，所以排在 rAF 裡） */
  const scheduleSoundings = () => {
    if (!withSoundings || typeof window === 'undefined') return;
    cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(() => {
      measureFrame.current = requestAnimationFrame(() => {
        const chart = chartRef.current;
        const candle = candleRef.current;
        const candles = dataRef.current.candles;
        const height = containerRef.current?.clientHeight ?? 0;
        if (!chart || !candle || !candles.length || !height) {
          setSoundings(null);
          return;
        }
        const ts = chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        const from = Math.max(0, range ? Math.ceil(range.from) : 0);
        const to = Math.min(candles.length - 1, range ? Math.floor(range.to) : candles.length - 1);
        if (from > to) {
          setSoundings(null);
          return;
        }
        let high = -Infinity;
        let low = Infinity;
        for (let i = from; i <= to; i++) {
          if (Number.isFinite(candles[i].high)) high = Math.max(high, candles[i].high);
          if (Number.isFinite(candles[i].low)) low = Math.min(low, candles[i].low);
        }
        const xFirst = ts.logicalToCoordinate(from as Logical);
        const xLast = ts.logicalToCoordinate(to as Logical);
        const highY = roundOrNull(candle.priceToCoordinate(high));
        const lowY = roundOrNull(candle.priceToCoordinate(low));
        const next: SoundingMarks | null =
          xFirst === null || xLast === null || !Number.isFinite(high) || !Number.isFinite(low)
            ? null
            : {
                first: { text: candles[from].time, x: Math.round(xFirst) },
                last: { text: candles[to].time, x: Math.round(xLast) },
                // y 為 null（K 線被關掉、價格軸換算不到）時不畫該值
                high: highY === null ? null : { text: `高 ${high.toFixed(2)}`, y: highY },
                low: lowY === null ? null : { text: `低 ${low.toFixed(2)}`, y: lowY },
                height,
              };
        setSoundings((prev) => (sameMarks(prev, next) ? prev : next));
      });
    });
  };
  const scheduleSoundingsRef = useRef(scheduleSoundings);
  scheduleSoundingsRef.current = scheduleSoundings;

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
  const tickIndexRef = useRef<{ index: Map<string, number>; total: number }>({ index: new Map(), total: 0 });
  tickIndexRef.current = useMemo(() => ({ index: new Map(data.candles.map((c, i) => [c.time, i])), total: data.candles.length }), [data]);

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
    const narrow = el.clientWidth > 0 && el.clientWidth < MOBILE_BREAKPOINT;
    const chart = createChart(el, {
      autoSize: true,
      localization: { timeFormatter: (t: Time) => timeToYmd(t) },
      crosshair: { mode: 1 },
      timeScale: {
        tickMarkFormatter: (t: Time, type: TickMarkType) => formatTickLabel(t, type, tickIndexRef.current.index, tickIndexRef.current.total),
        // 右側留白讓最後一個日期刻度完整顯示；刻度以 MM-DD 的字寬估間距（手機估 5 字，桌機估 7 字較疏）
        rightOffset: narrow ? 4 : 3,
        minBarSpacing: 2,
        tickMarkMaxCharacterLength: narrow ? 5 : 7,
      },
      // 上緣留白：最高價與最上方的價格刻度不重疊；下緣留給成交量；上下緣只畫完整的刻度字
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.26 }, entireTextOnly: true },
      layout: { attributionLogo: false, background: { color: 'transparent' }, fontSize: 11, fontFamily: 'IBM Plex Mono, Noto Sans TC, ui-monospace, monospace' },
    });
    // 最新收盤已寫在圖上方的讀數列，價格軸不再疊一個收盤價標籤（會壓到刻度）
    candleRef.current = chart.addSeries(CandlestickSeries, { wickVisible: true, borderVisible: true, priceLineVisible: false, lastValueVisible: false });
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
        setHover(buildOverlay(timeToYmd(param.time), { open, high, low, close }));
      });
    });
    // 拖曳、縮放、改變尺寸時重新量圖廓邊緣的起訖日與最高／最低價
    const remeasure = () => scheduleSoundingsRef.current();
    chart.timeScale().subscribeVisibleLogicalRangeChange(remeasure);
    chart.timeScale().subscribeSizeChange(remeasure);
    chartRef.current = chart;
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(measureFrame.current);
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(remeasure);
      chart.timeScale().unsubscribeSizeChange(remeasure);
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
    // 開關序列會讓價格軸重新縮放，最高／最低價的位置跟著變
    scheduleSoundings();
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
    const timeScale = chartRef.current?.timeScale();
    timeScale?.fitContent();
    // 窄螢幕：預設只看最後 40 根，K 棒較寬；使用者仍可拖曳、縮放看全部
    const width = containerRef.current?.clientWidth ?? 0;
    const total = data.candles.length;
    if (timeScale && width > 0 && width < MOBILE_BREAKPOINT && total > MOBILE_VISIBLE_BARS) {
      timeScale.setVisibleLogicalRange({ from: total - MOBILE_VISIBLE_BARS, to: total - 1 + 4 });
    }
    scheduleSoundings();
  }, [data, palette]);

  const readout = [
    { label: '開', value: fmtPrice(overlay?.open ?? null) },
    { label: '高', value: fmtPrice(overlay?.high ?? null) },
    { label: '低', value: fmtPrice(overlay?.low ?? null) },
    { label: '收', value: fmtPrice(overlay?.close ?? null) },
    ...activeMa.map((key) => ({ label: key, value: fmtPrice(overlay?.ma[key] ?? null) })),
    { label: '成交量', value: fmtVolume(overlay?.volume ?? null, '無資料') },
  ];

  // 圖例＝序列開關：一列純文字開關（色樣＋名稱），不畫外框；關閉的序列加刪除線、色樣變淡。
  // 觸控範圍靠內距撐到 44px 高；aria-pressed 告訴輔助科技目前開或關。
  const legendButton = (key: PriceChartSeriesKey, label: string, swatch: React.ReactNode) => (
    <button
      key={key}
      type="button"
      aria-pressed={visibility[key]}
      onClick={() => setVisibility((cur) => getNextPriceChartSeriesVisibility(cur, key))}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-xs whitespace-nowrap tabular-nums transition-colors duration-(--dur-flash) hover:bg-accent focus-lamp-inset sm:gap-1.5 sm:px-1.5',
        visibility[key] ? 'text-foreground' : 'text-muted-foreground line-through decoration-1',
      )}
    >
      <span className={cn('inline-flex', !visibility[key] && 'opacity-40')}>{swatch}</span>
      {label}
    </button>
  );

  const legendButtons = (
    <div
      className="-ml-1 flex min-w-0 flex-nowrap items-center overflow-x-auto [scrollbar-width:none] sm:-ml-1.5"
      role="group"
      aria-label="切換圖上的序列"
    >
      {legendButton('candles', 'K 線', <span className="h-2.5 w-2.5" style={{ backgroundColor: palette.up }} />)}
      {legendButton('close', '收盤價', <span className="h-0.5 w-3" style={{ backgroundColor: closeColor }} />)}
      {activeMa.map((key) => legendButton(key, key, <span className="h-0.5 w-3" style={{ backgroundColor: maColors[key] }} />))}
    </div>
  );

  const plot = (
    <div
      className={frame === 'neatline' ? 'neatline' : 'border'}
      style={withSoundings ? SOUNDING_FRAME_STYLE : undefined}
    >
      <div className={cn('relative w-full overflow-hidden', heightClassName)}>
        <div ref={containerRef} className="h-full w-full" />
      </div>
      {/* 繪圖區左上角＝圖廓內距＋內框 1px 邊線 */}
      {withSoundings && soundings ? <NeatlineSoundings marks={soundings} origin={{ x: SOUNDING_PAD + 1, y: SOUNDING_PAD + 1 }} /> : null}
    </div>
  );

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          {legendButtons}
          {/* 一行讀數：滑過圖表時換成該日數字，離開後回到最近交易日 */}
          <p className="characteristic flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums" aria-live="off">
            <span className="whitespace-nowrap text-foreground">{hover ? '游標' : '最近交易日'} {overlay?.date ?? '--'}</span>
            {readout.map((cell, i) => (
              // 手機只留開高低收，均線與成交量在 sm 以上才列出（抽屜裡有完整讀數表）
              <span key={cell.label} className={cn('whitespace-nowrap', i >= 4 && 'hidden sm:inline')}>
                {cell.label} <span className="text-foreground">{cell.value}</span>
              </span>
            ))}
          </p>
        </div>
        {plot}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-xs text-muted-foreground">
        <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">價格圖</p>
        {legendButtons}
        <p className="mt-1 text-[13px] leading-relaxed">
          下方柱子是每日成交量，越高代表當天交易越熱絡；紅色是上漲日、綠色是下跌日。
        </p>
      </div>

      {/* 讀數列：放在圖上方、不蓋住 K 線；滑過圖表時換成該日數字，離開後回到最近交易日 */}
      <div className="overflow-hidden border-y" aria-live="off">
        <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-b bg-muted px-3 py-1.5">
          <span className="text-[13px] font-medium tracking-[0.04em] text-foreground">
            {hover ? '游標所在交易日' : '最近交易日'}
          </span>
          <span className="characteristic whitespace-nowrap">{overlay?.date ?? '--'}</span>
        </p>
        <dl className="-mr-px -mb-px grid grid-cols-2 bg-card sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))]">
          {readout.map((cell) => (
            <div key={cell.label} className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-2 border-r border-b px-3 py-1">
              <dt className="text-xs text-subtle">{cell.label}</dt>
              <dd className="ml-auto font-mono text-[13px] font-medium whitespace-nowrap tabular-nums">{cell.value}</dd>
            </div>
          ))}
        </dl>
        <p className="relative min-h-9 border-t bg-card px-3 py-1.5 text-xs leading-relaxed text-subtle">
          {overlay ? (
            <>
              <span className="whitespace-nowrap">{overlay.changeLabel}</span>
              {' · '}
              <span>{relativeText(overlay.close, overlay.ma.MA20, overlay.ma.MA60)}</span>
              {' · '}
              <span>{volumeCompare(overlay.volume, volumeInsight.ma20)}</span>
            </>
          ) : (
            '尚無可顯示的交易日'
          )}
        </p>
      </div>

      {/* 圖框：預設是圖廓；抽屜裡的第二張圖用一般邊框，一頁只留一個圖廓（DESIGN.md 識別特徵 2） */}
      {plot}

      <div className="grid grid-cols-1 gap-px border-y bg-border text-sm lg:grid-cols-2">
        <div className="bg-card py-4 lg:pr-4">
          <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">目前圖表解讀</p>
          <p className="mt-2 font-semibold">目前趨勢：{trendText(overlay?.close ?? null, overlay?.ma.MA20 ?? null, overlay?.ma.MA60 ?? null)}</p>
          <p className="mt-1 text-subtle">均線結構：{maStructureText(overlay?.close ?? null, overlay?.ma.MA20 ?? null, overlay?.ma.MA60 ?? null)}</p>
          <p className="mt-1 text-subtle">目前位置：{overlay ? relativeText(overlay.close, overlay.ma.MA20, overlay.ma.MA60) : '資料不足'}</p>
          <p className="mt-2 text-subtle">提醒：若跌破 MA20，短線可能進入整理；若跌破 MA60，中期趨勢可能轉弱。</p>
        </div>
        <div className="bg-card py-4 lg:pl-4">
          <p className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">輔助資訊｜成交量</p>
          <p className="mt-2 text-subtle">基準日：<span className="font-mono tabular-nums">{volumeInsight.date ?? '無資料'}</span>（結束日前最後交易日）</p>
          <p className="mt-1 text-subtle">
            基準日成交量：<span className="font-mono whitespace-nowrap tabular-nums">{fmtVolume(volumeInsight.latestVolume, '無資料')}</span>
          </p>
          <p className="mt-1 text-subtle">
            20 日均量：<span className="font-mono whitespace-nowrap tabular-nums">{fmtVolume(volumeInsight.ma20, `資料不足（有效 ${volumeInsight.count20}/20 個交易日）`)}</span>
            {volumeInsight.vsMa20 === null
              ? ''
              : `（${volumeInsight.vsMa20 >= 0 ? '高於' : '低於'} ${Math.abs(volumeInsight.vsMa20).toFixed(1)}%）`}
          </p>
          <p className="mt-1 text-subtle">
            60 日均量：<span className="whitespace-nowrap">{fmtVolume(volumeInsight.ma60, `資料不足（有效 ${volumeInsight.count60}/60 個交易日）`)}</span>
          </p>
          {volumeInsight.ma20 === 0 ? <p className="mt-1 text-subtle">20 日均量為零，無法計算量增減百分比。</p> : null}
          <p className="mt-1 font-medium">量能狀態：{volumeInsight.state}</p>
          <p className="mt-2 text-subtle">量能解讀：{volumeInterpretation(volumeInsight.state, volumeInsight.date)}成交量用來輔助判斷趨勢強弱，不是直接買賣訊號。</p>
        </div>
      </div>
    </div>
  );
}
