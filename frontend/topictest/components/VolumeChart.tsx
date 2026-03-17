import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { VolumeAnalysisResponse } from '../lib/types';

interface Props {
  data: VolumeAnalysisResponse;
}

function fmtVol(val: number) {
  if (val >= 1e8) return `${(val / 1e8).toFixed(1)}億`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(0)}萬`;
  return val.toLocaleString();
}

export const VolumeChart: React.FC<Props> = ({ data }) => {
  const chartData = useMemo(
    () => data.data.map((d) => ({ ...d, isUp: d.change >= 0 })),
    [data.data]
  );

  if (chartData.length === 0) {
    return <div className="text-gray-400 text-sm text-center py-12">無成交量資料</div>;
  }

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 mb-4">成交量分析</h3>
      <div className="bg-white rounded-2xl border border-gray-100 p-4" style={{ height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
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
              tickFormatter={fmtVol}
            />
            <Tooltip
              contentStyle={{
                borderRadius: '12px',
                border: 'none',
                boxShadow: '0 4px 20px rgba(0,0,0,0.08)',
                fontSize: '12px',
              }}
              formatter={(value: unknown, name?: string | number) => {
                if (name === 'volume' && typeof value === 'number')
                  return [fmtVol(value), '成交量'];
                if (name === 'close' && typeof value === 'number')
                  return [value.toFixed(2), '收盤價'];
                return [String(value), String(name ?? '')];
              }}
            />
            <Bar dataKey="volume" radius={[2, 2, 0, 0]} isAnimationActive={false}>
              {chartData.map((entry, idx) => (
                <Cell
                  key={idx}
                  fill={entry.isUp ? 'rgba(239,68,68,0.7)' : 'rgba(34,197,94,0.7)'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </motion.section>
  );
};
