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
} from 'recharts';
import type { CandlestickWithMAResponse } from '../lib/types';

interface Props {
  data: CandlestickWithMAResponse;
}

const MA_COLORS: Record<string, string> = {
  MA5: '#f59e0b',
  MA10: '#3b82f6',
  MA20: '#8b5cf6',
  MA60: '#10b981',
  MA120: '#ef4444',
};

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
  if (!payload) return null;

  const color = payload.isUp ? '#ef4444' : '#22c55e';
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
      <rect
        x={x}
        y={bodyY}
        width={width}
        height={bodyH}
        fill={payload.isUp ? color : color}
        stroke={color}
        strokeWidth={1}
      />
    </g>
  );
};

export const CandlestickChart: React.FC<Props> = ({ data }) => {
  const maKeys = useMemo(() => Object.keys(data.moving_averages), [data.moving_averages]);

  const chartData: ChartRow[] = useMemo(() => {
    return data.candlestick.map((c, i) => {
      const isUp = c.close >= c.open;
      const row: ChartRow = {
        date: c.date,
        open: c.open,
        close: c.close,
        high: c.high,
        low: c.low,
        body: isUp ? [c.open, c.close] : [c.close, c.open],
        upperWick: [Math.max(c.open, c.close), c.high],
        lowerWick: [c.low, Math.min(c.open, c.close)],
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
    return <div className="text-gray-400 text-sm text-center py-12">無 K 線資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.2 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 mb-2 flex items-center gap-2">
        K 線圖 + 移動平均線
      </h3>
      <div className="flex flex-wrap gap-4 mb-3">
        {maKeys.map((key) => (
          <span key={key} className="flex items-center gap-1 text-xs text-gray-500">
            <span
              className="inline-block w-3 h-0.5 rounded"
              style={{ background: MA_COLORS[key] || '#888' }}
            />
            {key}
          </span>
        ))}
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-4" style={{ height: 420 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 10, fill: '#aaa' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(Math.floor(chartData.length / 8), 1)}
            />
            <YAxis
              domain={[minPrice, maxPrice]}
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
                <Cell key={idx} fill={entry.isUp ? '#ef4444' : '#22c55e'} />
              ))}
            </Bar>
            {maKeys.map((key) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={MA_COLORS[key] || '#888'}
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
