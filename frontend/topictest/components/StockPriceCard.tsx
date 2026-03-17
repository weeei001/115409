import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { DailyPriceResponse } from '../lib/types';

interface Props {
  data: DailyPriceResponse;
  onClick?: () => void;
  index?: number;
}

const STOCK_NAMES: Record<string, string> = {
  '2330': '台積電',
  '2317': '鴻海',
  '2454': '聯發科',
  '2881': '富邦金',
  '2882': '國泰金',
  '2303': '聯電',
  '2308': '台達電',
  '3711': '日月光投控',
  '2412': '中華電',
  '2886': '兆豐金',
};

export const StockPriceCard: React.FC<Props> = ({ data, onClick, index = 0 }) => {
  const close = Number(data.close ?? 0);
  const change = Number(data.change ?? 0);
  const prevClose = close - change;
  const changePct = prevClose !== 0 ? (change / prevClose) * 100 : 0;
  const isUp = change > 0;
  const isDown = change < 0;
  const isFlat = change === 0;

  const colorClass = isUp
    ? 'text-red-500'
    : isDown
      ? 'text-green-600'
      : 'text-gray-400';

  const bgHover = isUp
    ? 'hover:border-red-200 hover:bg-red-50/40'
    : isDown
      ? 'hover:border-green-200 hover:bg-green-50/40'
      : 'hover:border-gray-300 hover:bg-gray-50';

  const name = STOCK_NAMES[data.symbol] || '';

  return (
    <motion.button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border border-gray-200 bg-white px-5 py-4
                  transition-all cursor-pointer ${bgHover} shadow-sm hover:shadow-md`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: index * 0.06 }}
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <div className="text-lg font-bold text-gray-900 font-mono">{data.symbol}</div>
          {name && <div className="text-xs text-gray-400 mt-0.5">{name}</div>}
        </div>
        <div className={`flex items-center gap-0.5 text-xs font-medium px-2 py-1 rounded-full
                        ${isUp ? 'bg-red-50 text-red-500' : isDown ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-400'}`}>
          {isUp ? <TrendingUp size={12} /> : isDown ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span>{isUp ? '+' : ''}{changePct.toFixed(2)}%</span>
        </div>
      </div>

      <div className="flex items-end justify-between">
        <div className="text-2xl font-bold font-mono text-gray-900">
          {close.toFixed(2)}
        </div>
        <div className={`text-sm font-mono font-medium ${colorClass}`}>
          {isUp ? '+' : ''}{change.toFixed(2)}
        </div>
      </div>

      <div className="mt-2 text-[11px] text-gray-400">
        {data.date}
      </div>
    </motion.button>
  );
};
