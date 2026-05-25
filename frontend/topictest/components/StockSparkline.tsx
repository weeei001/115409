import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Line, LineChart, YAxis } from 'recharts';
import { useTheme } from '../lib/ThemeContext';
import { getChartPalette } from '../lib/chartTheme';

export type SparklineTrend = 'up' | 'down' | 'flat';

interface Props {
  values: number[];
  trend?: SparklineTrend;
  className?: string;
}

const SPARKLINE_HEIGHT = 40;

export const StockSparkline: React.FC<Props> = ({ values, trend = 'flat', className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { theme } = useTheme();
  const palette = getChartPalette(theme === 'dark');

  const stroke =
    trend === 'up' ? palette.up : trend === 'down' ? palette.down : palette.tickMuted;

  const data = useMemo(
    () => values.map((value, index) => ({ index, value })),
    [values],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const update = () => {
      const next = Math.floor(el.getBoundingClientRect().width);
      if (next > 0) setWidth(next);
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const padding = max === min ? 1 : (max - min) * 0.08;

  return (
    <div
      ref={containerRef}
      className={`h-10 min-h-10 min-w-0 w-full ${className}`}
      aria-hidden
    >
      {width > 0 ? (
        <LineChart
          width={width}
          height={SPARKLINE_HEIGHT}
          data={data}
          margin={{ top: 2, right: 0, left: 0, bottom: 2 }}
        >
          <YAxis domain={[min - padding, max + padding]} hide />
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      ) : null}
    </div>
  );
};
