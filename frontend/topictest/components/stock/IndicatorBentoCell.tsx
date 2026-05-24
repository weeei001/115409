import React from 'react';
import { clsx } from 'clsx';
import type { EChartsOption } from 'echarts';
import { EChartPanel } from '../charts/EChartPanel';
import { IndicatorChartEmptyState } from './IndicatorChartEmptyState';

type Tone = 'up' | 'down' | 'neutral';

interface Props {
  title: string;
  option: EChartsOption | null;
  hasData: boolean;
  height?: number;
  latestLabel?: string;
  latestValue?: string;
  latestTone?: Tone;
  onRetry?: () => void;
  onWidenRange?: () => void;
}

function toneClass(tone: Tone): string {
  if (tone === 'up') return 'bg-up-muted text-up-emphasis border-up/30';
  if (tone === 'down') return 'bg-down-muted text-down-emphasis border-down/30';
  return 'bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] border-[var(--color-border)]';
}

export const IndicatorBentoCell: React.FC<Props> = ({
  title,
  option,
  hasData,
  height = 220,
  latestLabel,
  latestValue,
  latestTone = 'neutral',
  onRetry,
  onWidenRange,
}) => {
  if (!hasData || !option) {
    return <IndicatorChartEmptyState title={title} onRetry={onRetry} onWidenRange={onWidenRange} />;
  }
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 sm:p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        {latestValue ? (
          <span
            className={clsx(
              'inline-flex items-baseline gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium tabular-nums',
              toneClass(latestTone),
            )}
          >
            {latestLabel ? <span className="text-[10px] opacity-80">{latestLabel}</span> : null}
            <span className="font-mono font-semibold">{latestValue}</span>
          </span>
        ) : null}
      </div>
      <EChartPanel title={title} option={option} height={height} bare />
    </div>
  );
};
