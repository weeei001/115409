import React from 'react';
import { motion } from 'motion/react';
import { usePrefersReducedMotion } from '@/lib/hooks/useClientEnv';
import { cn } from '@/lib/cn';

/** 首頁 Bento 版面：手機 1 欄、sm 2 欄、lg 3 欄 */
export function BentoGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3', className)}>{children}</div>;
}

interface CellProps {
  children: React.ReactNode;
  span?: 1 | 2 | 3;
  delay?: number;
  /** 只在 sm 以下生效的單欄順序 */
  orderMobile?: 1 | 2 | 3;
  noPad?: boolean;
  className?: string;
}

const SPAN: Record<number, string> = { 1: '', 2: 'sm:col-span-2', 3: 'sm:col-span-2 lg:col-span-3' };
const ORDER: Record<number, string> = { 1: 'order-1', 2: 'order-2', 3: 'order-3' };

/**
 * 捲入視窗時淡入上移。reduced-motion 時直接顯示；
 * 兩種情況都維持同一個 DOM 結構，避免水合時伺服器與客戶端不一致。
 */
export function BentoCell({ children, span = 1, delay = 0, orderMobile, noPad = false, className }: CellProps) {
  const reduce = usePrefersReducedMotion();
  return (
    <motion.div
      className={cn(SPAN[span], orderMobile != null && `${ORDER[orderMobile]} sm:order-none`)}
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.97 }}
      animate={reduce ? { opacity: 1, y: 0, scale: 1 } : undefined}
      whileInView={reduce ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={reduce ? undefined : { once: true, margin: '-60px' }}
      transition={reduce ? { duration: 0 } : { duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
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
    </motion.div>
  );
}
