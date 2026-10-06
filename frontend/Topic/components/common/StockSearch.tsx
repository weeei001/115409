import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { StockInfo } from '@/lib/types/api';
import { hasBulkDelimiter } from '@/lib/utils/stockSelection';
import { ComboboxPopover, comboboxInputClass, useCombobox } from './Combobox';

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

/**
 * 股票代號 combobox（首頁、多股比較共用）。
 * focus 就展開；空白時照清單順序；可用代號、公司名稱與產業搜尋；最多 20 筆；方向鍵／Home／End／Esc；
 * Enter：有反白項目就選它；否則有輸入時交給 onBulkSelect，沒輸入時選第一筆。
 * 展開、反白、焦點離開或點外面就關，由 useCombobox 處理。
 */
export function StockSearch({ symbols, stockInfos = [], onSelect, onBulkSelect, placeholder = '搜尋代號或公司名稱…', className, bulkHint, autoFocus = false }: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const filtered = useMemo(() => searchStockOptions(symbols, stockInfos, query), [query, stockInfos, symbols]);
  const combobox = useCombobox({ itemCount: filtered.length });
  const { open, activeIndex, close } = combobox;

  const reset = () => {
    setQuery('');
    close();
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
    if (combobox.handleNavigationKey(e)) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      // 用方向鍵反白了某一項就送出那一項，不送輸入文字（決議 D9-c15）
      if (open && activeIndex >= 0 && activeIndex < filtered.length) return selectItem(filtered[activeIndex].symbol);
      if (query.trim()) return commitInput(query);
      if (!open || filtered.length === 0) return;
      selectItem(filtered[0].symbol);
      return;
    }
    // Esc 只在展開且有選項時攔下並關閉；其他時候不 preventDefault，交給外層
    if (e.key === 'Escape' && open && filtered.length > 0) {
      e.preventDefault();
      close();
    }
  };

  const expanded = open && (filtered.length > 0 || Boolean(query.trim()) || symbols.length === 0);
  const showList = expanded && filtered.length > 0;
  // 提示與「找不到」放在 listbox 外面（listbox 只能放 option），用 aria-describedby 接到輸入框（P2-063）
  const statusText = expanded ? stockSearchStatus({ query, matches: filtered.length, total: symbols.length, bulkHint }) : null;

  return (
    <div ref={combobox.rootRef} className={cn('relative w-full min-w-0', className)}>
      <Search size={18} aria-hidden className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        type="text"
        {...combobox.inputProps(showList, Boolean(statusText))}
        aria-label="搜尋股票代號或公司名稱"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          combobox.openFresh();
        }}
        onKeyDown={handleKeyDown}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text');
          if (!hasBulkDelimiter(pasted)) return;
          e.preventDefault();
          commitInput(pasted);
        }}
        placeholder={placeholder}
        className={comboboxInputClass}
      />
      {expanded ? (
        <ComboboxPopover combobox={combobox} showList={showList} listLabel="股票代號" statusText={statusText} empty={filtered.length === 0}>
          {/* 反白的選項：淺色底＋左側 2px 燈色標線（lamp-row 讀 aria-selected） */}
          {filtered.map((stock, i) => (
            <li
              key={stock.symbol}
              {...combobox.optionProps(i)}
              onClick={() => selectItem(stock.symbol)}
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
        </ComboboxPopover>
      ) : null}
    </div>
  );
}
