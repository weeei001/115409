import React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

/** 摘要列：44px 高、右側 chevron、hover 文字轉前景色；也給需要自己排版的摘要列沿用 */
export const disclosureSummaryClass =
  'flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-subtle transition-colors duration-(--dur-flash) ease-flash hover:text-foreground focus-lamp [&::-webkit-details-marker]:hidden';

type SummaryProps = React.ComponentPropsWithRef<'summary'> & { [key: `data-${string}`]: string | boolean | undefined };

interface DisclosureProps extends Omit<React.ComponentPropsWithRef<'details'>, 'summary'> {
  summary: React.ReactNode;
  /** 給 <summary> 的屬性（className、事件、data-*、aria-*） */
  summaryProps?: SummaryProps;
}

/**
 * 原生 <details> 的共用外觀。保留原生行為（瀏覽器內搜尋、錨點連結會自動展開），
 * 所以引用原文、證據這類要能用 #id 跳過去的內容用它，不用 Radix Collapsible。
 */
export function Disclosure({ summary, summaryProps, className, children, ...rest }: DisclosureProps) {
  const { className: summaryClassName, ...summaryRest } = summaryProps ?? {};
  return (
    <details className={className} {...rest}>
      <summary {...summaryRest} className={cn(disclosureSummaryClass, summaryClassName)}>
        <span className="min-w-0 flex-1">{summary}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className="shrink-0 text-muted-foreground transition-transform duration-(--dur-sweep) ease-flash [details[open]>summary>&]:rotate-180"
        />
      </summary>
      {children}
    </details>
  );
}
