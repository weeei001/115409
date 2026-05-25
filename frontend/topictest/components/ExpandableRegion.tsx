import React, { useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

interface ExpandableRegionProps {
  /** 摺疊時按鈕文字 */
  expandLabel: string;
  /** 展開時按鈕文字；省略則沿用 expandLabel */
  collapseLabel?: string;
  defaultExpanded?: boolean;
  /** md 以上視窗預設展開（行動版仍收合） */
  defaultExpandedOnDesktop?: boolean;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  toggleClassName?: string;
}

function resolveInitialExpanded(
  defaultExpanded: boolean,
  defaultExpandedOnDesktop: boolean,
): boolean {
  if (defaultExpanded) return true;
  if (!defaultExpandedOnDesktop || typeof window === 'undefined') return false;
  return window.matchMedia('(min-width: 768px)').matches;
}

/**
 * 可摺疊區塊：預設收合，按鈕具 aria-expanded / aria-controls。
 */
export function ExpandableRegion({
  expandLabel,
  collapseLabel,
  defaultExpanded = false,
  defaultExpandedOnDesktop = false,
  children,
  className,
  panelClassName,
  toggleClassName,
}: ExpandableRegionProps) {
  const [expanded, setExpanded] = useState(() =>
    resolveInitialExpanded(defaultExpanded, defaultExpandedOnDesktop),
  );
  const baseId = useId().replace(/:/g, '');
  const panelId = `expandable-${baseId}`;
  const toggleId = `${panelId}-toggle`;

  useEffect(() => {
    if (!defaultExpandedOnDesktop || defaultExpanded) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setExpanded(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, [defaultExpanded, defaultExpandedOnDesktop]);

  return (
    <div className={className}>
      <button
        type="button"
        id={toggleId}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((v) => !v)}
        className={clsx(
          'mt-3 flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--color-border)]',
          toggleClassName,
          'bg-[var(--color-bg-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--color-text-secondary)]',
          'transition-[color,background-color,border-color] duration-200',
          'hover:border-brand/35 hover:bg-brand/5 hover:text-brand-deep',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 focus-visible:ring-offset-2',
          'dark:hover:text-brand-light',
        )}
      >
        <span>{expanded ? (collapseLabel ?? expandLabel) : expandLabel}</span>
        <ChevronDown
          size={16}
          aria-hidden
          className={clsx('shrink-0 transition-transform duration-200', expanded && 'rotate-180')}
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={toggleId}
        hidden={!expanded}
        className={panelClassName}
      >
        {children}
      </div>
    </div>
  );
}
