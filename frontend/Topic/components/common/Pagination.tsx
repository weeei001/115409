import { useId } from 'react';
import { Button } from '@/components/ui/button';
import { inputClass } from '@/components/ui/input';
import { cn } from '@/lib/cn';

interface PaginationProps {
  /** 目前頁（從 1 起算） */
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  /** nav 的無障礙名稱，例如「歷史股價分頁」 */
  label: string;
  disabled?: boolean;
  /** 左側的燈質列（例如「1–20，共 63 筆」）；不給就寫「第 n / N 頁」 */
  summary?: React.ReactNode;
  /** 左側改成直接跳頁的輸入框（頁數多的新聞列表） */
  jump?: boolean;
  className?: string;
}

/** 分頁器：左邊是位置（或跳頁），右邊是上一頁／下一頁兩顆外框鈕；超出範圍的頁碼落在第一頁或最後一頁 */
export function Pagination({ page, totalPages, onPageChange, label, disabled = false, summary, jump = false, className }: PaginationProps) {
  const inputId = useId();
  const go = (target: number) => {
    const next = Math.min(Math.max(1, Math.trunc(target)), Math.max(1, totalPages));
    if (next !== page) onPageChange(next);
  };
  return (
    <nav aria-label={label} className={cn('flex flex-wrap items-center justify-between gap-x-3 gap-y-2', className)}>
      {jump ? (
        <form
          key={page}
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(new FormData(event.currentTarget).get('page'));
            if (Number.isFinite(value)) go(value);
          }}
          className="flex items-center gap-2"
        >
          <label htmlFor={inputId} className="characteristic">第</label>
          <input
            id={inputId}
            name="page"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            defaultValue={page}
            aria-label={`頁碼，共 ${totalPages.toLocaleString()} 頁`}
            className={cn(inputClass, 'w-20 px-2 text-center font-mono tabular-nums')}
          />
          <span className="characteristic">/ {totalPages.toLocaleString()} 頁</span>
          <Button type="submit" variant="outline" size="sm" disabled={disabled}>前往</Button>
        </form>
      ) : (
        <span className="characteristic">{summary ?? `第 ${page} / ${totalPages} 頁`}</span>
      )}
      <div className="flex gap-2">
        <Button variant="outline" disabled={disabled || page <= 1} onClick={() => go(page - 1)} className="min-w-[4.5rem]">
          上一頁
        </Button>
        <Button variant="outline" disabled={disabled || page >= totalPages} onClick={() => go(page + 1)} className="min-w-[4.5rem]">
          下一頁
        </Button>
      </div>
    </nav>
  );
}
