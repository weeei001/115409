import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { CompareMetricsRow } from '../lib/types';
import type { CompareSortState } from '../lib/utils/compare';
import { sortMetricsRows } from '../lib/utils/compare';
import { fmtVolume } from '../lib/utils/format';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  rows: CompareMetricsRow[];
}

const headers: Array<{ key: keyof CompareMetricsRow; label: string }> = [
  { key: 'symbol', label: '股票' },
  { key: 'totalReturnPct', label: '區間報酬%' },
  { key: 'volatilityPct', label: '波動度%' },
  { key: 'maxDrawdownPct', label: '最大回撤%' },
  { key: 'winRatePct', label: '勝率%' },
  { key: 'maxDailyGainPct', label: '最大單日漲%' },
  { key: 'maxDailyLossPct', label: '最大單日跌%' },
  { key: 'avgVolume', label: '平均量' },
  { key: 'avgAmount', label: '平均金額' },
];

function fmtPct(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '--';
  return `${v.toFixed(2)}%`;
}

function fmtNum(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '--';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** 台股慣例：上漲紅、下跌綠 */
function twReturnClass(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v > 0) return 'text-red-600 dark:text-red-400 font-medium';
  if (v < 0) return 'text-emerald-600 dark:text-emerald-400 font-medium';
  return 'text-gray-800 dark:text-gray-200';
}

export const CompareMetricsTable: React.FC<Props> = ({ rows }) => {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [sort, setSort] = useState<CompareSortState>({ key: 'totalReturnPct', direction: 'desc' });

  const sortedRows = useMemo(() => sortMetricsRows(rows, sort), [rows, sort]);

  if (rows.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200/80 dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/80">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">比較指標表</h3>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100/80 dark:bg-gray-900/50">
              <tr>
                {headers.map((h) => (
                  <th key={h.key} className="px-4 py-3 text-left whitespace-nowrap">
                    <button
                      type="button"
                      className="font-semibold text-gray-600 dark:text-gray-300 hover:text-[#ffa95a] transition-colors cursor-pointer"
                      onClick={() =>
                        setSort((prev) => ({
                          key: h.key,
                          direction:
                            prev.key === h.key
                              ? prev.direction === 'asc'
                                ? 'desc'
                                : 'asc'
                              : h.key === 'symbol'
                                ? 'asc'
                                : 'desc',
                        }))
                      }
                    >
                      {h.label}
                      {sort.key === h.key ? (sort.direction === 'asc' ? ' ▲' : ' ▼') : ''}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr
                  key={r.symbol}
                  className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/70 dark:hover:bg-gray-700/30"
                >
                  <td className="px-4 py-3 font-mono font-semibold text-[#c2410c] dark:text-[#ffa95a]">{r.symbol}</td>
                  <td className={`px-4 py-3 tabular-nums ${twReturnClass(r.totalReturnPct)}`}>{fmtPct(r.totalReturnPct)}</td>
                  <td className="px-4 py-3">{fmtPct(r.volatilityPct)}</td>
                  <td className="px-4 py-3">{fmtPct(r.maxDrawdownPct)}</td>
                  <td className="px-4 py-3">{fmtPct(r.winRatePct)}</td>
                  <td className="px-4 py-3 text-red-500">{fmtPct(r.maxDailyGainPct)}</td>
                  <td className="px-4 py-3 text-green-600">{fmtPct(r.maxDailyLossPct)}</td>
                  <td className="px-4 py-3">{r.avgVolume == null ? '--' : fmtVolume(r.avgVolume)}</td>
                  <td className="px-4 py-3">{fmtNum(r.avgAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={`px-4 py-2 text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          點擊欄位標題可排序，空值以 -- 顯示。
        </div>
      </div>
    </motion.section>
  );
};
