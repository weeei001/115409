import React, { useId } from 'react';
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
  const uid = useId().replace(/:/g, '');
  const startId = `date-range-start-${uid}`;
  const endId = `date-range-end-${uid}`;
  const groupLabelId = `date-range-label-${uid}`;

  const handleStartChange = (val: string) => {
    onStartChange(val);
    if (endDate && val > endDate) onEndChange(val);
  };
  const handleEndChange = (val: string) => {
    onEndChange(val);
    if (startDate && val < startDate) onStartChange(val);
  };

  return (
    <div
      className={clsx('flex items-center gap-3 flex-wrap', className)}
      role="group"
      aria-labelledby={groupLabelId}
    >
      <Calendar size={16} className="text-brand shrink-0" aria-hidden />
      <span id={groupLabelId} className="sr-only">
        圖表日期區間
      </span>
      <label htmlFor={startId} className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)] shrink-0">開始日期</span>
        <input
          id={startId}
          type="date"
          value={startDate}
          onChange={(e) => handleStartChange(e.target.value)}
          className="w-full min-w-0 border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-secondary)]
                     focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                     bg-[var(--color-bg-elevated)] md:min-w-[10.5rem] md:w-auto"
        />
      </label>
      <label htmlFor={endId} className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-1.5">
        <span className="text-xs font-medium text-[var(--color-text-secondary)] shrink-0">結束日期</span>
        <input
          id={endId}
          type="date"
          value={endDate}
          onChange={(e) => handleEndChange(e.target.value)}
          className="w-full min-w-0 border border-[var(--color-border)] rounded-xl px-3 py-2 text-sm text-[var(--color-text-secondary)]
                     focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                     bg-[var(--color-bg-elevated)] md:min-w-[10.5rem] md:w-auto"
        />
      </label>
    </div>
  );
};
