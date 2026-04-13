import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import type { DailyPriceResponse } from '../lib/types';
import { fmt, fmtPrice } from '../lib/utils/format';

interface Props {
  data: DailyPriceResponse;
}

export const StockHeader: React.FC<Props> = ({ data }) => {
  const change = Number(data.change ?? 0);
  const close = Number(data.close ?? 0);
  const prevClose = close - change;
  const validPrev = prevClose > 0;
  const changePct = validPrev ? ((change / prevClose) * 100).toFixed(2) : null;
  const isUp = change >= 0;

  const infoItems = [
    { label: '開盤', value: fmtPrice(data.open) },
    { label: '最高', value: fmtPrice(data.high) },
    { label: '最低', value: fmtPrice(data.low) },
    { label: '成交量', value: fmt(data.volume_shares) },
    { label: '成交金額', value: data.amount != null ? `${(data.amount / 1e8).toFixed(2)} 億` : '--' },
    { label: '成交筆數', value: fmt(data.trades) },
  ];

  return (
    <motion.header
      className="w-full mb-8"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-baseline gap-3">
            {data.symbol}
            <span className="text-sm sm:text-base text-gray-400 dark:text-gray-500">{data.date}</span>
          </h1>
        </div>
        <div className="sm:text-right">
          <div className="text-2xl sm:text-4xl font-mono font-bold text-gray-900 dark:text-gray-100">
            {fmtPrice(data.close)}
          </div>
          <div className={`flex items-center sm:justify-end gap-1 text-sm font-medium ${isUp ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
            {isUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            <span>{isUp ? '+' : ''}{change.toFixed(2)}</span>
            <span>({changePct != null ? `${isUp ? '+' : ''}${changePct}%` : '--'})</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {infoItems.map((item) => (
          <div
            key={item.label}
            className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 border border-gray-100 dark:border-gray-700"
          >
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{item.label}</div>
            <div className="text-sm font-semibold text-gray-800 dark:text-gray-200 font-mono">{item.value}</div>
          </div>
        ))}
      </div>
    </motion.header>
  );
};
