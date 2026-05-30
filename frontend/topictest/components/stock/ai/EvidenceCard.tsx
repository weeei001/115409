import React, { useEffect, useRef } from 'react';
import type { StockBehaviorInventoryItem } from '../../../lib/types/stockBehavior';
import {
  formatInventoryValue,
  inventoryFieldLabel,
  type InventoryCategory,
} from '../../../lib/utils/aiInventoryHelpers';
import { evidenceDomId } from '../../../lib/utils/evidenceDom';

interface Props {
  item: StockBehaviorInventoryItem;
  category: InventoryCategory;
  isHighlighted: boolean;
  registerRef: (id: string, el: HTMLElement | null) => void;
  hideDate?: boolean;
}

export const EvidenceCard: React.FC<Props> = ({
  item,
  category,
  isHighlighted,
  registerRef,
  hideDate = false,
}) => {
  const label = inventoryFieldLabel(item.field);
  const valueText = formatInventoryValue(category, item);
  const dateText = hideDate ? null : (item.date ?? item.date_range ?? null);
  const streak = item.streak_days != null && Number.isFinite(item.streak_days) ? item.streak_days : null;
  const isReference = Boolean(item.reference_only);

  const elRef = useRef<HTMLElement | null>(null);
  const setRef = (el: HTMLElement | null) => {
    elRef.current = el;
    registerRef(item.id, el);
  };

  // 被高亮時自動滾入視野，避免 tab 切換後 ref 尚未更新時 scroll 失效
  useEffect(() => {
    if (isHighlighted && elRef.current) {
      elRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [isHighlighted]);

  const highlightClass = isHighlighted
    ? 'ring-2 ring-brand ring-offset-2 ring-offset-[var(--color-bg-card)]'
    : '';

  return (
    <article
      id={evidenceDomId(item.id)}
      ref={setRef}
      className={`rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2.5 py-2 transition-shadow duration-300 ${highlightClass}`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-[var(--color-text-muted)] truncate">{label}</p>
        <span className="shrink-0 rounded bg-brand/8 px-1 py-px text-[9px] font-mono text-brand/80 tabular-nums">
          {item.id}
        </span>
      </div>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-[var(--color-text-primary)] break-words leading-tight">
        {valueText}
      </p>

      {(dateText || streak != null || isReference) ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px]">
          {dateText ? (
            <span className="text-[var(--color-text-muted)] tabular-nums">{dateText}</span>
          ) : null}
          {streak != null ? (
            <span className="rounded-sm bg-brand/10 px-1 py-px font-semibold text-brand">
              連 {streak} 日
            </span>
          ) : null}
          {isReference ? (
            <span className="text-[var(--color-text-muted)]">僅供參考</span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
};
