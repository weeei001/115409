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
      color: 'text-up',
      bg: 'bg-up-muted',
    },
    {
      label: '最低價',
      value: fmtPrice(stats.lowest_price),
      icon: <ArrowDownRight size={18} />,
      color: 'text-down',
      bg: 'bg-down-muted',
    },
    {
      label: '平均收盤價',
      value: fmtPrice(stats.average_close),
      icon: <BarChart3 size={18} />,
      color: 'text-[#7B9EB8]',
      bg: 'bg-[#7B9EB8]/8 dark:bg-[#7B9EB8]/15',
    },
    {
      label: '總成交量',
      value: fmtVolume(stats.total_volume),
      icon: <BarChart3 size={18} />,
      color: 'text-[#9B8EC4]',
      bg: 'bg-[#9B8EC4]/8 dark:bg-[#9B8EC4]/15',
    },
    {
      label: '總成交金額',
      value: fmtVolume(stats.total_amount),
      icon: <BarChart3 size={18} />,
      color: 'text-brand',
      bg: 'bg-brand/8 dark:bg-brand/15',
    },
    {
      label: '交易天數',
      value: `${stats.trading_days} 天`,
      icon: <Calendar size={18} />,
      color: 'text-[var(--color-text-muted)]',
      bg: 'bg-[var(--color-bg-elevated)]',
    },
  ];

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.1 }}
    >
      <h3 className="text-sm font-semibold text-[var(--color-text-muted)] mb-4 flex items-center gap-2">
        <BarChart3 size={16} className="text-brand" />
        統計數據
        <span className="text-xs text-[var(--color-text-muted)] font-normal">
          ({stats.start_date} ~ {stats.end_date})
        </span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {items.map((item, i) => (
          <motion.div
            key={item.label}
            className="bg-[var(--color-bg-card)] rounded-xl p-4 border border-[var(--color-border)] shadow-sm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.15 + i * 0.05 }}
          >
            <div className={`inline-flex p-2 rounded-lg ${item.bg} ${item.color} mb-2`}>
              {item.icon}
            </div>
            <div className="text-xs text-[var(--color-text-muted)] mb-1">{item.label}</div>
            <div className="text-base font-bold text-[var(--color-text-primary)] font-mono">{item.value}</div>
          </motion.div>
        ))}
      </div>
    </motion.section>
  );
};
