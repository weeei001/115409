import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { clsx } from 'clsx';
import type { BulkSelectResult } from '../lib/types';

interface Props {
  symbols: string[];
  stockNames?: Record<string, string>;
  onSelect: (symbol: string) => void;
  onBulkSelect: (input: string) => BulkSelectResult;
  maxSelection: number;
  selectedCount: number;
  placeholder?: string;
  value?: string;
  className?: string;
}

export const StockSearch: React.FC<Props> = ({
  symbols,
  stockNames,
  onSelect,
  onBulkSelect,
  maxSelection,
  selectedCount,
  placeholder = '輸入股票代號...',
  value = '',
  className,
}) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query.trim()) return symbols.slice(0, 20);
    const keyword = query.trim().toUpperCase();
    return symbols.filter((s) => s.includes(keyword) || stockNames?.[s]?.includes(query.trim())).slice(0, 20);
  }, [query, stockNames, symbols]);

  const commitBulkInput = (rawInput: string) => {
    const text = rawInput.trim();
    if (!text) return;
    onBulkSelect(text);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const selectItem = (sym: string) => {
    onSelect(sym);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true);
      setActiveIndex(0);
      e.preventDefault();
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (query.trim()) {
        commitBulkInput(query);
        return;
      }
      if (!open || filtered.length === 0) return;
      if (activeIndex >= 0 && activeIndex < filtered.length) {
        selectItem(filtered[activeIndex]);
      } else {
        selectItem(filtered[0]);
      }
      return;
    }

    if (!open || filtered.length === 0) {
      return;
    }

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

  const isExpanded = open && filtered.length > 0;
  const activeDescendant = activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined;

  return (
    <div ref={ref} className={clsx('relative w-full min-h-0', !className && 'max-w-md', className)}>
      <div className="relative h-11">
        <Search size={18} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          type="text"
          role="combobox"
          aria-label="搜尋股票代號"
          aria-expanded={isExpanded}
          aria-controls={isExpanded ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeDescendant}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const pastedText = e.clipboardData.getData('text');
            if (!/[\s,，;；|]/.test(pastedText)) return;
            e.preventDefault();
            commitBulkInput(pastedText);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-11 w-full min-w-0 box-border pl-10 pr-4 text-sm leading-none rounded-2xl border border-[var(--color-border)] text-[var(--color-text-primary)]
                     focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                     bg-[var(--color-bg-elevated)] shadow-sm"
        />
      </div>
      {isExpanded ? (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 z-50 mt-1 max-h-60 overflow-y-auto rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-card)] shadow-lg"
        >
          {filtered.map((s, i) => (
            <li
              key={s}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => selectItem(s)}
              onMouseEnter={() => setActiveIndex(i)}
              className={clsx(
                'w-full cursor-pointer px-4 py-2.5 text-left font-mono text-sm text-[var(--color-text-secondary)] transition-colors hover:bg-brand/10 hover:text-brand',
                i === activeIndex && 'bg-brand/10 text-brand',
              )}
            >
              {stockNames?.[s] ? `${s} ${stockNames[s]}` : s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};
