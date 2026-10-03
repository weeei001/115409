import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ListFilter, XIcon } from 'lucide-react';
import { LoadingRows } from '@/components/common/Notice';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import type { NewsListFilters } from '@/lib/hooks/useNewsList';
import { useIsMobile } from '@/lib/hooks/useClientEnv';
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

// ── 發布時間的快速區間：只是把既有的 start_time／end_time 草稿填好，不新增任何查詢參數 ──

export type NewsDatePreset = 'today' | '3d' | '7d';
export const NEWS_DATE_PRESETS: { key: NewsDatePreset; label: string; days: number }[] = [
  { key: 'today', label: '今天', days: 1 },
  { key: '3d', label: '近 3 日', days: 3 },
  { key: '7d', label: '近 7 日', days: 7 },
];

const pad = (value: number) => String(value).padStart(2, '0');
/** Date → datetime-local 的值（本地時間 YYYY-MM-DDTHH:MM），與原本的輸入框格式相同 */
export const toDateTimeLocal = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** 近 N 日＝從 N−1 天前的 00:00 起、不設結束時間（含今天到目前為止） */
export function newsDatePresetRange(days: number, now = new Date()): Pick<NewsListFilters, 'start_time' | 'end_time'> {
  return { start_time: toDateTimeLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))), end_time: '' };
}

/** 草稿的時間條件對應哪個快速區間；有時間但對不上任何快速區間＝自訂；都沒填＝不限 */
export function matchNewsDatePreset(filters: NewsListFilters, now = new Date()): NewsDatePreset | 'custom' | null {
  const start = filters.start_time?.trim() ?? '';
  const end = filters.end_time?.trim() ?? '';
  if (!start && !end) return null;
  if (!end) {
    const hit = NEWS_DATE_PRESETS.find((preset) => newsDatePresetRange(preset.days, now).start_time === start);
    if (hit) return hit.key;
  }
  return 'custom';
}

/** 輸入框：2px 圓角、border-input 外框（對比 ≥ 3:1）、44px 高；focus 用全站的燈色 focus 圈 */
const inputClass =
  'h-11 w-full min-w-0 rounded-sm border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus:border-border-strong focus-lamp disabled:opacity-50';

/** 方形切換鈕（2px 圓角、不用膠囊）；按下的狀態用粗線＋淺底，不用燈色 */
const toggleClass =
  'inline-flex h-11 min-w-0 items-center justify-center rounded-sm border px-2 text-sm whitespace-nowrap outline-none transition-colors duration-(--dur-flash) focus-lamp disabled:opacity-50 aria-pressed:border-border-strong aria-pressed:bg-accent aria-pressed:font-medium aria-pressed:text-foreground border-input bg-card text-subtle hover:border-border-strong hover:text-foreground';

/** 一個篩選欄位：小標在上、控制項在下，可選的說明行用 aria-describedby 接上 */
function Field({ label, hint, hintId, className, children }: { label: string; hint?: string; hintId?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5 text-xs', className)}>
      <span className="text-muted-foreground">{label}</span>
      {children}
      {hint ? <span id={hintId} className="text-[12px] leading-relaxed text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

/** 下拉選單：去掉原生外觀，換成與輸入框同一套方角外框，右側用同一個 chevron 圖示 */
function Select({ className, children, ...rest }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block min-w-0">
      <select {...rest} className={cn(inputClass, 'cursor-pointer appearance-none pr-9', className)}>
        {children}
      </select>
      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" />
    </span>
  );
}

const INDUSTRY_HINT = '上市填 TWSE:代號、上櫃填 TPEx:代號，例如 TWSE:24。';

/** 篩選欄位本體：發布時間（快速區間在前，自訂才展開兩個時間欄）→ 影響條件 → 產業代碼與主題 */
function FilterFields({ draft, setDraft, disabled, fixedRelation, layout }: Pick<Props, 'draft' | 'setDraft' | 'disabled' | 'fixedRelation'> & { layout: 'popover' | 'sheet' }) {
  const industryHintId = useId();
  const dateLegendId = useId();
  const [customChosen, setCustomChosen] = useState(false);
  const matched = matchNewsDatePreset(draft);
  const mode = customChosen ? 'custom' : matched;
  const popover = layout === 'popover';
  const selectFields = NEWS_ADVANCED_FIELDS.filter((field) => !(fixedRelation && field.key === 'relation'));
  // 寬版彈出層：下拉選單排成一列、文字欄兩欄，整張表盡量不需要捲動；手機 sheet：下拉選單兩欄、其餘單欄
  const pairGrid = popover ? 'grid-cols-2' : 'grid-cols-1 min-[400px]:grid-cols-2';
  const selectGrid = popover ? (selectFields.length > 3 ? 'grid-cols-4' : 'grid-cols-3') : 'grid-cols-2';

  const choosePreset = (preset: (typeof NEWS_DATE_PRESETS)[number]) => {
    setCustomChosen(false);
    // 再按一次已選的快速區間＝取消時間條件
    setDraft((prev) => ({ ...prev, ...(mode === preset.key ? { start_time: '', end_time: '' } : newsDatePresetRange(preset.days)) }));
  };

  return (
    <>
      <div role="group" aria-labelledby={dateLegendId} className="space-y-2">
        <p id={dateLegendId} className="text-xs text-muted-foreground">發布時間</p>
        <div className="grid grid-cols-4 gap-1.5">
          {NEWS_DATE_PRESETS.map((preset) => (
            <button key={preset.key} type="button" aria-pressed={mode === preset.key} disabled={disabled} onClick={() => choosePreset(preset)} className={toggleClass}>
              {preset.label}
            </button>
          ))}
          <button type="button" aria-pressed={mode === 'custom'} disabled={disabled} onClick={() => setCustomChosen(!(customChosen && mode === 'custom'))} className={toggleClass}>
            自訂
          </button>
        </div>
        {mode === 'custom' ? (
          <div className={cn('grid gap-3', pairGrid)}>
            <Field label="起（含）">
              <input
                type="datetime-local"
                value={draft.start_time ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, start_time: e.target.value }))}
                disabled={disabled}
                className={cn(inputClass, 'px-2 font-mono text-[13px] tabular-nums [color-scheme:light] dark:[color-scheme:dark]')}
              />
            </Field>
            <Field label="迄（含）">
              <input
                type="datetime-local"
                value={draft.end_time ?? ''}
                onChange={(e) => setDraft((prev) => ({ ...prev, end_time: e.target.value }))}
                disabled={disabled}
                className={cn(inputClass, 'px-2 font-mono text-[13px] tabular-nums [color-scheme:light] dark:[color-scheme:dark]')}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className={cn('grid gap-x-2 gap-y-3 border-t pt-3', selectGrid)}>
        {selectFields.map((field) => (
          <Field key={field.key} label={field.label}>
            <Select
              aria-label={field.label}
              value={String(draft[field.key] ?? '')}
              onChange={(e) => setDraft((prev) => ({ ...prev, [field.key]: e.target.value || undefined }))}
              disabled={disabled}
            >
              {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </Field>
        ))}
      </div>

      {/* 產業代碼：新聞 API 的 industry 參數要的是「TWSE:24」這種代碼，站內的產業搜尋只給中文產業名與股票，對不上，所以保留文字欄與說明 */}
      <div className={cn('grid items-start gap-3 border-t pt-3', popover ? 'grid-cols-2' : 'grid-cols-1')}>
        <Field label="產業代碼" hint={popover ? undefined : INDUSTRY_HINT} hintId={popover ? undefined : industryHintId}>
          <input
            value={draft.industry ?? ''}
            maxLength={200}
            onChange={(e) => setDraft((prev) => ({ ...prev, industry: e.target.value }))}
            disabled={disabled}
            aria-describedby={industryHintId}
            className={cn(inputClass, 'font-mono text-[13px]')}
            placeholder="例如 TWSE:24"
          />
        </Field>
        <Field label="主題">
          <input
            value={draft.topic ?? ''}
            maxLength={200}
            onChange={(e) => setDraft((prev) => ({ ...prev, topic: e.target.value }))}
            disabled={disabled}
            className={inputClass}
            placeholder="例如 ai"
          />
        </Field>
        {popover ? <p id={industryHintId} className="col-span-2 -mt-1.5 text-[12px] leading-relaxed text-muted-foreground">產業代碼：{INDUSTRY_HINT}</p> : null}
      </div>
    </>
  );
}

/**
 * Public news search conditions, with drafts applied explicitly.
 * 寬版：彈出層，高度不超過視窗可用高度；標題在上、欄位區自己捲動、套用／清除在捲動區外的底列，不會蓋住欄位。
 * 手機（< lg）：底部 sheet，欄位區捲動、動作列固定在底部並閃開手勢區。
 */
export function NewsFilters({ draft, applied, setDraft, onApply, onClearAdvanced, disabled, fixedRelation, triggerRef }: Props) {
  const [open, setOpen] = useState(false);
  const mobile = useIsMobile();
  const active = summarizeNewsFilters(applied, fixedRelation).length > 0;

  const trigger = (
    <button
      type="button"
      ref={triggerRef}
      disabled={disabled}
      aria-label="篩選新聞"
      title="篩選新聞"
      className={cn(
        'relative inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-sm border pr-3.5 pl-3 text-sm outline-none transition-colors duration-(--dur-flash) focus-lamp disabled:opacity-50',
        active ? 'border-border-strong bg-accent font-medium text-foreground' : 'border-input bg-card text-subtle hover:border-border-strong hover:bg-accent hover:text-foreground',
      )}
    >
      <ListFilter size={16} aria-hidden className="text-muted-foreground" />
      <span>篩選</span>
      {active ? <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand" aria-hidden /> : null}
    </button>
  );

  const actions = (
    <>
      <Button
        disabled={disabled}
        onClick={() => {
          onApply();
          setOpen(false);
        }}
        className="flex-1"
      >
        套用篩選
      </Button>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          onClearAdvanced();
          setOpen(false);
        }}
        className="flex-1"
      >
        清除篩選條件
      </Button>
    </>
  );
  const fields = <FilterFields draft={draft} setDraft={setDraft} disabled={disabled} fixedRelation={fixedRelation} layout={mobile ? 'sheet' : 'popover'} />;
  const description = '調整條件後按「套用篩選」才會生效。';

  if (mobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent side="bottom" showCloseButton={false} className="max-h-[88dvh] gap-0 rounded-none bg-popover p-0">
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-border-strong py-2 pr-2 pl-4">
            <div className="min-w-0 pt-1.5">
              <SheetTitle className="font-serif text-lg font-black tracking-[0.06em]">篩選新聞</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs leading-relaxed">{description}</SheetDescription>
            </div>
            <SheetClose asChild>
              <Button variant="ghost" size="icon" aria-label="關閉篩選" className="text-muted-foreground hover:text-foreground">
                <XIcon className="size-[18px]" aria-hidden />
              </Button>
            </SheetClose>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">{fields}</div>
          <div className="flex shrink-0 gap-2 border-t bg-popover px-4 pt-3 pb-[calc(0.75rem+var(--app-safe-area-bottom))]">{actions}</div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        // 開在篩選鈕左側：垂直方向可以整段上下平移，可用高度接近整個視窗，不會因為按鈕在畫面下半部就被壓扁
        side="left"
        align="start"
        sideOffset={8}
        // 上方多留一個頁首的高度，彈出層不蓋住 sticky 頁首；高度上限＝Radix 算出的可用高度，永遠在視窗內
        collisionPadding={{ top: 72, right: 16, bottom: 16, left: 16 }}
        className="flex max-h-(--radix-popover-content-available-height) w-[min(calc(100vw-2rem),32rem)] flex-col overflow-hidden rounded-none p-0"
        aria-label="篩選新聞"
      >
        <div className="shrink-0 border-b border-border-strong px-4 pt-3.5 pb-2">
          <p className="text-sm font-bold tracking-[0.04em]">篩選新聞</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-3.5">{fields}</div>
        <div className="flex shrink-0 gap-2 border-t bg-popover px-4 py-3">{actions}</div>
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
          {summary.map((text) => <li key={text} className="max-w-full rounded-sm border bg-muted px-2 py-0.5 leading-5 wrap-anywhere text-subtle">{text}</li>)}
        </ul>
      </div>
      <Button variant="ghost" className="shrink-0" disabled={disabled} onClick={() => { returnFocus.current = true; onClearAdvanced(); }} aria-label="清除進階新聞篩選">清除進階篩選</Button>
    </div>
  );
}

/** 載入＝燈質 Q：每則新聞約兩條 44px 的空白列，一道光帶掃過，並寫出「讀取中」（DESIGN.md 第 10 節） */
export function NewsListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="border-t" style={{ height: count * 88 }}>
      <LoadingRows label="讀取新聞中…" className="h-full" />
    </div>
  );
}
