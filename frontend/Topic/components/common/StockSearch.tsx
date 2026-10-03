import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';
import { hasBulkDelimiter } from '@/lib/utils/stockSelection';

interface Props {
  symbols: string[];
  stockInfos?: StockInfo[];
  onSelect: (symbol: string) => void;
  /** 按 Enter 送出輸入框內容，或貼上含分隔符的文字時呼叫 */
  onBulkSelect: (input: string) => void;
  placeholder?: string;
  className?: string;
}

const MAX_OPTIONS = 20;

export function searchStockOptions(symbols: string[], stockInfos: StockInfo[] = [], query: string, limit = MAX_OPTIONS): StockInfo[] {
  const infoBySymbol = new Map(stockInfos.map((stock) => [stock.symbol.toUpperCase(), stock]));
  const options = symbols.map((rawSymbol) => {
    const symbol = rawSymbol.trim().toUpperCase();
    return infoBySymbol.get(symbol) ?? { symbol, name: '', industry: null };
  });
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return options.slice(0, limit);

  return options
    .map((option) => {
      const symbol = option.symbol.toLocaleLowerCase();
      const name = option.name.toLocaleLowerCase();
      const industry = option.industry?.toLocaleLowerCase() ?? '';
      const rank = symbol === needle ? 0
        : symbol.startsWith(needle) ? 1
          : name.startsWith(needle) ? 2
            : industry.startsWith(needle) ? 3
              : symbol.includes(needle) || name.includes(needle) || industry.includes(needle) ? 4 : 99;
      return { option, rank };
    })
    .filter((item) => item.rank < 99)
    .sort((a, b) => a.rank - b.rank || a.option.symbol.localeCompare(b.option.symbol))
    .slice(0, limit)
    .map((item) => item.option);
}

/**
 * 股票代號 combobox（首頁、多股比較共用）。
 * focus 就展開；空白時照清單順序；可用代號、公司名稱與產業搜尋；最多 20 筆；方向鍵／Home／End／Esc；
 * Enter：有反白項目就選它；否則有輸入時交給 onBulkSelect，沒輸入時選第一筆。
 */
export function StockSearch({ symbols, stockInfos = [], onSelect, onBulkSelect, placeholder = '搜尋代號或公司名稱...', className }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const filtered = useMemo(() => searchStockOptions(symbols, stockInfos, query), [query, stockInfos, symbols]);

  const reset = () => {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const commitInput = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    onBulkSelect(text);
    reset();
  };

  const selectItem = (symbol: string) => {
    onSelect(symbol);
    reset();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      if (filtered.length === 0) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 用方向鍵反白了某一項就送出那一項，不送輸入文字（決議 D9-c15）
      if (open && activeIndex >= 0 && activeIndex < filtered.length) return selectItem(filtered[activeIndex].symbol);
      if (query.trim()) return commitInput(query);
      if (!open || filtered.length === 0) return;
      selectItem(filtered[0].symbol);
      return;
    }
    if (!open || filtered.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => (i + 1) % filtered.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(filtered.length - 1);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const expanded = open && (filtered.length > 0 || Boolean(query.trim()) || symbols.length === 0);

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-label="搜尋股票代號或公司名稱"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (!hasBulkDelimiter(pasted)) return;
          e.preventDefault();
          commitInput(pasted);
        }}
        onFocus={() => setOpen(true)}
        placeholder={placeholder}
        className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-4 pl-10 text-base text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus:border-border-strong focus-lamp sm:text-sm"
      />
      {expanded ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="股票代號"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-80 overflow-y-auto rounded-md border border-border-strong bg-popover shadow-raised"
        >
          {/* 反白／hover 的選項：淺色底＋左側 2px 燈色標線（lamp-row 讀 aria-selected） */}
          {filtered.map((stock, i) => (
            <li
              key={stock.symbol}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => selectItem(stock.symbol)}
              onMouseEnter={() => setActiveIndex(i)}
              className="lamp-row flex min-h-11 cursor-pointer flex-col justify-center border-b px-4 py-1.5 text-foreground"
            >
              <span className="flex min-w-0 items-baseline gap-3">
                <span className="w-12 shrink-0 font-mono text-[13.5px] font-medium tabular-nums">{stock.symbol}</span>
                <span className="min-w-0 truncate text-sm font-medium">{stock.name || '公司名稱未提供'}</span>
              </span>
              <span className="block truncate pl-[3.75rem] text-xs text-muted-foreground">
                {stock.industry?.trim() || '產業未提供'}
              </span>
            </li>
          ))}
          {filtered.length === 0 ? (
            <li role="status" className="px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              {hasBulkDelimiter(query) ? '按 Enter 套用貼上的多個股票代號。' : symbols.length === 0 ? '目前沒有可搜尋的股票。' : `找不到「${query.trim()}」；可改用股票代號或公司名稱。`}
            </li>
          ) : (
            <li role="status" className="bg-muted px-4 py-2 text-xs text-muted-foreground">
              可貼上多個代號，以空白、逗號或分號分隔
            </li>
          )}
        </ul>
      ) : null}
    </div>
  );
}
