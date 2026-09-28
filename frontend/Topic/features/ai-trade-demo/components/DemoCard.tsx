import React, { useId } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface Props {
  title: string;
  icon?: LucideIcon;
  /** 標題下方的說明 */
  description?: React.ReactNode;
  /** 標題列右側（例如狀態標籤） */
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** 卡片外框同 components/common/Panel（rounded-xl border bg-card shadow-card p-4 sm:p-5） */
export function DemoCard({ title, icon: Icon, description, aside, children, className }: Props) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-stagger className={cn('min-w-0 rounded-xl border bg-card p-4 shadow-card sm:p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 id={headingId} className="flex items-center gap-2 text-sm font-semibold">
            {Icon ? <Icon size={16} className="shrink-0 text-brand" aria-hidden /> : null}
            {title}
          </h2>
          {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}
