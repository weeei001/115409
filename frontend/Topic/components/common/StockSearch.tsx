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
  /**
   * 下拉底部的提示（P2-064）：只在 onBulkSelect 真的會處理多個代號的地方傳，
   * 例如多股比較「可貼上多個代號…」、頁首「貼上多個代號會開啟多股比較」。不傳就不顯示。
   */
  bulkHint?: string;
  /** 打開後直接把游標放進輸入框（小螢幕頁首按搜尋鈕後展開的那一列） */
  autoFocus?: boolean;
}

const MAX_OPTIONS = 20;

/** 多股比較的搜尋：貼上的多個代號會全部加入已選清單 */
export const STOCK_SEARCH_BULK_HINT_COMPARE = '可貼上多個代號，以空白、逗號或分號分隔';

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

/** 下拉清單外的提示列：沒有結果時說明原因；有結果時只在會處理多個代號的地方顯示 bulkHint */
export function stockSearchStatus({ query, matches, total, bulkHint }: { query: string; matches: number; total: number; bulkHint?: string }): string | null {
  if (matches > 0) return bulkHint ?? null;
  if (hasBulkDelimiter(query)) return '按 Enter 套用貼上的多個股票代號。';
  if (total === 0) return '目前沒有可搜尋的股票。';
  return `找不到「${query.trim()}」；可改用股票代號或公司名稱。`;
}

/** 焦點移到 root 以外（Tab 離開、Android 鍵盤的「下一個」）：下拉要關（P1-20、03-F7） */
export function focusLeftCombobox(root: Pick<Node, 'contains'> | null, next: EventTarget | null): boolean {
  return !root || !next || !root.contains(next as Node);
}

/**
 * 股票代號 combobox（首頁、多股比較共用）。
 * focus 就展開；空白時照清單順序；可用代號、公司名稱與產業搜尋；最多 20 筆；方向鍵／Home／End／Esc；
 * Enter：有反白項目就選它；否則有輸入時交給 onBulkSelect，沒輸入時選第一筆。
 * 焦點離開或點外面就關，關閉時一併清掉反白（aria-activedescendant 不會指向不存在的選項）。
 */
export function StockSearch({ symbols, stockInfos = [], onSelect, onBulkSelect, placeholder = '搜尋代號或公司名稱…', className, bulkHint, autoFocus = false }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();
  const statusId = useId();

  const close = () => {
    setOpen(false);
    setActiveIndex(-1);
  };

  useEffect(() => {
    // pointerdown 同時涵蓋滑鼠與觸控
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

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
        close();
        break;
    }
  };

  const expanded = open && (filtered.length > 0 || Boolean(query.trim()) || symbols.length === 0);
  const showList = expanded && filtered.length > 0;
  // 提示與「找不到」放在 listbox 外面（listbox 只能放 option），用 aria-describedby 接到輸入框（P2-063）
  const statusText = expanded ? stockSearchStatus({ query, matches: filtered.length, total: symbols.length, bulkHint }) : null;

  return (
    <div ref={rootRef} className={cn('relative w-full min-w-0', className)}>
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-label="搜尋股票代號或公司名稱"
        aria-expanded={showList}
        aria-controls={showList ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeIndex >= 0 && activeIndex < filtered.length ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-describedby={statusText ? statusId : undefined}
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
        onBlur={(e) => {
          if (focusLeftCombobox(rootRef.current, e.relatedTarget)) close();
        }}
        placeholder={placeholder}
        className="h-11 w-full min-w-0 rounded-md border border-input bg-card pr-4 pl-10 text-base text-foreground transition-colors duration-(--dur-flash) placeholder:text-muted-foreground hover:border-border-strong focus-lamp sm:text-sm"
      />
      {expanded ? (
        <div className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-md border border-border-strong bg-popover shadow-raised">
          {showList ? (
            <ul id={listboxId} role="listbox" aria-label="股票代號" tabIndex={-1} className="max-h-80 overflow-y-auto">
              {/* 反白的選項：淺色底＋左側 2px 燈色標線（lamp-row 讀 aria-selected）；清單 tabIndex -1，焦點一直留在輸入框 */}
              {filtered.map((stock, i) => (
                <li
                  key={stock.symbol}
                  id={`${listboxId}-option-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  // 先擋掉 mousedown：點選項時輸入框不會先失焦把清單關掉
                  onMouseDown={(event) => event.preventDefault()}
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
