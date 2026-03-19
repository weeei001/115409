import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { CompareChartMode, MultiStockResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';
import {
  toCumulativeReturnChartData,
  toIndex100ChartData,
  toPriceChartData,
} from '../lib/utils/compare';

interface Props {
  data: MultiStockResponse;
  mode?: CompareChartMode;
}

const COLORS = [
  '#ffa95a', '#3b82f6', '#ef4444', '#22c55e', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#f59e0b', '#6366f1',
];

export const ComparisonChart: React.FC<Props> = ({ data, mode = 'price' }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const chartData = useMemo(() => {
    if (mode === 'index100') return toIndex100ChartData(data);
    if (mode === 'cumulativeReturn') return toCumulativeReturnChartData(data);
    return toPriceChartData(data);
  }, [data, mode]);

  const title = mode === 'price'
    ? '多股價格比較'
    : mode === 'index100'
      ? '多股 Index=100 比較'
      : '多股累積報酬比較';

  if (chartData.length === 0) {
    return <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">無比較資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">{title}</h3>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 h-[240px] sm:h-[320px] lg:h-[420px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#aaa' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#aaa' }}
              tickLine={false}
              axisLine={false}
              width={60}
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
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                fontSize: '12px',
                backgroundColor: isDark ? '#1f2937' : '#fff',
                color: isDark ? '#f3f4f6' : '#111',
              }}
              formatter={(value: unknown, name?: string | number) => {
                if (typeof value === 'number') {
                  if (mode === 'cumulativeReturn') return [`${value.toFixed(2)}%`, String(name ?? '')];
                  return [value.toFixed(2), String(name ?? '')];
                }
                return [String(value), String(name ?? '')];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '8px', color: isDark ? '#d1d5db' : undefined }}
            />
            {data.symbols.map((sym, i) => (
              <Line
                key={sym}
                type="monotone"
                dataKey={sym}
                stroke={COLORS[i % COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
};
