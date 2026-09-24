import React, { useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import type { NewsListFilters } from '@/lib/hooks/useNewsList';
import { cn } from '@/lib/cn';

interface Props {
  draft: NewsListFilters;
  setDraft: React.Dispatch<React.SetStateAction<NewsListFilters>>;
  onApply: () => void;
  onClearAdvanced: () => void;
  disabled?: boolean;
}

const inputClass =
  'h-10 w-full rounded-lg border border-input bg-card px-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25';

const advancedFields = [
  { key: 'scope', label: '影響範圍', options: [['', '全部'], ['market', '大盤'], ['industry', '產業'], ['company', '公司']] },
  { key: 'direction', label: '影響方向', options: [['', '全部'], ['positive', '正向'], ['negative', '負向'], ['neutral', '中性'], ['mixed', '正負並存'], ['uncertain', '方向未明']] },
  { key: 'importance', label: '重要性', options: [['', '全部'], ['high', '高'], ['medium', '中'], ['low', '低']] },
  { key: 'relation', label: '關聯類型', options: [['', '全部'], ['direct', '直接'], ['industry_context', '產業脈絡'], ['market_context', '市場脈絡']] },
] as const;

/** 依發布時間篩選新聞（含起迄） */
export function NewsFilters({ draft, setDraft, onApply, onClearAdvanced, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const active = Boolean(
    draft.start_time?.trim() || draft.end_time?.trim() || draft.scope || draft.industry?.trim() || draft.topic?.trim() || draft.direction || draft.importance || draft.relation,
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="依發布時間篩選新聞"
          title="發布時間篩選"
          className={cn(
            'relative inline-flex size-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-50',
            active ? 'border-brand/50 bg-accent text-accent-foreground' : 'text-muted-foreground hover:border-border-strong hover:text-brand-text',
          )}
        >
          <CalendarRange size={18} aria-hidden />
          {active ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand" aria-hidden /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(calc(100vw-2rem),18rem)] space-y-3" aria-label="發布時間篩選">
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
        {advancedFields.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">{field.label}</span>
            <select
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
            onChange={(e) => setDraft((prev) => ({ ...prev, industry: e.target.value }))}
            disabled={disabled}
            className={inputClass}
            placeholder="例如 24"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">主題</span>
          <input
            value={draft.topic ?? ''}
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
            清除時間條件
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
