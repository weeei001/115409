import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine
} from 'recharts';
import type { PriceChangeResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  data: PriceChangeResponse;
}

export const PriceChangeChart: React.FC<Props> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const chartData = useMemo(
    () =>
      data.data.map((d) => ({
        ...d,
        isUp: d.change_percent >= 0,
      })),
    [data.data]
  );

  if (chartData.length === 0) {
    return <div className="text-gray-400 dark:text-gray-500 text-sm text-center py-12">無漲跌幅資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4">漲跌幅分析</h3>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4" style={{ height: 280 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#aaa' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
            />
            <YAxis
              yAxisId="pct"
              tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#aaa' }}
              tickLine={false}
              axisLine={false}
              width={50}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tick={{ fontSize: 10, fill: isDark ? '#6b7280' : '#aaa' }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ReferenceLine yAxisId="pct" y={0} stroke={isDark ? '#374151' : '#e5e7eb'} strokeDasharray="3 3" />
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
                if (name === 'change_percent' && typeof value === 'number')
                  return [`${value.toFixed(2)}%`, '漲跌幅'];
                if (name === 'close' && typeof value === 'number')
                  return [value.toFixed(2), '收盤價'];
                return [String(value), String(name ?? '')];
              }}
            />
            <Bar
              yAxisId="pct"
              dataKey="change_percent"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={`${entry.date}-${idx}`}
                  fill={entry.isUp ? 'rgba(239,68,68,0.6)' : 'rgba(34,197,94,0.6)'}
                />
              ))}
            </Bar>
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke="#ffa95a"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
};
