import React from 'react';
import { clsx } from 'clsx';

const PRESETS = [5, 10, 20, 60] as const;

interface Props {
  value: string;
  onChange: (maPeriods: string) => void;
  disabled?: boolean;
}

function parsePeriods(value: string): Set<number> {
  return new Set(
    value
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
  );
}

export const MaPeriodSelector: React.FC<Props> = ({ value, onChange, disabled }) => {
  const selected = parsePeriods(value);

  const toggle = (period: number) => {
    const next = new Set(selected);
    if (next.has(period)) {
      if (next.size <= 1) return;
      next.delete(period);
    } else {
      next.add(period);
    }
    const sorted = [...next].sort((a, b) => a - b);
    onChange(sorted.join(','));
  };

  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="移動平均週期">
      <span className="text-xs text-[var(--color-text-muted)] shrink-0">MA</span>
      {PRESETS.map((p) => {
        const on = selected.has(p);
        return (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => toggle(p)}
            className={clsx(
              'min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50',
              on
                ? 'border-brand/50 bg-brand/10 text-brand-deep dark:text-brand-light'
                : 'border-[var(--color-border)] bg-[var(--color-bg-elevated)] text-[var(--color-text-secondary)] hover:border-brand/30',
              disabled && 'opacity-50 cursor-not-allowed'
            )}
          >
            MA{p}
          </button>
        );
      })}
    </div>
  );
};
