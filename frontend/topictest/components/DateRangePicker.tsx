import React from 'react';
import { Calendar } from 'lucide-react';
import { clsx } from 'clsx';

interface Props {
  startDate: string;
  endDate: string;
  onStartChange: (val: string) => void;
  onEndChange: (val: string) => void;
  className?: string;
}

export const DateRangePicker: React.FC<Props> = ({
  startDate,
  endDate,
  onStartChange,
  onEndChange,
  className,
}) => {
  const handleStartChange = (val: string) => {
    onStartChange(val);
    if (endDate && val > endDate) onEndChange(val);
  };
  const handleEndChange = (val: string) => {
    onEndChange(val);
    if (startDate && val < startDate) onStartChange(val);
  };

  return (
    <div className={clsx('flex items-center gap-3 flex-wrap', className)}>
      <Calendar size={16} className="text-brand shrink-0" />
      <label className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">自</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => handleStartChange(e.target.value)}
          className="border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-secondary)]
                     focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                     bg-[var(--color-bg-elevated)] min-w-[10.5rem]"
        />
      </label>
      <label className="flex items-center gap-1.5">
        <span className="text-xs font-medium text-[var(--color-text-muted)]">至</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => handleEndChange(e.target.value)}
          className="border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-secondary)]
                     focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                     bg-[var(--color-bg-elevated)] min-w-[10.5rem]"
        />
      </label>
    </div>
  );
};
