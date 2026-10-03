import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EChart } from '@/components/charts/EChart';
import { NeatlineSoundings, SOUNDING_FRAME_STYLE, SOUNDING_PAD, sameMarks, type SoundingMarks } from '@/components/charts/NeatlineSoundings';
import { LedgerPanel } from '@/components/common/Ledger';
import { EmptyState } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { compareLineOption, plottedSpan, plottedSpanText } from '@/lib/charts/adapters';
import type { EChartsOption, echarts } from '@/lib/charts/echarts';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { MultiStockResponse } from '@/lib/types/api';
import type { CompareChartMode } from '@/lib/types/compare';
import { toCompareChartSeries, toggleHiddenSymbol, visibleSymbolsFromHidden } from '@/lib/utils/compare';
import { cn } from '@/lib/cn';
import type { BenchmarkHistoryResponse } from '@/lib/api/benchmark';
import { buildBenchmarkComparison } from '@/lib/utils/compareBenchmark';
import { getChartPalette } from '@/lib/charts/theme';
import { fmtPercent } from '@/lib/utils/format';

/** 大盤基準在比較資料裡的代號（lib/utils/compareBenchmark 併入的 benchmark.id） */
const BENCHMARK_ID = 'TAIEX';
const BENCHMARK_LABEL = '大盤基準';

const MODES: Array<{ key: CompareChartMode; label: string }> = [
  { key: 'price', label: '報價' },
  { key: 'index100', label: '指數化' },
  { key: 'cumulativeReturn', label: '區間漲跌幅%' },
];

const MODE_META: Record<CompareChartMode, { title: string; description: string; yAxisLabel: string }> = {
  price: { title: '多股價格比較', description: '顯示未還原收盤價（單位：元），未計入股息。', yAxisLabel: '收盤價（元）' },
  index100: { title: '多股指數化比較', description: '以共同起日的未還原收盤價設為 100，比較相對走勢；未計入股息。', yAxisLabel: '指數（共同起日=100）' },
  cumulativeReturn: { title: '多股區間漲跌幅比較', description: '以共同起日的未還原收盤價為基準，比較價格漲跌幅；未計入股息。', yAxisLabel: '區間漲跌幅（%）' },
};

function ModeTabs({ mode, onModeChange }: { mode: CompareChartMode; onModeChange: (mode: CompareChartMode) => void }) {
  const listRef = useRef<HTMLDivElement>(null);
  const keys = MODES.map((m) => m.key);
  const move = (next: number) => {
    const key = keys[(next + keys.length) % keys.length];
    onModeChange(key);
    listRef.current?.querySelector<HTMLElement>(`[data-tab="${key}"]`)?.focus();
  };
  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label="圖表顯示模式"
      className="flex w-full shrink-0 border border-input sm:w-fit"
      onKeyDown={(e) => {
        const idx = keys.indexOf(mode);
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(idx + 1);
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(idx - 1);
        else if (e.key === 'Home') move(0);
        else if (e.key === 'End') move(keys.length - 1);
        else return;
        e.preventDefault();
      }}
    >
      {MODES.map((m) => (
        <button
          key={m.key}
          data-tab={m.key}
          type="button"
          role="tab"
          aria-selected={mode === m.key}
          tabIndex={mode === m.key ? 0 : -1}
          onClick={() => onModeChange(m.key)}
          className={cn(
            // 選取的分頁：淺色底＋下緣 2px 墨色標線。這裡緊鄰各檔代表色，不用燈色以免和橘、褐色的線混在一起
            'relative min-h-11 flex-1 px-3 text-[13px] font-medium whitespace-nowrap transition-colors duration-(--dur-flash) ease-flash not-first:border-l focus-lamp sm:flex-none sm:px-4',
            'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground after:opacity-0 after:transition-opacity after:duration-(--dur-sweep)',
            mode === m.key ? 'bg-accent text-foreground after:opacity-100' : 'bg-card text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

/** 圖廓邊緣水深字的數值寫法：報價 2 位小數、指數 1 位、區間漲跌幅帶正負號 */
function soundingValue(mode: CompareChartMode, v: number): string {
  if (mode === 'price') return v.toFixed(2);
  if (mode === 'index100') return v.toFixed(1);
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}

/** 繪圖區左上角相對圖廓外框：圖廓內距＋內框 1px 邊線＋內框 8px 內距（p-2） */
const PLOT_ORIGIN = { x: SOUNDING_PAD + 1 + 8, y: SOUNDING_PAD + 1 + 8 };

/** 圖例色樣：個股是 3px 色條，大盤基準是虛線 */
function Swatch({ color, dashed, dim }: { color: string | undefined; dashed: boolean; dim: boolean }) {
  return dashed ? (
    <span aria-hidden className={cn('inline-block w-4 border-t-2 border-dashed', dim && 'opacity-40')} style={{ borderColor: color }} />
  ) : (
    <span aria-hidden className={cn('inline-block h-4 w-[3px]', dim && 'opacity-40')} style={{ backgroundColor: color }} />
  );
}

/**
 * 圖廓本身。掛載時 `.neatline::after` 的燈色光束由左到右掃一次（main.css）。
 * 同一份資料（beamKey）在這一頁已經掃過時（例如比較指標算完、外層帳頁換成比較結果而重新掛載），
 * 把光束藏起來，不重掃第二次。
 */
function BeamFrame({ beamKey, swept, children }: { beamKey: string; swept?: Set<string>; children: React.ReactNode }) {
  const [sweep] = useState(() => !swept?.has(beamKey));
  useEffect(() => {
    swept?.add(beamKey);
  }, [beamKey, swept]);
  return (
    <div className={cn('neatline', !sweep && 'after:hidden')} data-beam={sweep ? 'sweep' : 'still'} style={SOUNDING_FRAME_STYLE}>
      {children}
    </div>
  );
}

interface Props {
  data: MultiStockResponse;
  symbols: string[];
  mode: CompareChartMode;
  onModeChange: (mode: CompareChartMode) => void;
  symbolColors: Record<string, string>;
  benchmark?: BenchmarkHistoryResponse | null;
  benchmarkLoading?: boolean;
  /** 這一頁已經掃過光束的資料 key（由頁面持有，圖表重新掛載時不重掃） */
  sweptBeams?: Set<string>;
}

/**
 * 航跡圖（比較主圖）：三種模式；「指數化」把各檔收盤與加權指數在共同起日換算成 100，大盤基準畫成虛線。
 * 全頁唯一的圖廓（neatline）框在這張圖上；下方圖例可切換單檔顯示。
 * 回傳的是帳頁面板（LedgerPanel），由外層的比較結果帳頁（CompareHero）決定標題。
 */
export function ComparisonChart({ data, symbols, mode, onModeChange, symbolColors, benchmark = null, benchmarkLoading = false, sweptBeams }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [hiddenSymbols, setHiddenSymbols] = useState<string[]>([]);
  const comparison = useMemo(() => buildBenchmarkComparison({ ...data, symbols }, benchmark), [data, symbols, benchmark]);
  const chartData = mode !== 'price' && comparison.chart ? comparison.chart : data;
  const chartSymbols = mode !== 'price' && comparison.chart ? comparison.chart.symbols : symbols;
  const chartColors = useMemo<Record<string, string>>(() => ({ ...symbolColors, [BENCHMARK_ID]: getChartPalette(isDark).tick }), [symbolColors, isDark]);
  const symbolKey = chartSymbols.join('|');

  // 換一組股票時，只保留仍在清單裡的隱藏設定
  useEffect(() => {
    setHiddenSymbols((prev) => prev.filter((sym) => chartSymbols.includes(sym)));
  }, [symbolKey]); // symbols 每次 render 都是新陣列，用 symbolKey 判斷內容是否改變

  const visibleSymbols = useMemo(() => visibleSymbolsFromHidden(chartSymbols, hiddenSymbols), [chartSymbols, hiddenSymbols]);
  const series = useMemo(() => toCompareChartSeries({ ...chartData, symbols: chartSymbols }, mode), [chartData, chartSymbols, mode]);
  const option = useMemo<EChartsOption | null>(() => {
    const base = compareLineOption(series, visibleSymbols, chartColors, mode, isDark);
    if (!base || !Array.isArray(base.series)) return base;
    // 只改外觀：大盤基準改成細虛線並以「大盤基準」稱呼，和個股的實線分開；資料不動
    return {
      ...base,
      series: base.series.map((s) => (s.name === BENCHMARK_ID && s.type === 'line'
        ? { ...s, name: BENCHMARK_LABEL, lineStyle: { ...s.lineStyle, type: 'dashed' as const, width: 1.5 } }
        : s)),
    };
  }, [series, visibleSymbols, chartColors, mode, isDark]);
  const meta = MODE_META[mode];
  const lastIndex = series.dates.length - 1;

  // 圖廓邊緣的水深：圖上（目前顯示的線）的起訖日與最高／最低值；位置在每次繪製後用 convertToPixel 量
  const extremes = useMemo(() => {
    let high: { i: number; v: number } | null = null;
    let low: { i: number; v: number } | null = null;
    for (const sym of visibleSymbols) {
      (series.values[sym] ?? []).forEach((v, i) => {
        if (typeof v !== 'number' || !Number.isFinite(v)) return;
        if (!high || v > high.v) high = { i, v };
        if (!low || v < low.v) low = { i, v };
      });
    }
    return { high: high as { i: number; v: number } | null, low: low as { i: number; v: number } | null };
  }, [series, visibleSymbols]);
  const [soundings, setSoundings] = useState<SoundingMarks | null>(null);
  const measure = useCallback(
    (chart: echarts.ECharts) => {
      const px = (i: number, v: number) => {
        const p = chart.convertToPixel({ gridIndex: 0 }, [i, v]) as number[] | undefined;
        return Array.isArray(p) && p.every(Number.isFinite) ? p : null;
      };
      const { high, low } = extremes;
      const anchor = high ?? low;
      const first = anchor ? px(0, anchor.v) : null;
      const last = anchor ? px(lastIndex, anchor.v) : null;
      const hi = high ? px(high.i, high.v) : null;
      const lo = low ? px(low.i, low.v) : null;
      const next: SoundingMarks | null =
        lastIndex < 0 || !first || !last
          ? null
          : {
              first: { text: series.dates[0], x: Math.round(first[0]) },
              last: { text: series.dates[lastIndex], x: Math.round(last[0]) },
              high: high && hi ? { text: `高 ${soundingValue(mode, high.v)}`, y: Math.round(hi[1]) } : null,
              low: low && lo ? { text: `低 ${soundingValue(mode, low.v)}`, y: Math.round(lo[1]) } : null,
              height: chart.getHeight(),
            };
      setSoundings((prev) => (sameMarks(prev, next) ? prev : next));
    },
    [extremes, lastIndex, series.dates, mode],
  );
  // 圖廓的光束只在資料到達時掃一次：換股票或換期間（資料的起訖日）才換 key 重新掛載；
  // 切換模式、開關單檔、滑過、切主題都不會改變這個 key
  const beamKey = `${symbols.join(',')}|${data.start_date}|${data.end_date}`;

  if (!option) {
    return (
      <LedgerPanel title="航跡圖">
        <EmptyState>共同有效收盤價不足 2 天，無法建立同期間比較。可調整區間或選擇資料較完整的股票。</EmptyState>
      </LedgerPanel>
    );
  }

  return (
    <LedgerPanel className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">航跡圖 · {meta.title}</h3>
          <p className="characteristic mt-0.5" data-plotted-span>
            {meta.yAxisLabel} · 圖上 {plottedSpanText(plottedSpan(series.dates))}
          </p>
        </div>
        <ModeTabs mode={mode} onModeChange={onModeChange} />
      </div>

      {/* 圖廓：全頁只有這一個 */}
      <BeamFrame key={beamKey} beamKey={beamKey} swept={sweptBeams}>
        <div className="h-[320px] p-2 sm:h-[380px] lg:h-[440px]">
          <EChart title={`${meta.title}：${visibleSymbols.join('、') || '無股票'}`} option={option} height="100%" onRendered={measure} />
        </div>
        {soundings && visibleSymbols.length ? <NeatlineSoundings marks={soundings} origin={PLOT_ORIGIN} /> : null}
      </BeamFrame>
      {visibleSymbols.length === 0 ? (
        <p className="text-[13px] text-subtle">已隱藏全部股票，請用下方圖例重新開啟或按「全顯示」。</p>
      ) : null}

      {/* 圖例：可切換單檔；色彩與下方條目、散點一致 */}
      <div className="-ml-1.5 flex flex-wrap items-center gap-x-1" role="group" aria-label="切換圖上的股票">
        {chartSymbols.map((sym) => {
          const hidden = hiddenSymbols.includes(sym);
          const isBenchmark = sym === BENCHMARK_ID;
          return (
            <button
              key={sym}
              type="button"
              aria-pressed={!hidden}
              onClick={() => setHiddenSymbols((prev) => toggleHiddenSymbol(prev, sym))}
              className={cn(
                // 圖例＝開關：色樣＋代號的純文字開關，不畫外框；隱藏的加刪除線
                'inline-flex min-h-11 items-center gap-2 rounded-sm px-1.5 font-mono text-[13px] tabular-nums transition-colors duration-(--dur-flash) hover:bg-accent focus-lamp',
                hidden ? 'text-muted-foreground line-through decoration-1' : 'text-foreground',
              )}
            >
              <Swatch color={chartColors[sym]} dashed={isBenchmark} dim={hidden} />
              {isBenchmark ? <span className="font-sans">{BENCHMARK_LABEL} TAIEX</span> : sym}
            </button>
          );
        })}
        <span className="mx-1 hidden h-6 w-px bg-border sm:inline-block" aria-hidden />
        <Button type="button" variant="ghost" onClick={() => setHiddenSymbols([])} className="text-[13px]">
          全顯示
        </Button>
        <Button type="button" variant="ghost" onClick={() => setHiddenSymbols([...chartSymbols])} className="text-[13px]">
          全隱藏
        </Button>
        <span className="characteristic">
          已顯示 {visibleSymbols.length}/{chartSymbols.length} 條
        </span>
      </div>

      <div className="space-y-1 border-t pt-3 text-[13px] leading-relaxed text-muted-foreground">
        <p>{meta.description}缺值保留斷線。</p>
        <p>
          大盤基準：臺灣加權股價指數（TAIEX，不含現金股利）。
          {benchmarkLoading ? '載入中…' : comparison.returnPct == null ? comparison.warning : `同期間漲跌幅 ${fmtPercent(comparison.returnPct, { sign: true })}。${comparison.warning ?? ''}`}
          {mode === 'price' ? ' 指數走勢顯示於「指數化」與「區間漲跌幅」模式。' : ''}
          {' '}<a href="https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html" target="_blank" rel="noreferrer" className="text-subtle underline underline-offset-4 hover:text-foreground">證交所資料來源</a>
        </p>
      </div>
      <div className="sr-only">
        <p>圖表資料摘要（最後一個交易日）</p>
        <table>
          <thead>
            <tr>
              <th scope="col">日期</th>
              {chartSymbols.map((sym) => (
                <th key={sym} scope="col">
                  {sym}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{series.dates[lastIndex] ?? '—'}</td>
              {chartSymbols.map((sym) => {
                const v = series.values[sym]?.[lastIndex];
                return <td key={sym}>{typeof v === 'number' ? v.toFixed(2) : '—'}</td>;
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </LedgerPanel>
  );
}
