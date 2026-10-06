import React, { useMemo, useState } from 'react';
import { Factory } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';
import { ComboboxPopover, comboboxInputClass, useCombobox } from './Combobox';

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
  const options = useMemo(() => buildIndustryOptions(stockInfos, supportedSymbols, selectedSymbols), [supportedSymbols, selectedSymbols, stockInfos]);
  const filtered = useMemo(() => searchIndustryOptions(options, query), [options, query]);
  // 已全部加入或無可加入的產業不能選：不反白、方向鍵跳過
  const combobox = useCombobox({ itemCount: filtered.length, isSelectable: (index) => filtered[index].symbols.length > 0 });
  const { open, activeIndex, close } = combobox;

  const reset = () => {
    setQuery('');
    close();
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
    if (combobox.handleNavigationKey(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      // 有反白就選它；否則選第一個可選的產業
      if (filtered[activeIndex]?.symbols.length > 0) return selectOption(filtered[activeIndex]);
      const first = filtered.find((option) => option.symbols.length > 0);
      if (first) selectOption(first);
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
    <div ref={combobox.rootRef} className={cn('relative w-full min-w-0', className)}>
      <Factory size={17} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        {...combobox.inputProps(showList, Boolean(statusText))}
        aria-label="搜尋產業並加入股票"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          combobox.openFresh();
        }}
        onKeyDown={handleKeyDown}
        placeholder="搜尋產業並加入…"
        className={comboboxInputClass}
      />
      {expanded ? (
        <ComboboxPopover combobox={combobox} showList={showList} listLabel="產業選擇" statusText={statusText} empty={filtered.length === 0}>
          {/* 可選的產業用 lamp-row（反白時淺色底＋左側 2px 燈色標線）；已全部加入或無可加入的產業不反白 */}
          {filtered.map((option, index) => (
            <li
              key={option.industry}
              {...combobox.optionProps(index)}
              onClick={() => selectOption(option)}
              className={cn('flex min-h-11 flex-col justify-center border-b px-4 py-1.5', option.symbols.length === 0 ? 'cursor-default text-muted-foreground' : 'lamp-row cursor-pointer text-foreground')}
            >
              <span className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium">{option.industry}</span>
                {option.symbols.length > 0 ? <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{option.symbols.length} 檔</span> : null}
              </span>
              <span className="block text-xs text-muted-foreground">{industryOptionNote(option)}</span>
            </li>
          ))}
        </ComboboxPopover>
      ) : null}
    </div>
  );
}
