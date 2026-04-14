import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { VolumeAnalysisResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';
import { fmtVolumeShort } from '../lib/utils/format';

interface Props {
  data: VolumeAnalysisResponse;
}

export const VolumeChart: React.FC<Props> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);

  const tickColor = c.tickMuted;
  const tooltipBg = c.tooltipBg;
  const tooltipText = c.tooltipText;

  const chartData = useMemo(
    () => data.data.map((d) => ({ ...d, isUp: d.change >= 0 })),
    [data.data]
  );

  if (chartData.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-sm text-center py-12">無成交量資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-4">成交量分析</h3>
      <div className="bento-cell p-4 h-[200px] sm:h-[240px] lg:h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
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
              tick={{ fontSize: 10, fill: tickColor }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={fmtVolumeShort}
            />
            <Tooltip
              cursor={{ fill: isDark ? 'rgba(212,165,116,0.06)' : 'rgba(212,165,116,0.08)' }}
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
                if (name === 'volume' && typeof value === 'number')
                  return [fmtVolumeShort(value), '成交量'];
                if (name === 'close' && typeof value === 'number')
                  return [value.toFixed(2), '收盤價'];
                return [String(value), String(name ?? '')];
              }}
            />
            <Bar dataKey="volume" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, idx) => (
                <Cell
                  key={`${entry.date}-${idx}`}
                  fill={entry.isUp ? c.volumeUp : c.volumeDown}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
};
