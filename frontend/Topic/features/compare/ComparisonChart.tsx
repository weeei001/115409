import React, { useEffect, useMemo, useRef, useState } from 'react';
import { EChart } from '@/components/charts/EChart';
import { compareLineOption } from '@/lib/charts/adapters';
import { useTheme } from '@/lib/theme/ThemeContext';
import type { MultiStockResponse } from '@/lib/types/api';
import type { CompareChartMode } from '@/lib/types/compare';
import { toCompareChartSeries, toggleHiddenSymbol, visibleSymbolsFromHidden } from '@/lib/utils/compare';
import { cn } from '@/lib/cn';
import type { BenchmarkHistoryResponse } from '@/lib/api/benchmark';
import { buildBenchmarkComparison } from '@/lib/utils/compareBenchmark';
import { getChartPalette } from '@/lib/charts/theme';
import { fmtPercent } from '@/lib/utils/format';

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
      className="flex w-full shrink-0 flex-wrap gap-1.5 rounded-2xl border bg-muted p-1 sm:w-fit"
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
            'min-h-9 flex-1 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors sm:flex-none sm:px-4 sm:py-2 sm:text-sm',
            mode === m.key ? 'bg-card text-brand-text shadow-sm ring-1 ring-brand/30' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {m.label}
        </button>
      ))}
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
}

/** 比較主圖：三種模式；下方圖例可切換單檔顯示 */
export function ComparisonChart({ data, symbols, mode, onModeChange, symbolColors, benchmark = null, benchmarkLoading = false }: Props) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [hiddenSymbols, setHiddenSymbols] = useState<string[]>([]);
  const comparison = useMemo(() => buildBenchmarkComparison({ ...data, symbols }, benchmark), [data, symbols, benchmark]);
  const chartData = mode !== 'price' && comparison.chart ? comparison.chart : data;
  const chartSymbols = mode !== 'price' && comparison.chart ? comparison.chart.symbols : symbols;
  const chartColors = useMemo<Record<string, string>>(() => ({ ...symbolColors, TAIEX: getChartPalette(isDark).tick }), [symbolColors, isDark]);
  const symbolKey = chartSymbols.join('|');

  // 換一組股票時，只保留仍在清單裡的隱藏設定
  useEffect(() => {
    setHiddenSymbols((prev) => prev.filter((sym) => chartSymbols.includes(sym)));
  }, [symbolKey]); // symbols 每次 render 都是新陣列，用 symbolKey 判斷內容是否改變

  const visibleSymbols = useMemo(() => visibleSymbolsFromHidden(chartSymbols, hiddenSymbols), [chartSymbols, hiddenSymbols]);
  const series = useMemo(() => toCompareChartSeries({ ...chartData, symbols: chartSymbols }, mode), [chartData, chartSymbols, mode]);
  const option = useMemo(() => compareLineOption(series, visibleSymbols, chartColors, mode, isDark), [series, visibleSymbols, chartColors, mode, isDark]);
  const meta = MODE_META[mode];
  const lastIndex = series.dates.length - 1;

  if (!option) return <p className="py-12 text-center text-sm text-muted-foreground">共同有效收盤價不足 2 天，無法建立同期間比較。可調整區間或選擇資料較完整的股票。</p>;

  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-card">
      <div className="flex flex-col gap-3 border-b px-5 pt-4 pb-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 flex-1 space-y-1">
          <h2 className="text-base font-bold">{meta.title}</h2>
          <p className="text-xs text-muted-foreground">{meta.description}</p>
          <p className="text-xs text-muted-foreground">實際比較期間：{series.dates[0]} 至 {series.dates[lastIndex]}</p>
          <p className="text-xs text-muted-foreground">
            大盤基準：臺灣加權股價指數（TAIEX，不含現金股利）。
            {benchmarkLoading ? '載入中…' : comparison.returnPct == null ? comparison.warning : `同期間漲跌幅 ${fmtPercent(comparison.returnPct, { sign: true })}。${comparison.warning ?? ''}`}
            {mode === 'price' ? ' 指數走勢顯示於「指數化」與「區間漲跌幅」模式。' : ''}
            {' '}<a href="https://www.twse.com.tw/zh/indices/taiex/mi-5min-hist.html" target="_blank" rel="noreferrer" className="underline">證交所資料來源</a>
          </p>
        </div>
        <ModeTabs mode={mode} onModeChange={onModeChange} />
      </div>

      <div className="p-4">
        <div className="h-[260px] sm:h-[340px] lg:h-[420px]">
          <EChart title={`${meta.title}：${visibleSymbols.join('、') || '無股票'}`} option={option} height="100%" />
        </div>
        {visibleSymbols.length === 0 ? (
          <p className="mt-2 text-xs text-brand-text">已隱藏全部股票，請用下方圖例重新開啟或按「全顯示」。</p>
        ) : null}
      </div>

      <div className="space-y-2 border-t px-5 pt-3 pb-4">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setHiddenSymbols([])}
            className="min-h-9 rounded-full border px-3 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand-text"
          >
            全顯示
          </button>
          <button
            type="button"
            onClick={() => setHiddenSymbols([...chartSymbols])}
            className="min-h-9 rounded-full border px-3 py-1 text-xs text-subtle transition-colors hover:border-brand hover:text-brand-text"
          >
            全隱藏
          </button>
          <span className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs text-subtle">
            已顯示 {visibleSymbols.length}/{chartSymbols.length} 條
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {chartSymbols.map((sym) => {
            const hidden = hiddenSymbols.includes(sym);
            return (
              <button
                key={sym}
                type="button"
                aria-pressed={!hidden}
                onClick={() => setHiddenSymbols((prev) => toggleHiddenSymbol(prev, sym))}
                className={cn(
                  'inline-flex min-h-9 items-center gap-2 rounded-full bg-muted px-3 py-1 font-mono text-xs transition-colors',
                  hidden ? 'text-muted-foreground opacity-60' : 'text-foreground',
                )}
              >
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: chartColors[sym] }} aria-hidden />
                {sym === 'TAIEX' ? 'TAIEX 加權指數' : sym}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground">
          圖例色彩與摘要卡、波動與漲跌幅散點一致；Y 軸口徑：{meta.yAxisLabel}。缺值保留斷線；點擊圖例可切換顯示。
        </p>
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
      </div>
    </section>
  );
}
