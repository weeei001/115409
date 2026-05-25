import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareChartMode, MultiStockResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';
import {
  COMPARE_COLOR_PALETTE,
  toCumulativeReturnChartData,
  toIndex100ChartData,
  toPriceChartData,
  toggleHiddenSymbol,
  visibleSymbolsFromHidden,
} from '../lib/utils/compare';
import { ChartResizeContainer } from './ChartResizeContainer';

const CHART_MODE_OPTIONS: Array<{ key: CompareChartMode; label: string }> = [
  { key: 'price', label: '報價' },
  { key: 'index100', label: '指數化' },
  { key: 'cumulativeReturn', label: '累積報酬%' },
];

interface Props {
  data: MultiStockResponse;
  mode: CompareChartMode;
  onModeChange: (mode: CompareChartMode) => void;
  symbolColors?: Record<string, string>;
}

type ModeMeta = {
  title: string;
  description: string;
  yAxisLabel: string;
};

const MODE_META: Record<CompareChartMode, ModeMeta> = {
  price: {
    title: '多股價格比較',
    description: '顯示原始收盤價（單位：元），適合觀察絕對價格差距。',
    yAxisLabel: '收盤價（元）',
  },
  index100: {
    title: '多股指數化比較',
    description: '以區間首日收盤價設為 100，對齊不同價位股票的相對走勢。',
    yAxisLabel: '指數（首日=100）',
  },
  cumulativeReturn: {
    title: '多股累積報酬比較',
    description: '以區間首日為基準，顯示累積報酬率，便於比較績效。',
    yAxisLabel: '累積報酬（%）',
  },
};

function fallbackColor(symbol: string, index: number): string {
  if (symbol) {
    let hash = 0;
    for (let i = 0; i < symbol.length; i += 1) {
      hash = (hash << 5) - hash + symbol.charCodeAt(i);
      hash |= 0;
    }
    return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
  }
  return COMPARE_COLOR_PALETTE[index % COMPARE_COLOR_PALETTE.length];
}

function CompareChartModeTabs({
  mode,
  onModeChange,
}: {
  mode: CompareChartMode;
  onModeChange: (mode: CompareChartMode) => void;
}) {
  const keys = CHART_MODE_OPTIONS.map((m) => m.key);

  return (
    <div
      className="flex flex-wrap gap-1.5 p-1 rounded-2xl bg-[var(--color-bg-elevated)] border border-[var(--color-border)] w-full sm:w-fit shrink-0"
      role="tablist"
      aria-label="圖表顯示模式"
      onKeyDown={(e) => {
        const idx = keys.indexOf(mode);
        let next = idx;
        switch (e.key) {
          case 'ArrowRight':
          case 'ArrowDown':
            e.preventDefault();
            next = (idx + 1) % keys.length;
            break;
          case 'ArrowLeft':
          case 'ArrowUp':
            e.preventDefault();
            next = (idx - 1 + keys.length) % keys.length;
            break;
          case 'Home':
            e.preventDefault();
            next = 0;
            break;
          case 'End':
            e.preventDefault();
            next = keys.length - 1;
            break;
          default:
            return;
        }
        onModeChange(keys[next]);
        const btn = e.currentTarget.querySelector<HTMLElement>(`[data-tab="${keys[next]}"]`);
        btn?.focus();
      }}
    >
      {CHART_MODE_OPTIONS.map((m) => (
        <button
          key={m.key}
          data-tab={m.key}
          type="button"
          role="tab"
          aria-selected={mode === m.key}
          tabIndex={mode === m.key ? 0 : -1}
          onClick={() => onModeChange(m.key)}
          className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
            mode === m.key
              ? 'bg-[var(--color-bg-card)] text-brand-deep dark:text-brand shadow-sm ring-1 ring-brand/30'
              : 'text-[var(--color-text-muted)] hover:text-brand-deep dark:hover:text-[var(--color-text-primary)]'
          }`}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export const ComparisonChart: React.FC<Props> = ({ data, mode, onModeChange, symbolColors = {} }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);
  const [hiddenSymbols, setHiddenSymbols] = useState<string[]>([]);

  const symbolKey = data.symbols.join('|');

  useEffect(() => {
    setHiddenSymbols((prev) => prev.filter((symbol) => data.symbols.includes(symbol)));
  }, [symbolKey]);

  const visibleSymbols = useMemo(
    () => visibleSymbolsFromHidden(data.symbols, hiddenSymbols),
    [data.symbols, hiddenSymbols],
  );

  const chartData = useMemo(() => {
    if (mode === 'index100') return toIndex100ChartData(data);
    if (mode === 'cumulativeReturn') return toCumulativeReturnChartData(data);
    return toPriceChartData(data);
  }, [data, mode]);

  const modeMeta = MODE_META[mode];

  if (chartData.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-sm text-center py-12">無比較資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 flex-1 space-y-1">
              <h3 className="text-base font-bold text-[var(--color-text-primary)]">{modeMeta.title}</h3>
              <p className="text-xs text-[var(--color-text-muted)]">{modeMeta.description}</p>
            </div>
            <CompareChartModeTabs mode={mode} onModeChange={onModeChange} />
          </div>
        </div>

        <div className="p-4 h-[260px] sm:h-[340px] lg:h-[420px] min-h-0 min-w-0">
          <ChartResizeContainer
            className="h-full"
            role="img"
            aria-label={`${modeMeta.title}：${visibleSymbols.join('、') || '無股票'}`}
          >
            {(size) => (
            <ResponsiveContainer width={size.width} height={size.height}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 12, bottom: 16, left: 0 }}
              accessibilityLayer
            >
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: c.tick }}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={28}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 11, fill: c.tick }}
                tickLine={false}
                axisLine={false}
                width={74}
                tickFormatter={(v: number) => {
                  if (mode === 'cumulativeReturn') return `${v.toFixed(1)}%`;
                  if (mode === 'index100') return v.toFixed(1);
                  return v.toFixed(0);
                }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: '12px',
                  border: '1px solid var(--color-border)',
                  boxShadow: c.tooltipShadow,
                  fontSize: '12px',
                  backgroundColor: c.tooltipBg,
                  color: c.tooltipText,
                }}
                formatter={(value: unknown, name?: string | number) => {
                  if (typeof value !== 'number') return [String(value), String(name ?? '')];

                  if (mode === 'price') return [`${value.toFixed(2)} 元`, String(name ?? '')];
                  if (mode === 'index100') return [value.toFixed(2), `${String(name ?? '')}（指數）`];
                  return [`${value.toFixed(2)}%`, `${String(name ?? '')}（累積報酬）`];
                }}
              />
              {visibleSymbols.map((sym, i) => (
                <Line
                  key={sym}
                  type="monotone"
                  dataKey={sym}
                  stroke={symbolColors[sym] ?? fallbackColor(sym, i)}
                  strokeWidth={2.25}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
            )}
          </ChartResizeContainer>

          {visibleSymbols.length === 0 && (
            <p className="mt-2 text-xs text-[var(--color-brand-deep)] dark:text-brand">已隱藏全部股票，請用下方圖例重新開啟或按「重設」。</p>
          )}
        </div>

        <div className="px-5 pb-4 pt-1 border-t border-[var(--color-border)] space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHiddenSymbols([])}
              className="px-2.5 py-1 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand hover:text-brand cursor-pointer"
            >
              全顯示
            </button>
            <button
              type="button"
              onClick={() => setHiddenSymbols([...data.symbols])}
              className="px-2.5 py-1 text-xs rounded-full border border-[var(--color-border)] text-[var(--color-text-secondary)] hover:border-brand hover:text-brand cursor-pointer"
            >
              全隱藏
            </button>
            <span className="px-2.5 py-1 text-xs rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)]">
              已顯示 {visibleSymbols.length}/{data.symbols.length}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.symbols.map((sym, i) => {
              const color = symbolColors[sym] ?? fallbackColor(sym, i);
              const isHidden = hiddenSymbols.includes(sym);
              return (
                <button
                  key={`legend-${sym}`}
                  type="button"
                  onClick={() => setHiddenSymbols((prev) => toggleHiddenSymbol(prev, sym))}
                  aria-pressed={!isHidden}
                  className={`inline-flex items-center gap-2 px-2.5 py-1 rounded-full text-xs font-mono cursor-pointer transition-colors ${
                    isHidden
                      ? 'bg-[var(--color-bg-elevated)] opacity-60 text-[var(--color-text-muted)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-text-primary)]'
                  }`}
                >
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: color }}
                    aria-hidden
                  />
                  {sym}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-[var(--color-text-muted)]">
            圖例色彩與摘要卡、風險報酬散點一致；Y 軸口徑：{modeMeta.yAxisLabel}。點擊圖例可切換顯示。
          </p>
          {chartData.length > 0 ? (
            <div className="sr-only">
              <p>圖表資料摘要（最後一個交易日）</p>
              <table>
                <thead>
                  <tr>
                    <th scope="col">日期</th>
                    {data.symbols.map((sym) => (
                      <th key={`th-${sym}`} scope="col">
                        {sym}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{chartData[chartData.length - 1]?.date ?? '—'}</td>
                    {data.symbols.map((sym) => {
                      const v = chartData[chartData.length - 1]?.[sym];
                      return (
                        <td key={`td-${sym}`}>
                          {typeof v === 'number' ? v.toFixed(2) : '—'}
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
};
