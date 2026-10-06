import { useId } from 'react';
import { Calendar } from 'lucide-react';
import { cn } from '@/lib/cn';
import { inputClass } from '@/components/ui/input';

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

const dateInputClass = cn(inputClass, 'font-mono tabular-nums md:w-[10.5rem]');

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
      <Calendar size={16} className="hidden shrink-0 text-muted-foreground sm:block" aria-hidden />
      <span id={labelId} className="sr-only">
        圖表日期區間
      </span>
      {/* 手機一格一列：16px 等寬字的日期加日曆鈕約要 140px，375 寬並排只剩約 135px，最後一碼會被蓋住 */}
      <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-xs font-medium text-subtle">{startLabel}</span>
        <input type="date" value={startDate} onChange={(e) => handleStart(e.target.value)} className={dateInputClass} />
      </label>
      <label className="flex w-full min-w-0 flex-col gap-1 sm:w-auto sm:flex-1 sm:flex-row sm:items-center sm:gap-2">
        <span className="shrink-0 text-xs font-medium text-subtle">{endLabel}</span>
        <input type="date" value={endDate} onChange={(e) => handleEnd(e.target.value)} className={dateInputClass} />
      </label>
    </div>
  );
}
