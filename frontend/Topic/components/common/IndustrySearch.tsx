import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Factory } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';

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

export function IndustrySearch({ stockInfos, supportedSymbols, selectedSymbols, onSelect, className }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const options = useMemo(() => buildIndustryOptions(stockInfos, supportedSymbols, selectedSymbols), [supportedSymbols, selectedSymbols, stockInfos]);
  const filtered = useMemo(() => searchIndustryOptions(options, query), [options, query]);

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
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
      setOpen(false);
      setActiveIndex(-1);
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

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Factory size={17} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-label="搜尋產業並加入股票"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={expanded && filtered[activeIndex]?.symbols.length > 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        placeholder="搜尋產業並加入..."
        className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-4 pl-10 text-base text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus:border-border-strong focus-lamp sm:text-sm"
      />
      {expanded ? (
        <ul id={listboxId} role="listbox" aria-label="產業選擇" className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border-strong bg-popover shadow-raised">
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
              <span className="block text-xs text-muted-foreground">{option.symbols.length > 0 ? '加入該產業尚未選取的支援股票' : option.allAdded ? '此產業的支援股票已全部加入。' : '目前沒有可加入的支援股票。'}</span>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li role="status" className="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {options.length === 0 ? '目前沒有支援股票的產業資料。' : `找不到「${query.trim()}」相關產業。`}
            </li>
          ) : (
            <li role="status" className="bg-muted px-4 py-2 text-xs text-muted-foreground">
              選取後會加入該產業尚未選取的支援股票
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
