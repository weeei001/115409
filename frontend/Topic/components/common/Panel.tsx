import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  icon?: LucideIcon;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** 標題列右側（徽章、日期、按鈕） */
  actions?: React.ReactNode;
  /** 標題層級；預設 h2 */
  as?: 'h2' | 'h3';
  padded?: boolean;
}

/** 全站卡片外框：一律用 token，不要在頁面裡另外刻卡片樣式 */
export function Panel({
  icon: Icon,
  title,
  description,
  actions,
  as: Heading = 'h2',
  padded = true,
  className,
  children,
  ...rest
}: PanelProps) {
  return (
    <section
      data-stagger
      className={cn('rounded-xl border bg-card text-card-foreground shadow-card', padded && 'p-4 sm:p-5', className)}
      {...rest}
    >
      {title || actions ? (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title ? (
              <Heading className="flex items-center gap-2 text-base font-semibold leading-tight">
                {Icon ? <Icon size={16} className="shrink-0 text-brand" aria-hidden /> : null}
                {title}
              </Heading>
            ) : null}
            {description ? <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
