import React, { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/cn';

interface ExpandableProps {
  /** 收合時按鈕文字 */
  expandLabel: string;
  /** 展開時按鈕文字；省略沿用 expandLabel */
  collapseLabel?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/** 可收合區塊：預設收合（決議 c53 維持舊版），按鈕帶 aria-expanded */
export function Expandable({ expandLabel, collapseLabel, defaultOpen = false, children, className, contentClassName }: ExpandableProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={className}>
      <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border bg-muted px-4 py-2 text-sm font-medium text-subtle transition-colors hover:border-border-strong hover:bg-accent hover:text-accent-foreground">
        <span>{open ? collapseLabel ?? expandLabel : expandLabel}</span>
        <ChevronDown size={16} aria-hidden className={cn('shrink-0 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}

interface TableSectionProps {
  title: string;
  subtitle?: string;
  expandLabel: string;
  collapseLabel: string;
  children: React.ReactNode;
  className?: string;
}

/** 表格區塊：標題＋可收合表格 */
export function CollapsibleTableSection({ title, subtitle, expandLabel, collapseLabel, children, className }: TableSectionProps) {
  return (
    <section aria-label={title} className={className}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle ? <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p> : null}
      <Expandable
        expandLabel={expandLabel}
        collapseLabel={collapseLabel}
        className="mt-2"
        contentClassName="space-y-2 pt-2"
      >
        {children}
      </Expandable>
    </section>
  );
}

/**
 * 橫向捲動提示。傳 scrollRef 時只在表格實際溢出時顯示（任何寬度）；
 * 沒傳時只在小螢幕顯示。
 */
export function TableScrollHint({ className, scrollRef }: { className?: string; scrollRef?: React.RefObject<HTMLElement | null> }) {
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = scrollRef?.current;
    if (!el) return;
    const check = () => setOverflows(el.scrollWidth > el.clientWidth + 2);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, [scrollRef]);

  if (scrollRef && !overflows) return null;
  return <p className={cn('text-xs text-muted-foreground', !scrollRef && 'sm:hidden', className)}>← 左右滑動查看完整表格 →</p>;
}
