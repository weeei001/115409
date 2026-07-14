import React from 'react';
import { motion } from 'motion/react';
import { clsx } from 'clsx';
import { usePrefersReducedMotionClient } from '../lib/usePrefersReducedMotionClient';

/* ── BentoGrid ── */

interface BentoGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

export function BentoGrid({ children, columns = 3, className }: BentoGridProps) {
  const colClass =
    columns === 4
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
      : columns === 2
        ? 'grid-cols-1 sm:grid-cols-2'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div className={clsx('grid gap-4 sm:gap-5', colClass, className)}>
      {children}
    </div>
  );
}

/* ── BentoCell ── */

interface BentoCellProps {
  children: React.ReactNode;
  span?: 1 | 2 | 3;
  rowSpan?: 1 | 2;
  className?: string;
  noPad?: boolean;
  animate?: boolean;
  delay?: number;
  /** 僅小於 sm：單欄敘事順序；sm 以上恢復預設網格排列 */
  orderMobile?: 1 | 2 | 3 | 4 | 5 | 6;
  /** 套用在網格項目外層（例如手機隱藏） */
  wrapperClassName?: string;
}

const ORDER_MOBILE_CLASS: Record<number, string> = {
  1: 'order-1',
  2: 'order-2',
  3: 'order-3',
  4: 'order-4',
  5: 'order-5',
  6: 'order-6',
};

const spanClass: Record<number, string> = {
  1: '',
  2: 'sm:col-span-2',
  3: 'sm:col-span-2 lg:col-span-3',
};

const rowSpanClass: Record<number, string> = {
  1: '',
  2: 'sm:row-span-2',
};

export function BentoCell({
  children,
  span = 1,
  rowSpan = 1,
  className,
  noPad = false,
  animate = true,
  delay = 0,
  orderMobile,
  wrapperClassName,
}: BentoCellProps) {
  const reduceMotion = usePrefersReducedMotionClient();
  const skipAnim = !animate || reduceMotion;

  /** 一律相同兩層結構，避免 reduceMotion 分支造成水合與伺服器 HTML 不一致 */
  return (
    <motion.div
      className={clsx(
        spanClass[span],
        rowSpanClass[rowSpan],
        orderMobile != null && ORDER_MOBILE_CLASS[orderMobile],
        orderMobile != null && 'sm:order-none',
        wrapperClassName,
      )}
      initial={skipAnim ? false : { opacity: 0, y: 24, scale: 0.97 }}
      animate={skipAnim ? { opacity: 1, y: 0, scale: 1 } : undefined}
      whileInView={skipAnim ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={skipAnim ? undefined : { once: true, margin: '-60px' }}
      transition={
        skipAnim
          ? { duration: 0 }
          : { duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }
      }
    >
      <div
        className={clsx(
          'bento-cell overflow-hidden h-full',
          !noPad && 'p-5 sm:p-6',
          className,
        )}
      >
        {children}
      </div>
    </motion.div>
  );
}
