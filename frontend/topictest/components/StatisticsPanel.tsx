import React from 'react';
import { motion } from 'motion/react';
import { BarChart3, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { PriceStatistics } from '../lib/types';
import { fmtPrice, fmtVolume } from '../lib/utils/format';

interface Props {
  stats: PriceStatistics;
}

export const StatisticsPanel: React.FC<Props> = ({ stats }) => {
  const items = [
    {
      label: '最高價',
      value: fmtPrice(stats.highest_price),
      icon: <ArrowUpRight size={18} />,
      color: 'text-red-500',
      bg: 'bg-red-50 dark:bg-red-900/30',
    },
    {
      label: '最低價',
      value: fmtPrice(stats.lowest_price),
      icon: <ArrowDownRight size={18} />,
      color: 'text-green-600 dark:text-green-400',
      bg: 'bg-green-50 dark:bg-green-900/30',
    },
    {
      label: '平均收盤價',
      value: fmtPrice(stats.average_close),
      icon: <BarChart3 size={18} />,
      color: 'text-blue-500',
      bg: 'bg-blue-50 dark:bg-blue-900/30',
    },
    {
      label: '總成交量',
      value: fmtVolume(stats.total_volume),
      icon: <BarChart3 size={18} />,
      color: 'text-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-900/30',
    },
    {
      label: '總成交金額',
      value: fmtVolume(stats.total_amount),
      icon: <BarChart3 size={18} />,
      color: 'text-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-900/30',
    },
    {
      label: '交易天數',
      value: `${stats.trading_days} 天`,
      icon: <Calendar size={18} />,
      color: 'text-gray-500',
      bg: 'bg-gray-50 dark:bg-gray-700',
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-4 flex items-center gap-2">
        <BarChart3 size={16} className="text-[#ffa95a]" />
        統計數據
        <span className="text-xs text-gray-400 dark:text-gray-500 font-normal">
          ({stats.start_date} ~ {stats.end_date})
        </span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.label}
            className="bg-white dark:bg-gray-800 rounded-xl p-4 border border-gray-100 dark:border-gray-700 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
          >
            <div className={`inline-flex p-2 rounded-lg ${item.bg} ${item.color} mb-2`}>
              {item.icon}
            </div>
            <div className="text-xs text-gray-400 dark:text-gray-500 mb-1">{item.label}</div>
            <div className="text-base font-bold text-gray-800 dark:text-gray-200 font-mono">{item.value}</div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
};
