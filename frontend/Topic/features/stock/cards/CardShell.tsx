import React from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  icon: LucideIcon;
  title: string;
  rightSlot?: React.ReactNode;
  loading?: boolean;
  loadingRows?: number;
  isEmpty?: boolean;
  emptyText?: string;
  action?: { label: string; onClick: () => void };
  children?: React.ReactNode;
  className?: string;
}

/** 個股頁小卡的共用外框：標題列、骨架、空狀態、底部「詳細」按鈕 */
export function CardShell({
  icon: Icon,
  title,
  rightSlot,
  loading,
  loadingRows = 3,
  isEmpty,
  emptyText = '尚無資料',
  action,
  children,
  className,
}: Props) {
  return (
    <section data-stagger className={cn('flex h-full min-h-[260px] flex-col gap-3 rounded-xl border bg-card p-4 shadow-card sm:p-5', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <Icon size={16} className="text-brand" aria-hidden />
          {title}
        </h3>
        {rightSlot}
      </div>
      {loading ? (
        <div className="flex-1 space-y-2" aria-hidden>
          {Array.from({ length: loadingRows }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      ) : isEmpty ? (
        <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
      {action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="group mt-auto inline-flex min-h-11 w-full items-center justify-between gap-2 rounded-lg border border-brand/30 bg-muted px-3 py-2 text-xs font-semibold text-brand-text transition-[background-color,border-color,transform] hover:border-brand hover:bg-accent active:scale-[0.98]"
        >
          <span>{action.label}</span>
          <ArrowRight size={14} aria-hidden className="transition-transform group-hover:translate-x-0.5" />
        </button>
      ) : null}
    </section>
  );
}
