import React from 'react';
import { motion } from 'motion/react';
import {
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompareMetricsRow } from '../lib/types';
import { COMPARE_COLOR_PALETTE } from '../lib/utils/compare';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';

interface Props {
  rows: CompareMetricsRow[];
  symbolColors?: Record<string, string>;
}

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

export const RiskReturnScatter: React.FC<Props> = ({ rows, symbolColors = {} }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);
  const data = rows
    .filter((r) => r.volatilityPct != null && r.totalReturnPct != null)
    .map((r) => ({
      symbol: r.symbol,
      x: r.volatilityPct as number,
      y: r.totalReturnPct as number,
      color: symbolColors[r.symbol] ?? fallbackColor(r.symbol),
    }));

  if (data.length === 0) return null;

  const avgX = data.reduce((sum, item) => sum + item.x, 0) / data.length;
  const avgY = data.reduce((sum, item) => sum + item.y, 0) / data.length;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-1">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">風險-報酬分佈</h3>
          <p className="text-xs text-[var(--color-text-muted)]">
            X 軸為波動度、Y 軸為區間報酬；右上角代表高報酬且高波動。
          </p>
        </div>
        <div className="p-4" style={{ height: 320 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 16, right: 24, bottom: 16, left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
              <ReferenceLine
                x={avgX}
                stroke={c.referenceLine}
                strokeDasharray="4 4"
                strokeOpacity={0.85}
              />
              <ReferenceLine
                y={avgY}
                stroke={c.referenceLine}
                strokeDasharray="4 4"
                strokeOpacity={0.85}
              />
              <XAxis
                type="number"
                dataKey="x"
                name="波動度"
                unit="%"
                tick={{ fontSize: 11, fill: c.tick }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="區間報酬"
                unit="%"
                tick={{ fontSize: 11, fill: c.tick }}
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
                cursor={{ strokeDasharray: '3 3' }}
                formatter={(value: unknown, name?: string | number) =>
                  typeof value === 'number'
                    ? [`${value.toFixed(2)}%`, name === 'x' ? '波動度' : '區間報酬']
                    : [String(value), String(name ?? '')]
                }
                labelFormatter={(_, payload) => payload?.[0]?.payload?.symbol ?? ''}
              />
              <Scatter data={data}>
                {data.map((entry) => (
                  <Cell key={`cell-${entry.symbol}`} fill={entry.color} />
                ))}
                <LabelList dataKey="symbol" position="top" fontSize={11} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>
    </motion.section>
  );
};
