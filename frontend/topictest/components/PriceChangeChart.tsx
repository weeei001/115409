import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from 'recharts';
import type { PriceChangeResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';

interface Props {
  data: PriceChangeResponse;
}

export const PriceChangeChart: React.FC<Props> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);

  const tickColor = c.tickMuted;
  const tooltipBg = c.tooltipBg;
  const tooltipText = c.tooltipText;
  const refLineColor = c.gridSubtle;

  const chartData = useMemo(
    () =>
      data.data.map((d) => ({
        ...d,
        isUp: d.change_percent >= 0,
      })),
    [data.data]
  );

  if (chartData.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-sm text-center py-12">無漲跌幅資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.35 }}
    >
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4">漲跌幅分析</h3>
      <div className="bento-cell p-4 h-[200px] sm:h-[240px] lg:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke={c.gridSubtle}
            />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: tickColor }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
            />
            <YAxis
              yAxisId="pct"
              tick={{ fontSize: 10, fill: tickColor }}
              tickLine={false}
              axisLine={false}
              width={50}
              tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            />
            <YAxis
              yAxisId="price"
              orientation="right"
              tick={{ fontSize: 10, fill: tickColor }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
            <ReferenceLine yAxisId="pct" y={0} stroke={refLineColor} strokeDasharray="4 4" />
            <Tooltip
              cursor={{ stroke: 'var(--color-brand)', strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                borderRadius: '12px',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-elevated)',
                fontSize: '12px',
                backgroundColor: tooltipBg,
                color: tooltipText,
                backdropFilter: 'blur(12px)',
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
              radius={[3, 3, 0, 0]}
              isAnimationActive={false}
            >
              {chartData.map((entry, idx) => (
                <Cell
                  key={`${entry.date}-${idx}`}
                  fill={entry.isUp ? c.priceBarUp : c.priceBarDown}
                />
              ))}
            </Bar>
            <Line
              yAxisId="price"
              type="monotone"
              dataKey="close"
              stroke={c.brand}
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
