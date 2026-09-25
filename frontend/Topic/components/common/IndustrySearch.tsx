import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Factory } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';

export interface IndustryOption {
  industry: string;
  symbols: string[];
}

interface Props {
  stockInfos: StockInfo[];
  availableSymbols: string[];
  onSelect: (symbols: string[]) => void;
  className?: string;
}

const MAX_OPTIONS = 12;

export function buildIndustryOptions(stockInfos: StockInfo[], availableSymbols: string[]): IndustryOption[] {
  const available = new Set(availableSymbols.map((symbol) => symbol.trim().toUpperCase()));
  const groups = new Map<string, Set<string>>();
  for (const stock of stockInfos) {
    const symbol = stock.symbol.trim().toUpperCase();
    const industry = stock.industry?.trim();
    if (!industry || !available.has(symbol)) continue;
    const symbols = groups.get(industry) ?? new Set<string>();
    symbols.add(symbol);
    groups.set(industry, symbols);
  }
  return [...groups.entries()]
    .map(([industry, symbols]) => ({ industry, symbols: [...symbols].sort() }))
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

export function IndustrySearch({ stockInfos, availableSymbols, onSelect, className }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const options = useMemo(() => buildIndustryOptions(stockInfos, availableSymbols), [availableSymbols, stockInfos]);
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
    onSelect(option.symbols);
    reset();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      if (filtered.length === 0) return;
      event.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (activeIndex >= 0 && activeIndex < filtered.length) return selectOption(filtered[activeIndex]);
      if (filtered.length > 0) return selectOption(filtered[0]);
      return;
    }
    if (!open || filtered.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % filtered.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => (index <= 0 ? filtered.length - 1 : index - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const expanded = open && (filtered.length > 0 || Boolean(query.trim()) || options.length === 0);

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Factory size={17} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-brand" />
      <input
        type="text"
        role="combobox"
        aria-label="搜尋產業並加入股票"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(true)}
        placeholder="搜尋產業並加入..."
        className="h-11 w-full min-w-0 rounded-xl border border-input bg-muted pr-4 pl-10 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25 sm:text-sm"
      />
      {expanded ? (
        <ul id={listboxId} role="listbox" aria-label="產業選擇" className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-popover py-1 shadow-md">
          {filtered.map((option, index) => (
            <li
              key={option.industry}
              id={`${listboxId}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => selectOption(option)}
              onMouseEnter={() => setActiveIndex(index)}
              className={cn('cursor-pointer px-4 py-2.5 text-subtle transition-colors', index === activeIndex && 'bg-accent text-accent-foreground')}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{option.industry}</span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{option.symbols.length} 檔</span>
              </span>
              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">加入該產業尚未選取的股票</span>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li role="status" className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">
              {options.length === 0 ? '目前沒有可加入的產業。' : `找不到「${query.trim()}」相關產業。`}
            </li>
          ) : (
            <li role="status" className="border-t px-4 py-2 text-[11px] text-muted-foreground">
              選取後會加入該產業所有尚未選取的股票
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
