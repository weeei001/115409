import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { ArrowLeft, X } from 'lucide-react';
import { fetchSymbols, fetchMultipleStocks } from '../lib/api/stock';
import type { MultiStockResponse } from '../lib/types';
import { getDefaultDateRange } from '../lib/utils/date';
import { StockSearch } from '../components/StockSearch';
import { DateRangePicker } from '../components/DateRangePicker';
import { ComparisonChart } from '../components/ComparisonChart';
import { ThemeToggle } from '../components/ThemeToggle';

export default function ComparePage() {
  const router = useRouter();
  const defaults = getDefaultDateRange();
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [compareData, setCompareData] = useState<MultiStockResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSymbols()
      .then(setAllSymbols)
      .catch((err) => setError(err instanceof Error ? err.message : '無法載入股票清單'));
  }, []);

  const handleCompare = useCallback(async () => {
    if (selected.length < 2) {
      setError('請至少選擇 2 支股票');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetchMultipleStocks(selected.join(','), startDate, endDate);
      setCompareData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : '載入比較資料失敗');
    } finally {
      setLoading(false);
    }
  }, [selected, startDate, endDate]);

  const addSymbol = (sym: string) => {
    if (selected.includes(sym)) return;
    if (selected.length >= 10) {
      setError('最多比較 10 支股票');
      return;
    }
    setSelected((prev) => [...prev, sym]);
  };

  const removeSymbol = (sym: string) => {
    setSelected((prev) => prev.filter((s) => s !== sym));
  };

  const availableSymbols = useMemo(
    () => allSymbols.filter((s) => !selected.includes(s)),
    [allSymbols, selected]
  );

  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl flex flex-col gap-8">
        <motion.div
          className="flex items-center justify-between"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/')}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowLeft size={20} className="text-gray-500 dark:text-gray-400" />
            </button>
            <div>
              <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                股海明燈
              </h2>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">多股比較</h1>
            </div>
          </div>
          <ThemeToggle />
        </motion.div>

        <motion.div
          className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 flex flex-col gap-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex flex-col sm:flex-row gap-4">
            <StockSearch
              symbols={availableSymbols}
              onSelect={addSymbol}
              placeholder="新增股票代號..."
            />
            <DateRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((sym) => (
                <span
                  key={sym}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#fff9e6] dark:bg-[#ffa95a]/10 border border-[#ffa95a]/20 text-sm font-mono text-[#b97a3a] dark:text-[#ffa95a]"
                >
                  {sym}
                  <button onClick={() => removeSymbol(sym)} className="hover:text-red-500 transition-colors">
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {error && <div className="text-red-500 text-sm">{error}</div>}

          <button
            onClick={handleCompare}
            disabled={loading || selected.length < 2}
            className="self-start px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#ffa95a] to-[#ffd45a] text-white font-medium
                       hover:shadow-lg hover:shadow-[#ffa95a]/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? '載入中...' : '開始比較'}
          </button>
        </motion.div>

        {compareData && <ComparisonChart data={compareData} />}
      </div>
    </div>
  );
}
