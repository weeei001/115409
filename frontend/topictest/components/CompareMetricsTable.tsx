import React, { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { CompareMetricsRow } from '../lib/types';
import type { CompareSortState } from '../lib/utils/compare';
import { COMPARE_COLOR_PALETTE, sortMetricsRows } from '../lib/utils/compare';
import { fmtVolume } from '../lib/utils/format';
import { useTheme } from '../lib/ThemeContext';

interface Props {
  rows: CompareMetricsRow[];
  symbolColors?: Record<string, string>;
  calcVersion?: string;
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

function fallbackColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

export const CompareMetricsTable: React.FC<Props> = ({
  rows,
  symbolColors = {},
  calcVersion = 'frontend-calc-v1.0',
}) => {
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
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700/80 space-y-1">
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">比較指標表</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            前端運算公式：區間報酬=(末日收盤/首日收盤-1)、波動度=日報酬標準差、最大回撤=區間 NAV 峰值回落。
          </p>
        </div>
        <div className="overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100/80 dark:bg-gray-900/50">
              <tr>
                {headers.map((h) => (
                  <th key={h.key} className="px-4 py-3 text-left whitespace-nowrap">
                    <button
                      type="button"
                      className="font-semibold text-gray-600 dark:text-gray-300 hover:text-[#ea580c] transition-colors cursor-pointer"
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
              {sortedRows.map((r) => {
                const color = symbolColors[r.symbol] ?? fallbackColor(r.symbol);
                return (
                  <tr
                    key={r.symbol}
                    className="border-t border-gray-100 dark:border-gray-700 hover:bg-gray-50/70 dark:hover:bg-gray-700/30"
                  >
                    <td className="px-4 py-3 font-mono font-semibold text-[#c2410c] dark:text-[#fdba74]">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: color }}
                          aria-hidden
                        />
                        {r.symbol}
                      </span>
                    </td>
                    <td className={`px-4 py-3 tabular-nums ${twReturnClass(r.totalReturnPct)}`}>{fmtPct(r.totalReturnPct)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtPct(r.volatilityPct)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtPct(r.maxDrawdownPct)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtPct(r.winRatePct)}</td>
                    <td className={`px-4 py-3 tabular-nums ${twReturnClass(r.maxDailyGainPct)}`}>{fmtPct(r.maxDailyGainPct)}</td>
                    <td className={`px-4 py-3 tabular-nums ${twReturnClass(r.maxDailyLossPct)}`}>{fmtPct(r.maxDailyLossPct)}</td>
                    <td className="px-4 py-3 tabular-nums">{r.avgVolume == null ? '--' : fmtVolume(r.avgVolume)}</td>
                    <td className="px-4 py-3 tabular-nums">{fmtNum(r.avgAmount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className={`px-4 py-3 text-xs space-y-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          <p>點擊欄位標題可排序；空值以 -- 顯示。</p>
        </div>
      </div>
    </motion.section>
  );
};
