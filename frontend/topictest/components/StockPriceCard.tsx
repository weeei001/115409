import React, { useCallback } from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DailyPriceResponse } from '../lib/types';

interface Props {
  data: DailyPriceResponse;
  /** 穩定引用時可搭配 React.memo 避免父層重 render 時不必要的子元件更新 */
  onNavigate?: (symbol: string) => void;
  index?: number;
}

const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2408': '南亞科',
  '2454': '聯發科',
  '2615': '萬海',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '3711': '日月光投控',
  '2412': '中華電',
  '2886': '兆豐金',
};

export const StockPriceCard = React.memo<Props>(function StockPriceCard({ data, onNavigate, index = 0 }) {
  const handleClick = useCallback(() => {
    onNavigate?.(data.symbol);
  }, [onNavigate, data.symbol]);

  const close = Number(data.close ?? 0);
  const change = Number(data.change ?? 0);
  const prevClose = close - change;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const isUp = change > 0;
  const isDown = change < 0;

  const colorClass = isUp
    ? 'text-red-500'
    : isDown
      ? 'text-green-600'
      : 'text-gray-400';

  const bgHover = isUp
    ? 'hover:border-red-200 hover:bg-red-50/40 dark:hover:bg-red-900/20'
    : isDown
      ? 'hover:border-green-200 hover:bg-green-50/40 dark:hover:bg-green-900/20'
      : 'hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700';

  const name = STOCK_NAMES[data.symbol] || '';

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      className={`w-full text-left rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-5 py-4
                  transition-all cursor-pointer ${bgHover} shadow-sm hover:shadow-md`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100 font-mono">{data.symbol}</div>
          {name && <div className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{name}</div>}
        </div>
        <div className={`flex items-center gap-0.5 text-xs font-medium px-2 py-1 rounded-full
                        ${isUp ? 'bg-red-50 dark:bg-red-900/30 text-red-500' : isDown ? 'bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
          {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span>{isUp ? '+' : ''}{changePct.toFixed(2)}%</span>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold font-mono text-gray-900 dark:text-gray-100">
          {close.toFixed(2)}
        </div>
        <div className={`text-sm font-mono font-medium ${colorClass}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        {data.date}
      </div>
    </motion.button>
  );
});
