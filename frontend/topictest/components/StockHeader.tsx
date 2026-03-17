import React from 'react';
import { motion } from 'motion/react';
import { TrendingUp, TrendingDown, ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/router';
import type { DailyPriceResponse } from '../lib/types';
import { fmt, fmtPrice } from '../lib/utils/format';

interface Props {
  data: DailyPriceResponse;
}

export const StockHeader: React.FC<Props> = ({ data }) => {
  const router = useRouter();
  const change = Number(data.change ?? 0);
  const close = Number(data.close ?? 0);
  const prevClose = close - change;
  const changePct = prevClose !== 0 ? ((change / prevClose) * 100).toFixed(2) : '0.00';
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
      className="w-full max-w-5xl mb-8"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={() => router.push('/')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft size={20} className="text-gray-500 dark:text-gray-400" />
        </button>
        <h2 className="text-sm font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          股海明燈
        </h2>
      </div>

      <div className="flex justify-between items-end mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 flex items-baseline gap-3">
            {data.symbol}
            <span className="text-base text-gray-400 dark:text-gray-500">{data.date}</span>
          </h1>
        </div>
        <div className="text-right">
          <div className="text-4xl font-mono font-bold text-gray-900 dark:text-gray-100">
            {fmtPrice(data.close)}
          </div>
          <div className={`flex items-center justify-end gap-1 text-sm font-medium ${isUp ? 'text-red-500' : 'text-green-600 dark:text-green-400'}`}>
            {isUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
            <span>{isUp ? '+' : ''}{change.toFixed(2)}</span>
            <span>({isUp ? '+' : ''}{changePct}%)</span>
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
