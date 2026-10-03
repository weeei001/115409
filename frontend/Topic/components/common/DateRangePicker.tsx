import React, { useId } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  startDate: string;
  endDate: string;
  onStartChange: (val: string) => void;
  onEndChange: (val: string) => void;
  /** 欄位標籤；查詢用的日期（不一定是有資料的日期）可改成「查詢到」 */
  startLabel?: string;
  endLabel?: string;
  className?: string;
}

const inputClass =
  'h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3 font-mono text-sm tabular-nums text-foreground transition-colors duration-(--dur-flash) hover:border-border-strong md:w-[10.5rem]';

/** 開始／結束日期；兩者交叉時自動把另一端對齊 */
export function DateRangePicker({ startDate, endDate, onStartChange, onEndChange, startLabel = '開始日期', endLabel = '結束日期', className }: Props) {
  const uid = useId().replace(/:/g, '');
  const labelId = `date-range-${uid}`;

  const handleStart = (val: string) => {
    onStartChange(val);
    if (endDate && val > endDate) onEndChange(val);
  };
  const handleEnd = (val: string) => {
    onEndChange(val);
    if (startDate && val < startDate) onStartChange(val);
  };

  return (
    <div role="group" aria-labelledby={labelId} className={cn('flex flex-wrap items-center gap-3', className)}>
      <Calendar size={16} className="shrink-0 text-muted-foreground" aria-hidden />
      <span id={labelId} className="sr-only">
        圖表日期區間
      </span>
      <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-xs font-medium text-subtle">{startLabel}</span>
        <input type="date" value={startDate} onChange={(e) => handleStart(e.target.value)} className={inputClass} />
      </label>
      <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-xs font-medium text-subtle">{endLabel}</span>
        <input type="date" value={endDate} onChange={(e) => handleEnd(e.target.value)} className={inputClass} />
      </label>
    </div>
  );
}
