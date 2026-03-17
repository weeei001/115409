import React from 'react';
import { motion } from 'motion/react';
import { BarChart3, Calendar, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import type { PriceStatistics } from '../lib/types';

interface Props {
  stats: PriceStatistics;
}

function fmtPrice(val: string | null | undefined) {
  if (val == null) return '--';
  return Number(val).toFixed(2);
}

function fmtVolume(val: number | null | undefined) {
  if (val == null) return '--';
  if (val >= 1e8) return `${(val / 1e8).toFixed(2)} 億`;
  if (val >= 1e4) return `${(val / 1e4).toFixed(1)} 萬`;
  return val.toLocaleString();
}

export const StatisticsPanel: React.FC<Props> = ({ stats }) => {
  const items = [
    {
      label: '最高價',
      value: fmtPrice(stats.highest_price),
      icon: <ArrowUpRight size={18} />,
      color: 'text-red-500',
      bg: 'bg-red-50',
    },
    {
      label: '最低價',
      value: fmtPrice(stats.lowest_price),
      icon: <ArrowDownRight size={18} />,
      color: 'text-green-600',
      bg: 'bg-green-50',
    },
    {
      label: '平均收盤價',
      value: fmtPrice(stats.average_close),
      icon: <BarChart3 size={18} />,
      color: 'text-blue-500',
      bg: 'bg-blue-50',
    },
    {
      label: '總成交量',
      value: fmtVolume(stats.total_volume),
      icon: <BarChart3 size={18} />,
      color: 'text-purple-500',
      bg: 'bg-purple-50',
    },
    {
      label: '總成交金額',
      value: fmtVolume(stats.total_amount),
      icon: <BarChart3 size={18} />,
      color: 'text-amber-500',
      bg: 'bg-amber-50',
    },
    {
      label: '交易天數',
      value: `${stats.trading_days} 天`,
      icon: <Calendar size={18} />,
      color: 'text-gray-500',
      bg: 'bg-gray-50',
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <h3 className="text-sm font-semibold text-gray-500 mb-4 flex items-center gap-2">
        <BarChart3 size={16} className="text-[#ffa95a]" />
        統計數據
        <span className="text-xs text-gray-400 font-normal">
          ({stats.start_date} ~ {stats.end_date})
        </span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.label}
            className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
          >
            <div className={`inline-flex p-2 rounded-lg ${item.bg} ${item.color} mb-2`}>
              {item.icon}
            </div>
            <div className="text-xs text-gray-400 mb-1">{item.label}</div>
            <div className="text-base font-bold text-gray-800 font-mono">{item.value}</div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
};
