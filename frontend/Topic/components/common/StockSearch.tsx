import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { hasBulkDelimiter } from '@/lib/utils/stockSelection';

interface Props {
  symbols: string[];
  onSelect: (symbol: string) => void;
  /** 按 Enter 送出輸入框內容，或貼上含分隔符的文字時呼叫 */
  onBulkSelect: (input: string) => void;
  placeholder?: string;
  className?: string;
}

const MAX_OPTIONS = 20;

/**
 * 股票代號 combobox（首頁、多股比較共用）。
 * focus 就展開；空白時照清單順序；有輸入時代號包含比對；最多 20 筆；方向鍵／Home／End／Esc；
 * Enter：有反白項目就選它；否則有輸入時交給 onBulkSelect，沒輸入時選第一筆。
 */
export function StockSearch({ symbols, onSelect, onBulkSelect, placeholder = '輸入股票代號...', className }: Props) {
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

  const filtered = useMemo(() => {
    const q = query.trim();
    if (q) return symbols.filter((s) => s.includes(q)).slice(0, MAX_OPTIONS);
    return symbols.slice(0, MAX_OPTIONS);
  }, [query, symbols]);

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
      e.preventDefault();
      setOpen(true);
      setActiveIndex(0);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 用方向鍵反白了某一項就送出那一項，不送輸入文字（決議 D9-c15）
      if (open && activeIndex >= 0 && activeIndex < filtered.length) return selectItem(filtered[activeIndex]);
      if (query.trim()) return commitInput(query);
      if (!open || filtered.length === 0) return;
      selectItem(filtered[0]);
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

  const expanded = open && filtered.length > 0;

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-label="搜尋股票代號"
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
        className="h-11 w-full min-w-0 rounded-xl border border-input bg-muted pr-4 pl-10 text-base text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-brand focus:ring-2 focus:ring-brand/25 sm:text-sm"
      />
      {expanded ? (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="股票代號"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border bg-popover py-1 shadow-md"
        >
          {filtered.map((symbol, i) => (
            <li
              key={symbol}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => selectItem(symbol)}
              onMouseEnter={() => setActiveIndex(i)}
              className={cn(
                'cursor-pointer px-4 py-2.5 font-mono text-sm text-subtle transition-colors',
                i === activeIndex && 'bg-accent text-accent-foreground',
              )}
            >
              {symbol}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
