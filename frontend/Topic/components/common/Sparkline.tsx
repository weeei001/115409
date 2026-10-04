import { useMemo } from 'react';
import { cn } from '@/lib/cn';

export type SparklineTrend = 'up' | 'down' | 'flat';

const STROKE: Record<SparklineTrend, string> = {
  up: 'stroke-up',
  down: 'stroke-down',
  flat: 'stroke-muted-foreground',
};

/** 純 SVG 迷你走勢線（取代舊版的 recharts） */
export function Sparkline({ values, trend = 'flat', className }: { values: number[]; trend?: SparklineTrend; className?: string }) {
  const points = useMemo(() => {
    if (values.length < 2) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => `${((i / (values.length - 1)) * 100).toFixed(2)},${(36 - ((v - min) / span) * 32).toFixed(2)}`)
      .join(' ');
  }, [values]);
  if (!points) return null;
  return (
    <svg viewBox="0 0 100 40" preserveAspectRatio="none" className={cn('h-10 w-full overflow-visible', className)} aria-hidden>
      <polyline
        points={points}
        fill="none"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
        className={STROKE[trend]}
      />
    </svg>
  );
}
