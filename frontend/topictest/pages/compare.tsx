import React, { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'motion/react';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { fetchSymbols, fetchMultipleStocks } from '../lib/api/stock';
import type { MultiStockResponse } from '../lib/types';
import { StockSearch } from '../components/StockSearch';
import { DateRangePicker } from '../components/DateRangePicker';
import { ComparisonChart } from '../components/ComparisonChart';

function getDefaultDates() {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - 3);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export default function ComparePage() {
  const router = useRouter();
  const defaults = getDefaultDates();
  const [allSymbols, setAllSymbols] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(defaults.start);
  const [endDate, setEndDate] = useState(defaults.end);
  const [compareData, setCompareData] = useState<MultiStockResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSymbols().then(setAllSymbols).catch(() => {});
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

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900 flex flex-col items-center py-8 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-5xl flex flex-col gap-8">
        <motion.div
          className="flex items-center gap-3"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <button
            onClick={() => router.push('/')}
            className="p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={20} className="text-gray-500" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
              股海明燈
            </h2>
            <h1 className="text-2xl font-bold text-gray-900">多股比較</h1>
          </div>
        </motion.div>

        <motion.div
          className="bg-white rounded-2xl border border-gray-100 p-6 flex flex-col gap-5"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <div className="flex flex-col sm:flex-row gap-4">
            <StockSearch
              symbols={allSymbols.filter((s) => !selected.includes(s))}
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
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#fff9e6] border border-[#ffa95a]/20 text-sm font-mono text-[#b97a3a]"
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
