'use client';

import React, { useEffect, useRef, useState } from 'react';
import { CalendarRange, ChevronDown, ChevronUp, Filter } from 'lucide-react';
import type { NewsListFilters } from '../../lib/hooks/useNewsList';

interface Props {
  draft: NewsListFilters;
  setDraft: React.Dispatch<React.SetStateAction<NewsListFilters>>;
  onApply: () => void;
  onClearAdvanced: () => void;
  disabled?: boolean;
  /** toolbar：右上角按鈕＋下拉；panel：區塊內可展開 */
  layout?: 'toolbar' | 'panel';
}

function hasTimeFilter(draft: NewsListFilters): boolean {
  return Boolean(draft.start_time?.trim() || draft.end_time?.trim());
}

function TimeRangeFields({
  draft,
  setDraft,
  disabled,
}: Pick<Props, 'draft' | 'setDraft' | 'disabled'>) {
  return (
    <div className="grid grid-cols-1 gap-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-text-muted)]">發布時間起</span>
        <input
          type="datetime-local"
          value={draft.start_time ?? ''}
          onChange={(e) => setDraft((prev) => ({ ...prev, start_time: e.target.value }))}
          disabled={disabled}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2.5 py-2 text-sm min-h-[40px]"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-[var(--color-text-muted)]">發布時間迄</span>
        <input
          type="datetime-local"
          value={draft.end_time ?? ''}
          onChange={(e) => setDraft((prev) => ({ ...prev, end_time: e.target.value }))}
          disabled={disabled}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-bg-card)] px-2.5 py-2 text-sm min-h-[40px]"
        />
      </label>
    </div>
  );
}

function FilterActions({
  onApply,
  onClearAdvanced,
  disabled,
  onApplied,
}: Pick<Props, 'onApply' | 'onClearAdvanced' | 'disabled'> & { onApplied?: () => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => {
          onApply();
          onApplied?.();
        }}
        disabled={disabled}
        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--color-on-brand)] min-h-11"
        style={{ background: 'var(--brand-gradient)' }}
      >
        套用篩選
      </button>
      <button
        type="button"
        onClick={() => {
          onClearAdvanced();
          onApplied?.();
        }}
        disabled={disabled}
        className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--color-border)] text-[var(--color-text-secondary)] min-h-11"
      >
        清除時間條件
      </button>
    </div>
  );
}

export const NewsAdvancedFilters: React.FC<Props> = ({
  draft,
  setDraft,
  onApply,
  onClearAdvanced,
  disabled = false,
  layout = 'toolbar',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || layout !== 'toolbar') return;
    const handlePointerDown = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [open, layout]);

  if (layout === 'toolbar') {
    const active = hasTimeFilter(draft);

    return (
      <div ref={containerRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          aria-expanded={open}
          aria-label="依發布時間篩選新聞"
          title="發布時間篩選"
          className={`relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-colors disabled:opacity-50
            ${active ? 'border-brand/50 text-brand bg-brand/5' : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-brand hover:border-brand/40'}`}
        >
          <CalendarRange size={18} aria-hidden />
          {active ? (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-brand" aria-hidden />
          ) : null}
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label="發布時間篩選"
            className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(calc(100vw-2rem),18rem)] rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] p-3 shadow-lg space-y-3"
          >
            <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
              時間區間為發布時間（含起迄）。
            </p>
            <TimeRangeFields draft={draft} setDraft={setDraft} disabled={disabled} />
            <FilterActions
              onApply={onApply}
              onClearAdvanced={onClearAdvanced}
              disabled={disabled}
              onApplied={() => setOpen(false)}
            />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--color-text-muted)]
                   hover:text-brand transition-colors disabled:opacity-50 min-h-[36px]"
        aria-expanded={open}
      >
        <Filter size={14} aria-hidden />
        發布時間篩選
        {hasTimeFilter(draft) ? (
          <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
            已設定
          </span>
        ) : null}
        {open ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
      </button>

      {open ? (
        <div className="mt-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-elevated)]/50 p-3 sm:p-4 space-y-3">
          <p className="text-[11px] text-[var(--color-text-muted)] leading-relaxed">
            時間區間為發布時間（含起迄）。
          </p>
          <TimeRangeFields draft={draft} setDraft={setDraft} disabled={disabled} />
          <FilterActions onApply={onApply} onClearAdvanced={onClearAdvanced} disabled={disabled} />
        </div>
      ) : null}
    </div>
  );
};
