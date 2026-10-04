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
      <CollapsibleTrigger className="lamp-row flex min-h-11 w-full items-center justify-between gap-2 border-y bg-card px-3 py-2 text-left text-sm font-medium text-foreground">
        <span>{open ? collapseLabel ?? expandLabel : expandLabel}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className={cn('shrink-0 text-muted-foreground transition-transform duration-(--dur-sweep) ease-flash', open && 'rotate-180')}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}

interface FoldSectionProps {
  title: React.ReactNode;
  /** 收合時也看得到的一行摘要：裡面有什麼 */
  summary?: React.ReactNode;
  /** 觸發列外層的標題層級；預設 h3（放在帳頁 h2 底下） */
  headingLevel?: 'h2' | 'h3';
  defaultOpen?: boolean;
  /**
   * 預設 false：收合時內容仍掛載、只加 hidden（文字留在 DOM，靜態渲染與測試看得到）。
   * 內容有圖表時傳 true：第一次展開才掛載，之後保留，避免在 0 寬的容器裡初始化圖表。
   */
  lazy?: boolean;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}

/**
 * 收合段落：一列「標題＋一行摘要＋展開」，預設收合（決議 c53）。
 * 觸發鈕包在標題元素裡（帶 aria-expanded／aria-controls），內容在下方，以一條細線分開。
 */
export function FoldSection({
  title,
  summary,
  headingLevel: Heading = 'h3',
  defaultOpen = false,
  lazy = false,
  children,
  className,
  contentClassName,
}: FoldSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [visited, setVisited] = useState(defaultOpen);
  const onOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) setVisited(true);
  };
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className={cn('min-w-0 bg-card', className)}>
      <Heading className="m-0">
        <CollapsibleTrigger className="lamp-row flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5">
          <span className="min-w-0">
            <span className="block text-[15px] leading-snug font-medium tracking-[0.04em] text-foreground">{title}</span>
            {summary ? <span className="mt-0.5 block text-[13px] leading-snug font-normal text-muted-foreground">{summary}</span> : null}
          </span>
          <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-normal text-muted-foreground">
            <span className="hidden sm:inline">{open ? '收合' : '展開'}</span>
            <ChevronDown
              size={16}
              aria-hidden
              className={cn('transition-transform duration-(--dur-sweep) ease-flash', open && 'rotate-180')}
            />
          </span>
        </CollapsibleTrigger>
      </Heading>
      {/* forceMount 時 Radix 不會自己加 hidden，這裡明確依開合狀態隱藏 */}
      <CollapsibleContent forceMount hidden={!open} className={cn('border-t', contentClassName)}>
        {lazy && !visited ? null : children}
      </CollapsibleContent>
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
      <h3 className="text-[13px] font-medium tracking-[0.04em] text-muted-foreground">{title}</h3>
      {subtitle ? <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{subtitle}</p> : null}
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
