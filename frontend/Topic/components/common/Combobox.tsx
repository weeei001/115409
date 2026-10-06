import React, { useEffect, useId, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * 搜尋 combobox 的輸入框外觀（股票、產業搜尋共用）：左側留 pl-10 給圖示。
 * 和 components/ui/input.tsx 的 inputClass 不同（rounded-md、沒有 outline-none／ease-flash／disabled／aria-invalid），維持原樣不併。
 */
export const comboboxInputClass =
  'h-11 w-full min-w-0 rounded-md border border-input bg-card pr-4 pl-10 text-base text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus-lamp sm:text-sm';

/** 焦點移到 root 以外（Tab 離開、Android 鍵盤的「下一個」）：下拉要關（P1-20、03-F7） */
export function focusLeftCombobox(root: Pick<Node, 'contains'> | null, next: EventTarget | null): boolean {
  return !root || !next || !root.contains(next as Node);
}

/**
 * 展開時的方向鍵／Home／End：只在可選項（selectable，由小到大的索引）之間移動反白，頭尾循環。
 * 沒有反白時往下是第一項、往上是最後一項。不是這幾個鍵、或沒有可選項時回傳 null。
 */
export function moveActiveIndex(key: string, selectable: readonly number[], activeIndex: number): number | null {
  if (selectable.length === 0) return null;
  const position = selectable.indexOf(activeIndex);
  switch (key) {
    case 'ArrowDown':
      return selectable[(position + 1) % selectable.length];
    case 'ArrowUp':
      return selectable[position <= 0 ? selectable.length - 1 : position - 1];
    case 'Home':
      return selectable[0];
    case 'End':
      return selectable[selectable.length - 1];
    default:
      return null;
  }
}

interface ComboboxOptions {
  /** 下拉裡的選項數 */
  itemCount: number;
  /** 哪些選項可選（不傳＝全部可選）；不可選的選項不反白、方向鍵跳過，並標 aria-disabled */
  isSelectable?: (index: number) => boolean;
}

/**
 * 搜尋 combobox 的共用狀態（StockSearch、IndustrySearch）：展開／反白、點外面就關、焦點離開就關、
 * 方向鍵／Home／End 移動反白，以及輸入框與選項的 ARIA 屬性。
 * Enter、Esc 與輸入文字各元件規則不同，留在元件自己處理。關閉時一併清掉反白（aria-activedescendant 不會指向不存在的選項）。
 */
export function useCombobox({ itemCount, isSelectable }: ComboboxOptions) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const statusId = useId();
  const selectable: number[] = [];
  for (let i = 0; i < itemCount; i++) if (!isSelectable || isSelectable(i)) selectable.push(i);

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  /** 輸入文字改變：展開並清掉反白 */
  const openFresh = () => {
    setOpen(true);
    setActiveIndex(-1);
  };

  useEffect(() => {
    // 點外面就關，並清掉反白（P2-063）；pointerdown 同時涵蓋滑鼠與觸控
    const onDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  /**
   * 收起時按上下鍵：有可選項就展開並反白第一個可選項；展開時用方向鍵／Home／End 移動反白。
   * 這個按鍵已處理（元件不必再看）時回傳 true。
   */
  const handleNavigationKey = (event: React.KeyboardEvent<HTMLInputElement>): boolean => {
    if (!open) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return false;
      if (selectable.length > 0) {
        event.preventDefault();
        setOpen(true);
        setActiveIndex(selectable[0]);
      }
      return true;
    }
    const next = moveActiveIndex(event.key, selectable, activeIndex);
    if (next === null) return false;
    event.preventDefault();
    setActiveIndex(next);
    return true;
  };

  const optionId = (index: number) => `${listboxId}-option-${index}`;

  /** 輸入框的 combobox 屬性與焦點處理；showList＝清單有畫出來，hasStatus＝下拉有提示列 */
  const inputProps = (showList: boolean, hasStatus: boolean) => ({
    role: 'combobox' as const,
    'aria-expanded': showList,
    'aria-controls': showList ? listboxId : undefined,
    'aria-autocomplete': 'list' as const,
    'aria-activedescendant': showList && selectable.includes(activeIndex) ? optionId(activeIndex) : undefined,
    'aria-describedby': hasStatus ? statusId : undefined,
    onFocus: () => setOpen(true),
    onBlur: (event: React.FocusEvent<HTMLInputElement>) => {
      // Tab 離開就關，不蓋住後面的欄位（P1-20、03-F7）
      if (focusLeftCombobox(rootRef.current, event.relatedTarget)) close();
    },
  });

  /** 選項 li 的共用屬性；onClick 與外觀由元件決定 */
  const optionProps = (index: number) => {
    const enabled = !isSelectable || isSelectable(index);
    return {
      id: optionId(index),
      role: 'option' as const,
      'aria-selected': enabled && index === activeIndex,
      'aria-disabled': isSelectable ? !enabled : undefined,
      // 先擋掉 mousedown：點選項時輸入框不會先失焦把清單關掉
      onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
      onMouseEnter: () => setActiveIndex(enabled ? index : -1),
    };
  };

  return { open, activeIndex, rootRef, listboxId, statusId, close, openFresh, handleNavigationKey, inputProps, optionProps };
}

interface PopoverProps {
  combobox: Pick<ReturnType<typeof useCombobox>, 'listboxId' | 'statusId'>;
  /** 清單有沒有畫出來（有符合的選項） */
  showList: boolean;
  listLabel: string;
  /** 清單外的提示列（listbox 只能放 option，提示與「找不到」放在外面，用 aria-describedby 接到輸入框，P2-063） */
  statusText: string | null;
  /** 沒有任何選項：提示列改成 status、字級與內距較大 */
  empty: boolean;
  /** 選項（li） */
  children: React.ReactNode;
}

/** combobox 的下拉框：選項清單（tabIndex -1，焦點一直留在輸入框）＋底部提示列 */
export function ComboboxPopover({ combobox, showList, listLabel, statusText, empty, children }: PopoverProps) {
  return (
    <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border-strong bg-popover shadow-raised">
      {showList ? (
        <ul id={combobox.listboxId} role="listbox" aria-label={listLabel} tabIndex={-1} className="max-h-80 overflow-y-auto">
          {children}
        </ul>
      ) : null}
      {statusText ? (
        <p
          id={combobox.statusId}
          role={empty ? 'status' : undefined}
          className={cn('text-muted-foreground', empty ? 'px-4 py-3 text-[13px] leading-relaxed' : 'bg-muted px-4 py-2 text-xs')}
        >
          {statusText}
        </p>
      ) : null}
    </div>
  );
}
