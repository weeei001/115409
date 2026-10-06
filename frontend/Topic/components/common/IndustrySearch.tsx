import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Factory } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';
import { focusLeftCombobox } from './StockSearch';

export interface IndustryOption {
  industry: string;
  symbols: string[];
  allAdded: boolean;
}

interface Props {
  stockInfos: StockInfo[];
  supportedSymbols: string[];
  selectedSymbols: string[];
  onSelect: (symbols: string[]) => void;
  className?: string;
}

const MAX_OPTIONS = 12;

export function buildIndustryOptions(stockInfos: StockInfo[], supportedSymbols: string[], selectedSymbols: string[] = []): IndustryOption[] {
  const supported = new Set(supportedSymbols.map((symbol) => symbol.trim().toUpperCase()));
  const selected = new Set(selectedSymbols.map((symbol) => symbol.trim().toUpperCase()));
  const groups = new Map<string, Set<string>>();
  for (const stock of stockInfos) {
    const symbol = stock.symbol.trim().toUpperCase();
    const industry = stock.industry?.trim();
    if (!industry || !supported.has(symbol)) continue;
    const symbols = groups.get(industry) ?? new Set<string>();
    symbols.add(symbol);
    groups.set(industry, symbols);
  }
  return [...groups.entries()]
    .map(([industry, symbols]) => ({ industry, symbols: [...symbols].filter((symbol) => !selected.has(symbol)).sort(), allAdded: [...symbols].every((symbol) => selected.has(symbol)) }))
    .sort((a, b) => a.industry.localeCompare(b.industry, 'zh-Hant'));
}

export function searchIndustryOptions(options: IndustryOption[], query: string, limit = MAX_OPTIONS): IndustryOption[] {
  const needle = query.trim().toLocaleLowerCase();
  return options
    .map((option) => {
      const industry = option.industry.toLocaleLowerCase();
      const rank = !needle ? 0 : industry === needle ? 1 : industry.startsWith(needle) ? 2 : industry.includes(needle) ? 3 : 99;
      return { option, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || b.option.symbols.length - a.option.symbols.length || a.option.industry.localeCompare(b.option.industry, 'zh-Hant'))
    .slice(0, limit)
    .map((item) => item.option);
}

/** 每個產業選項底下的說明（P2-065：不用「支援股票」這種系統視角的說法） */
export function industryOptionNote(option: IndustryOption): string {
  if (option.symbols.length > 0) return '加入這個產業還沒選的股票';
  return option.allAdded ? '這個產業的股票都已加入。' : '目前沒有可加入的股票。';
}

export function IndustrySearch({ stockInfos, supportedSymbols, selectedSymbols, onSelect, className }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const statusId = useId();
  const options = useMemo(() => buildIndustryOptions(stockInfos, supportedSymbols, selectedSymbols), [supportedSymbols, selectedSymbols, stockInfos]);
  const filtered = useMemo(() => searchIndustryOptions(options, query), [options, query]);

  const close = () => {
    setOpen(false);
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

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const selectOption = (option: IndustryOption) => {
    if (option.symbols.length === 0) return;
    onSelect(option.symbols);
    reset();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const selectable = filtered.flatMap((option, index) => option.symbols.length > 0 ? [index] : []);
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (selectable.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex(selectable[0]);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (selectable.includes(activeIndex)) return selectOption(filtered[activeIndex]);
      if (selectable.length > 0) return selectOption(filtered[selectable[0]]);
      return;
    }
    if (!open || selectable.length === 0) return;
    const position = selectable.indexOf(activeIndex);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex(selectable[(position + 1) % selectable.length]);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex(selectable[position <= 0 ? selectable.length - 1 : position - 1]);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(selectable[0]);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(selectable[selectable.length - 1]);
        break;
    }
  };

  const expanded = open && (filtered.length > 0 || Boolean(query.trim()) || options.length === 0);
  const showList = expanded && filtered.length > 0;
  // 提示與「找不到」放在 listbox 外面（listbox 只能放 option），用 aria-describedby 接到輸入框（P2-063）
  const statusText = !expanded
    ? null
    : filtered.length === 0
      ? options.length === 0 ? '目前沒有產業資料。' : `找不到「${query.trim()}」相關產業。`
      : '選取後會加入這個產業還沒選的股票';

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Factory size={17} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-label="搜尋產業並加入股票"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && filtered[activeIndex]?.symbols.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-describedby={statusText ? statusId : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        onBlur={(event) => {
          // Tab 離開就關，不蓋住後面的欄位（P1-20、03-F7）
          if (focusLeftCombobox(rootRef.current, event.relatedTarget)) close();
        }}
        placeholder="搜尋產業並加入…"
        className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-4 pl-10 text-base text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus-lamp sm:text-sm"
      />
      {expanded ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border-strong bg-popover shadow-raised">
          {showList ? (
            <ul id={listboxId} role="listbox" aria-label="產業選擇" tabIndex={-1} className="max-h-80 overflow-y-auto">
              {/* 可選的產業用 lamp-row（反白時淺色底＋左側 2px 燈色標線）；已全部加入或無可加入的產業不反白 */}
              {filtered.map((option, index) => (
                <li
                  key={option.industry}
                  id={`${listboxId}-option-${index}`}
                  role="option"
                  aria-disabled={option.symbols.length === 0}
                  aria-selected={option.symbols.length > 0 && index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                  onMouseEnter={() => setActiveIndex(option.symbols.length > 0 ? index : -1)}
                  className={cn('flex min-h-11 flex-col justify-center border-b px-4 py-1.5', option.symbols.length === 0 ? 'cursor-default text-muted-foreground' : 'lamp-row cursor-pointer text-foreground')}
                >
                  <span className="flex min-w-0 items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm font-medium">{option.industry}</span>
                    {option.symbols.length > 0 ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{option.symbols.length} 檔</span> : null}
                  </span>
                  <span className="block text-xs text-muted-foreground">{industryOptionNote(option)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {statusText ? (
            <p
              id={statusId}
              role={filtered.length === 0 ? 'status' : undefined}
              className={cn('text-muted-foreground', filtered.length === 0 ? 'px-4 py-3 text-[13px] leading-relaxed' : 'bg-muted px-4 py-2 text-xs')}
            >
              {statusText}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
