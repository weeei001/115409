import React from 'react';
import { RefreshCw } from 'lucide-react';
import { TableScrollHint } from '@/components/common/CollapsibleSection';
import { Notice } from '@/components/common/Notice';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/* 個股頁抽屜裡的明細表共用樣式（和籌碼明細、歷史股價同一套：列高 44px、表頭粗線、數字等寬） */
export const th = 'h-11 px-3 py-2.5 text-right font-medium whitespace-nowrap';
export const thLeft = 'h-11 px-3 py-2.5 text-left font-medium whitespace-nowrap';
export const td = 'h-11 px-3 py-2 text-right font-mono text-[13.5px] whitespace-nowrap tabular-nums';
export const tdLeft = 'h-11 px-3 py-2 text-left font-mono text-[13.5px] whitespace-nowrap tabular-nums';
export const headRow = 'border-b border-border-strong bg-muted text-xs text-muted-foreground';

export function TableFrame({ minWidth, caption, children }: { minWidth: string; caption: string; children: React.ReactNode }) {
  return (
    <>
      <TableScrollHint />
      <div className="overflow-x-auto overscroll-x-contain border">
        <table className={cn('w-full text-sm', minWidth)}>
          <caption className="sr-only">{caption}</caption>
          {children}
        </table>
      </div>
    </>
  );
}

/** 這一塊的資料請求失敗：錯誤＋重試，不寫成「沒有資料」 */
export function RetryNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Notice
      tone="danger"
      action={
        <Button size="sm" variant="outline" onClick={onRetry} className="min-h-11">
          <RefreshCw aria-hidden />
          重試
        </Button>
      }
    >
      {message}
    </Notice>
  );
}

/** 分頁的說明列：左邊說明與資料期間，右邊放匯出鈕 */
export function TabCaption({ children, span, actions }: { children: React.ReactNode; span?: string | null; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
      <p className="min-w-0 flex-1 basis-64 text-[13px] leading-relaxed text-muted-foreground">
        {children}
        {span ? <span className="characteristic mt-0.5 block">{span}</span> : null}
      </p>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

/** 表格下方的口徑說明 */
export function TableNote({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}
