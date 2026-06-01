import React from 'react';
import { clsx } from 'clsx';
import type { LucideIcon } from 'lucide-react';
import { BentoActionButton } from './BentoActionButton';

export type BentoCardVariant = 'default' | 'brand' | 'warning';

interface ActionConfig {
  label: string;
  onClick: () => void;
  ariaLabel?: string;
}

interface BentoCardShellProps {
  /** lucide-react 圖示元件 */
  icon: LucideIcon;
  title: string;
  /** 標題列右側內容（如日期、漲跌幅、徽章） */
  rightSlot?: React.ReactNode;
  /** loading 為 true 時顯示 skeleton，覆蓋 children */
  loading?: boolean;
  /** 自訂 loading skeleton；省略時使用預設 3 條 pulse bar */
  loadingSkeleton?: React.ReactNode;
  /** 為 true 時顯示 emptyText 取代 children */
  isEmpty?: boolean;
  emptyText?: string;
  /** 主內容 */
  children?: React.ReactNode;
  /** 底部「詳細」CTA 按鈕；省略則不顯示 */
  action?: ActionConfig;
  /** 底部自訂內容（替代 action） */
  footer?: React.ReactNode;
  /** 視覺變體：default / brand 焦點 / warning 警示 */
  variant?: BentoCardVariant;
  /** 額外 className，掛在最外層 */
  className?: string;
}

const VARIANT_CLASSES: Record<BentoCardVariant, string> = {
  default: 'border-[var(--color-border)] bg-[var(--color-bg-card)]',
  brand: 'border-brand/25 bg-[var(--color-bg-card)] overflow-hidden',
  warning: '',
};

const VARIANT_STYLES: Partial<Record<BentoCardVariant, React.CSSProperties>> = {
  warning: {
    backgroundColor: 'var(--color-warning-bg)',
    borderColor: 'var(--color-warning-border)',
  },
};

function DefaultSkeleton() {
  return (
    <div className="space-y-2 flex-1" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-9 rounded-lg bg-[var(--color-bg-elevated)] animate-pulse" />
      ))}
    </div>
  );
}

/**
 * 個股頁 bento 卡片統一殼層。
 *
 * 取代散落於 6 個 bento/* 元件的相同 chrome：
 *  - rounded-2xl border bg-card shadow-card p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px]
 *  - 標題列（icon + title + 可選右側）
 *  - loading skeleton / empty state
 *  - 底部 BentoActionButton（或自訂 footer）
 *
 * 子卡片只需傳入內容與差異化的 slot，色彩 / 邊框 / 陰影一致由 token 控制。
 */
export const BentoCardShell: React.FC<BentoCardShellProps> = ({
  icon: Icon,
  title,
  rightSlot,
  loading,
  loadingSkeleton,
  isEmpty,
  emptyText = '尚無資料',
  children,
  action,
  footer,
  variant = 'default',
  className,
}) => {
  return (
    <div
      className={clsx(
        'relative rounded-2xl border shadow-[var(--shadow-card)] p-4 sm:p-5 flex flex-col gap-3 h-full min-h-[260px]',
        VARIANT_CLASSES[variant],
        className,
      )}
      style={VARIANT_STYLES[variant]}
    >
      {variant === 'brand' ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'var(--brand-gradient)' }}
        />
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
          <Icon
            size={16}
            className={variant === 'warning' ? 'text-warning-icon' : 'text-brand'}
            aria-hidden
          />
          {title}
        </h3>
        {rightSlot ?? null}
      </div>

      {loading ? (
        loadingSkeleton ?? <DefaultSkeleton />
      ) : isEmpty ? (
        <p className="flex-1 flex items-center justify-center text-xs text-[var(--color-text-muted)]">
          {emptyText}
        </p>
      ) : (
        children
      )}

      {footer ?? (action ? <BentoActionButton {...action} /> : null)}
    </div>
  );
};
