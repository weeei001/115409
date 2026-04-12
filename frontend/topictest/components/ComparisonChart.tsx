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
import {
  COMPARE_COLOR_PALETTE,
  toCumulativeReturnChartData,
  toIndex100ChartData,
  toPriceChartData,
  toggleHiddenSymbol,
  visibleSymbolsFromHidden,
} from '../lib/utils/compare';

interface Props {
  data: MultiStockResponse;
  mode?: CompareChartMode;
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
    title: '多股 Index=100 比較',
    description: '以區間首日收盤價設為 100，對齊不同價位股票的相對走勢。',
    yAxisLabel: 'Index（首日=100）',
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

export const ComparisonChart: React.FC<Props> = ({ data, mode = 'price', symbolColors = {} }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
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
    return <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">無比較資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700/80 space-y-1">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{modeMeta.title}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{modeMeta.description}</p>
        </div>

        <div className="p-4 h-[260px] sm:h-[340px] lg:h-[420px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 16, right: 16, bottom: 12, left: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#334155' : '#e5e7eb'} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }}
                tickLine={false}
                axisLine={false}
                interval={Math.max(Math.floor(chartData.length / 8), 1)}
              />
              <YAxis
                tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }}
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
                  border: 'none',
                  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.15)',
                  fontSize: '12px',
                  backgroundColor: isDark ? '#0f172a' : '#fff',
                  color: isDark ? '#f8fafc' : '#111827',
                }}
                formatter={(value: unknown, name?: string | number) => {
                  if (typeof value !== 'number') return [String(value), String(name ?? '')];

                  if (mode === 'price') return [`${value.toFixed(2)} 元`, String(name ?? '')];
                  if (mode === 'index100') return [value.toFixed(2), `${String(name ?? '')}（Index）`];
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

          {visibleSymbols.length === 0 && (
            <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">已隱藏全部股票，請用下方圖例重新開啟或按「重設」。</p>
          )}
        </div>

        <div className="px-5 pb-4 pt-1 border-t border-gray-100 dark:border-gray-700/80 space-y-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setHiddenSymbols([])}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#ffa95a] hover:text-[#ea580c] cursor-pointer"
            >
              全顯示
            </button>
            <button
              type="button"
              onClick={() => setHiddenSymbols([...data.symbols])}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#ffa95a] hover:text-[#ea580c] cursor-pointer"
            >
              全隱藏
            </button>
            <button
              type="button"
              onClick={() => setHiddenSymbols([])}
              className="px-2.5 py-1 text-xs rounded-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-[#ffa95a] hover:text-[#ea580c] cursor-pointer"
            >
              重設
            </button>
            <span className="px-2.5 py-1 text-xs rounded-full bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300">
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
                      ? 'bg-gray-100 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500'
                      : 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200'
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
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            圖例色彩與摘要卡、風險報酬散點一致；Y 軸口徑：{modeMeta.yAxisLabel}。點擊圖例可切換顯示。
          </p>
        </div>
      </div>
    </motion.section>
  );
};

