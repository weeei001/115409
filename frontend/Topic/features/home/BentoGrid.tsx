import React from 'react';
import { cn } from '@/lib/cn';

/** 首頁 Bento 版面：手機 1 欄、sm 2 欄、lg 3 欄 */
export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3', className)}>{children}</div>;
}

interface CellProps {
  children: React.ReactNode;
  span?: 1 | 2 | 3;
  /** 只在 sm 以下生效的單欄順序 */
  orderMobile?: 1 | 2 | 3;
  noPad?: boolean;
  className?: string;
}

const SPAN: Record<number, string> = { 1: '', 2: 'sm:col-span-2', 3: 'sm:col-span-2 lg:col-span-3' };
const ORDER: Record<number, string> = { 1: 'order-1', 2: 'order-2', 3: 'order-3' };

/** Keep home content visible in server HTML without waiting for hydration or viewport observers. */
export function BentoCell({ children, span = 1, orderMobile, noPad = false, className }: CellProps) {
  return (
    <div
      className={cn(SPAN[span], orderMobile != null && `${ORDER[orderMobile]} sm:order-none`)}
    >
      <section
        data-stagger
        className={cn(
          'h-full overflow-hidden rounded-xl border bg-card shadow-card transition-[border-color,box-shadow] duration-300 hover:border-border-strong hover:shadow-card-hover dark:glass',
          !noPad && 'p-4 sm:p-5',
          className,
        )}
      >
        {children}
      </section>
    </div>
  );
}
