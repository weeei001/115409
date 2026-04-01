import React from 'react';
import { motion } from 'motion/react';
import {
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareMetricsRow } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  rows: CompareMetricsRow[];
}

export const RiskReturnScatter: React.FC<Props> = ({ rows }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const data = rows
    .filter((r) => r.volatilityPct != null && r.totalReturnPct != null)
    .map((r) => ({
      symbol: r.symbol,
      x: r.volatilityPct as number,
      y: r.totalReturnPct as number,
    }));

  if (data.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/80">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">風險-報酬分佈</h3>
        </div>
        <div className="p-4" style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#374151' : '#e5e7eb'} />
            <XAxis
              type="number"
              dataKey="x"
              name="波動度"
              unit="%"
              tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }}
            />
            <YAxis
              type="number"
              dataKey="y"
              name="報酬"
              unit="%"
              tick={{ fontSize: 11, fill: isDark ? '#9ca3af' : '#6b7280' }}
            />
            <Tooltip
              cursor={{ strokeDasharray: '3 3' }}
              formatter={(value: unknown, name?: string | number) =>
                typeof value === 'number'
                  ? [`${value.toFixed(2)}%`, name === 'x' ? '波動度' : '區間報酬']
                  : [String(value), String(name ?? '')]
              }
              labelFormatter={(_, payload) => payload?.[0]?.payload?.symbol ?? ''}
            />
            <Scatter data={data} fill="#ffa95a">
              <LabelList dataKey="symbol" position="top" fontSize={11} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
        </div>
      </div>
    </motion.section>
  );
};
