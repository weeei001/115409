import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

interface Props {
  symbols: string[];
  onSelect: (symbol: string) => void;
  placeholder?: string;
  value?: string;
}

export const StockSearch: React.FC<Props> = ({
  symbols,
  onSelect,
  placeholder = '輸入股票代號...',
  value = '',
}) => {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
    return symbols.filter((s) => s.includes(query.trim())).slice(0, 20);
  }, [query, symbols]);

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <div className="relative">
        <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-800 dark:text-gray-200
                     focus:outline-none focus:ring-2 focus:ring-[#ffa95a]/30 focus:border-[#ffa95a]
                     bg-white dark:bg-gray-700 text-base shadow-sm"
        />
      </div>
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-600 shadow-lg z-50 max-h-60 overflow-y-auto">
          {filtered.map((s) => (
            <button
              key={s}
              onClick={() => {
                onSelect(s);
                setQuery(s);
                setOpen(false);
              }}
              className="w-full text-left px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-[#fff9e6] dark:hover:bg-[#ffa95a]/10 hover:text-[#ffa95a] transition-colors font-mono"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
