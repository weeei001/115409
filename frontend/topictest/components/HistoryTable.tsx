import React from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HistoricalPriceList } from '../lib/types';

interface Props {
  data: HistoricalPriceList;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

function fmtPrice(v: string | null) {
  if (v == null) return '--';
  return Number(v).toFixed(2);
}

function fmtNum(v: number | null) {
  if (v == null) return '--';
  return v.toLocaleString();
}

export const HistoryTable: React.FC<Props> = ({ data, page, pageSize, onPageChange }) => {
  const totalPages = Math.max(1, Math.ceil(data.total / pageSize));

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
    >
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-500">
          歷史股價 <span className="text-xs text-gray-400 font-normal">共 {data.total} 筆</span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-30 hover:bg-gray-50 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-gray-100">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500 text-xs">
              <th className="text-left px-4 py-3 font-medium">日期</th>
              <th className="text-right px-4 py-3 font-medium">開盤</th>
              <th className="text-right px-4 py-3 font-medium">最高</th>
              <th className="text-right px-4 py-3 font-medium">最低</th>
              <th className="text-right px-4 py-3 font-medium">收盤</th>
              <th className="text-right px-4 py-3 font-medium">漲跌</th>
              <th className="text-right px-4 py-3 font-medium">成交量</th>
              <th className="text-right px-4 py-3 font-medium">成交金額</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((row) => {
              const change = Number(row.change ?? 0);
              const isUp = change >= 0;
              return (
                <tr key={row.date} className="border-t border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-gray-600">{row.date}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{fmtPrice(row.open)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-red-500">{fmtPrice(row.high)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-green-600">{fmtPrice(row.low)}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtPrice(row.close)}</td>
                  <td className={`px-4 py-2.5 text-right font-mono ${isUp ? 'text-red-500' : 'text-green-600'}`}>
                    {isUp ? '+' : ''}{fmtPrice(row.change)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500">{fmtNum(row.volume_shares)}</td>
                  <td className="px-4 py-2.5 text-right font-mono text-gray-500">
                    {row.amount != null ? `${(row.amount / 1e8).toFixed(2)}億` : '--'}
                  </td>
                </tr>
              );
            })}
            {data.data.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center text-gray-400 py-8">
                  無歷史資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.section>
  );
};
