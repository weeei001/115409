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
import type { MultiStockResponse } from '../lib/types';

interface Props {
  data: MultiStockResponse;
}

const COLORS = [
  '#ffa95a', '#3b82f6', '#ef4444', '#22c55e', '#8b5cf6',
  '#06b6d4', '#f43f5e', '#84cc16', '#f59e0b', '#6366f1',
];

export const ComparisonChart: React.FC<Props> = ({ data }) => {
  const chartData = useMemo(
    () =>
      data.data.map((d) => ({
        date: d.date,
        ...d.prices,
      })),
    [data.data]
  );

  if (chartData.length === 0) {
    return <div className="text-gray-400 text-sm text-center py-12">無比較資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 mb-4">多股價格比較</h3>
      <div className="bg-white rounded-2xl border border-gray-100 p-4" style={{ height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#aaa' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#aaa' }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <Tooltip
              contentStyle={{
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                fontSize: '12px',
              }}
              formatter={(value: unknown, name?: string | number) => {
                if (typeof value === 'number') return [value.toFixed(2), String(name ?? '')];
                return [String(value), String(name ?? '')];
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: '12px', paddingTop: '8px' }}
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
