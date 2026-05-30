import React, { useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { CompareMetricsRow } from '../lib/types';
import type { CompareSortState } from '../lib/utils/compare';
import { COMPARE_COLOR_PALETTE, sortMetricsRows } from '../lib/utils/compare';
import { fmtPercent, fmtVolume } from '../lib/utils/format';
import { TableScrollHint } from './TableScrollHint';

function fallbackSymbolColor(symbol: string): string {
  let hash = 0;
  for (let i = 0; i < symbol.length; i += 1) {
    hash = (hash << 5) - hash + symbol.charCodeAt(i);
    hash |= 0;
  }
  return COMPARE_COLOR_PALETTE[Math.abs(hash) % COMPARE_COLOR_PALETTE.length];
}

interface Props {
  rows: CompareMetricsRow[];
  symbolColors?: Record<string, string>;
  calcVersion?: string;
}

const headers: Array<{ key: keyof CompareMetricsRow; label: string; title?: string }> = [
  { key: 'symbol', label: '股票' },
  { key: 'totalReturnPct', label: '區間報酬%' },
  { key: 'volatilityPct', label: '年化波動%', title: '日報酬標準差 × √252 × 100%' },
  { key: 'maxDrawdownPct', label: '最大回撤%' },
  { key: 'winRatePct', label: '勝率%' },
  { key: 'maxDailyGainPct', label: '最大單日漲%' },
  { key: 'maxDailyLossPct', label: '最大單日跌%' },
  { key: 'avgVolume', label: '平均量' },
  { key: 'avgAmount', label: '平均金額' },
];

function fmtNum(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '--';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** 台股慣例：上漲紅、下跌綠 */
function twReturnClass(v: number | null): string {
  if (v == null || Number.isNaN(v)) return '';
  if (v > 0) return 'text-up font-medium';
  if (v < 0) return 'text-down font-medium';
  return 'text-[var(--color-text-primary)]';
}

export const CompareMetricsTable: React.FC<Props> = ({ rows, symbolColors = {} }) => {
  const [sort, setSort] = useState<CompareSortState>({ key: 'totalReturnPct', direction: 'desc' });
  const scrollRef = useRef<HTMLDivElement>(null);

  const sortedRows = useMemo(() => sortMetricsRows(rows, sort), [rows, sort]);

  if (rows.length === 0) return null;

  return (
    <motion.section
      role="region"
      aria-label="股票比較指標表"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <div className="bg-[var(--color-bg-card)] rounded-2xl border border-[var(--color-border)] shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)]">
          <h3 className="text-base font-bold text-[var(--color-text-primary)]">比較指標表</h3>
        </div>
        <TableScrollHint scrollRef={scrollRef} className="px-5" />
        <div ref={scrollRef} className="overflow-x-auto touch-pan-x overscroll-x-contain">
          <table className="w-full text-sm">
            <thead className="bg-[var(--color-bg-elevated)]">
              <tr>
                {headers.map((h) => (
                  <th key={h.key} scope="col" className="px-3 sm:px-4 py-3 text-left whitespace-nowrap">
                    <button
                      type="button"
                      title={h.title}
                      className="font-semibold text-[var(--color-text-secondary)] hover:text-brand transition-colors cursor-pointer"
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
                  className="border-t border-[var(--color-border)] hover:bg-[color-mix(in_srgb,var(--color-bg-elevated)_85%,transparent)]"
                >
                  <td
                    className="px-3 sm:px-4 py-3 font-mono font-semibold whitespace-nowrap"
                    style={{ color: symbolColors[r.symbol] ?? fallbackSymbolColor(r.symbol) }}
                  >
                    {r.symbol}
                  </td>
                  <td className={`px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap ${twReturnClass(r.totalReturnPct)}`}>
                    {fmtPercent(r.totalReturnPct)}
                  </td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap">{fmtPercent(r.volatilityPct)}</td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap">{fmtPercent(r.maxDrawdownPct)}</td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap">{fmtPercent(r.winRatePct)}</td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap text-up">{fmtPercent(r.maxDailyGainPct)}</td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap text-down">{fmtPercent(r.maxDailyLossPct)}</td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap">
                    {r.avgVolume == null ? '--' : fmtVolume(r.avgVolume)}
                  </td>
                  <td className="px-3 sm:px-4 py-3 tabular-nums whitespace-nowrap">{fmtNum(r.avgAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 text-xs text-[var(--color-text-muted)] space-y-0.5">
          <p>點擊欄位標題可排序，空值以 -- 顯示。</p>
          <p>「年化波動%」為日報酬標準差 × √252；台股年化常用 252 個交易日。</p>
        </div>
      </div>
    </motion.section>
  );
};
