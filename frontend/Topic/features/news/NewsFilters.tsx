import React, { useEffect, useRef, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { NewsListFilters } from '@/lib/hooks/useNewsList';
import { cn } from '@/lib/cn';
import { NEWS_ADVANCED_FIELDS, summarizeNewsFilters } from '@/lib/utils/newsFilters';

interface Props {
  draft: NewsListFilters;
  applied: NewsListFilters;
  setDraft: React.Dispatch<React.SetStateAction<NewsListFilters>>;
  onApply: () => void;
  onClearAdvanced: () => void;
  disabled?: boolean;
  fixedRelation?: boolean;
  triggerRef?: React.Ref<HTMLButtonElement>;
}

const inputClass =
  'h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25';

/** Public news search conditions, with drafts applied explicitly. */
export function NewsFilters({ draft, applied, setDraft, onApply, onClearAdvanced, disabled, fixedRelation, triggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const active = summarizeNewsFilters(applied, fixedRelation).length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          ref={triggerRef}
          disabled={disabled}
          aria-label="篩選新聞"
          title="篩選新聞"
          className={cn(
            'relative inline-flex size-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-50',
            active ? 'border-brand/50 bg-accent text-accent-foreground' : 'text-muted-foreground hover:border-border-strong hover:text-brand-text',
          )}
        >
          <CalendarRange size={18} aria-hidden />
          {active ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand" aria-hidden /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        className="max-h-[var(--radix-popover-content-available-height)] w-[min(calc(100vw-2rem),18rem)] space-y-3 overflow-y-auto overscroll-contain"
        aria-label="篩選新聞"
      >
        <p className="text-sm font-semibold">篩選新聞</p>
        <p className="text-[11px] leading-relaxed text-muted-foreground">時間區間為發布時間（含起迄）。</p>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">發布時間起</span>
          <input
            type="datetime-local"
            value={draft.start_time ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, start_time: e.target.value }))}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        {NEWS_ADVANCED_FIELDS.filter((field) => !(fixedRelation && field.key === 'relation')).map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{field.label}</span>
            <select
              aria-label={field.label}
              value={String(draft[field.key] ?? '')}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))}
              disabled={disabled}
              className={inputClass}
            >
              {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">產業代碼</span>
          <input
            value={draft.industry ?? ''}
            maxLength={200}
            onChange={(e) => setDraft((prev) => ({ ...prev, industry: e.target.value }))}
            disabled={disabled}
            className={inputClass}
            placeholder="例如 TWSE:24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">主題</span>
          <input
            value={draft.topic ?? ''}
            maxLength={200}
            onChange={(e) => setDraft((prev) => ({ ...prev, topic: e.target.value }))}
            disabled={disabled}
            className={inputClass}
            placeholder="例如 ai"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">發布時間迄</span>
          <input
            type="datetime-local"
            value={draft.end_time ?? ''}
            onChange={(e) => setDraft((prev) => ({ ...prev, end_time: e.target.value }))}
            disabled={disabled}
            className={inputClass}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={disabled}
            onClick={() => {
              onApply();
              setOpen(false);
            }}
            className="min-h-11"
          >
            套用篩選
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => {
              onClearAdvanced();
              setOpen(false);
            }}
            className="min-h-11"
          >
            清除篩選條件
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AppliedNewsFilters({ applied, onClearAdvanced, disabled, fixedRelation, triggerRef }: Pick<Props, 'applied' | 'onClearAdvanced' | 'disabled' | 'fixedRelation'> & { triggerRef?: React.RefObject<HTMLButtonElement | null> }) {
  const returnFocus = useRef(false);
  useEffect(() => {
    if (returnFocus.current && !disabled) {
      returnFocus.current = false;
      triggerRef?.current?.focus();
    }
  }, [applied, disabled, triggerRef]);
  const summary = summarizeNewsFilters(applied, fixedRelation);
  if (!summary.length) return null;
  return (
    <div className="mb-4 flex flex-wrap items-start gap-2">
      <div role="status" aria-label="已套用新聞篩選" className="flex min-w-0 flex-1 flex-wrap items-start gap-2 text-xs">
        <span className="py-1 text-muted-foreground">已套用：</span>
        <ul className="flex min-w-0 flex-wrap gap-1.5" aria-label="已套用條件">
          {summary.map((text) => <li key={text} className="max-w-full rounded-md border bg-muted px-2 py-1 wrap-anywhere text-subtle">{text}</li>)}
        </ul>
      </div>
      <Button size="sm" variant="ghost" className="min-h-11 shrink-0" disabled={disabled} onClick={() => { returnFocus.current = true; onClearAdvanced(); }} aria-label="清除進階新聞篩選">清除進階篩選</Button>
    </div>
  );
}

export function NewsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-full animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}
