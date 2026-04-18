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
} from 'recharts';
import type { CandlestickWithMAResponse } from '../lib/types';
import { useTheme } from '../lib/ThemeContext';
import { CHART_DOWN, CHART_UP, getChartPalette, MA_LINE_COLORS } from '../lib/chartTheme';

interface Props {
  data: CandlestickWithMAResponse;
}

interface ChartRow {
  date: string;
  open: number;
  close: number;
  high: number;
  low: number;
  body: [number, number];
  upperWick: [number, number];
  lowerWick: [number, number];
  isUp: boolean;
  [key: string]: unknown;
}

const CandlestickShape = (props: Record<string, unknown>) => {
  const { x, y, width, height, payload } = props as {
    x: number;
    y: number;
    width: number;
    height: number;
    payload: ChartRow;
  };
  if (!payload?.body || !Array.isArray(payload.body) || payload.body.length < 2) return null;

  const color = payload.isUp ? CHART_UP : CHART_DOWN;
  const wickX = x + width / 2;
  const bodyY = y;
  const bodyH = Math.max(Math.abs(height), 1);

  const yScale = (val: number) => {
    const body = payload.body;
    const bodyTop = Math.max(body[0], body[1]);
    if (bodyH === 0) return bodyY;
    const ratio = (bodyTop - val) / (bodyTop - Math.min(body[0], body[1]) || 1);
    return bodyY + ratio * bodyH;
  };

  const highY = yScale(payload.high);
  const lowY = yScale(payload.low);

  return (
    <g>
      <line x1={wickX} y1={highY} x2={wickX} y2={bodyY} stroke={color} strokeWidth={1} />
      <line x1={wickX} y1={bodyY + bodyH} x2={wickX} y2={lowY} stroke={color} strokeWidth={1} />
      <rect x={x} y={bodyY} width={width} height={bodyH} fill={color} stroke={color} strokeWidth={1} />
    </g>
  );
};

export const CandlestickChart: React.FC<Props> = ({ data }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const c = getChartPalette(isDark);
  const maKeys = useMemo(() => Object.keys(data.moving_averages), [data.moving_averages]);

  const tickColor = c.tickMuted;
  const tooltipBg = c.tooltipBg;
  const tooltipText = c.tooltipText;

  const chartData: ChartRow[] = useMemo(() => {
    return data.candlestick.map((rowData, i) => {
      const isUp = rowData.close >= rowData.open;
      const row: ChartRow = {
        date: rowData.date,
        open: rowData.open,
        close: rowData.close,
        high: rowData.high,
        low: rowData.low,
        body: isUp ? [rowData.open, rowData.close] : [rowData.close, rowData.open],
        upperWick: [Math.max(rowData.open, rowData.close), rowData.high],
        lowerWick: [rowData.low, Math.min(rowData.open, rowData.close)],
        isUp,
      };
      maKeys.forEach((key) => {
        const vals = data.moving_averages[key];
        row[key] = vals?.[i] ?? null;
      });
      return row;
    });
  }, [data, maKeys]);

  const [minPrice, maxPrice] = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    chartData.forEach((d) => {
      if (d.low < lo) lo = d.low;
      if (d.high > hi) hi = d.high;
    });
    const pad = (hi - lo) * 0.05;
    return [Math.floor(lo - pad), Math.ceil(hi + pad)];
  }, [chartData]);

  if (chartData.length === 0) {
    return <div className="text-[var(--color-text-muted)] text-sm text-center py-12">無 K 線資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <h3 className="text-sm font-semibold text-[var(--color-text-secondary)] mb-2 flex items-center gap-2">
        K 線圖 + 移動平均線
      </h3>
      <div className="flex flex-wrap gap-4 mb-3">
        {maKeys.map((key) => (
          <span key={key} className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
            <span className="inline-block w-3 h-0.5 rounded" style={{ background: MA_LINE_COLORS[key] ?? c.tick }} />
            {key}
          </span>
        ))}
      </div>
      <div className="bento-cell p-4 h-[240px] sm:h-[320px] lg:h-[420px]">
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
              domain={[minPrice, maxPrice]}
              tick={{ fontSize: 10, fill: tickColor }}
              tickLine={false}
              axisLine={false}
              width={60}
              tickFormatter={(v: number) => v.toFixed(0)}
            />
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
              labelStyle={{ fontWeight: 600, marginBottom: 4 }}
              formatter={(value: unknown, name?: string | number) => {
                if (name === 'body') return null;
                if (typeof value === 'number') return [value.toFixed(2), String(name ?? '')];
                return [String(value), String(name ?? '')];
              }}
            />
            <Bar
              dataKey="body"
              shape={<CandlestickShape />}
              barSize={Math.max(Math.min(600 / chartData.length - 2, 12), 3)}
              isAnimationActive={false}
            >
              {chartData.map((entry, idx) => (
                <Cell key={`${entry.date}-${idx}`} fill={entry.isUp ? CHART_UP : CHART_DOWN} />
              ))}
            </Bar>
            {maKeys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={MA_LINE_COLORS[key] ?? c.tick}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
};
